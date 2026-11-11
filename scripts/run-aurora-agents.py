#!/usr/bin/env python3
"""Explicit testnet bridge. Inference and signing run in separate Node processes.

Only the inference phase receives the NEAR AI key. Non-inference phases receive
dedicated testnet wallet keys. All credentials travel through ephemeral stdin, not argv.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--phase', required=True, choices=['prepare', 'snapshot', 'plan', 'run', 'recover-cancel'])
p.add_argument('--directory', type=Path, default=Path('.run/aurora-agents/round2'))
p.add_argument('--manifest', type=Path, default=Path('deployments/aurora-testnet.json'))
p.add_argument('--wallet', type=Path, default=Path('secrets/aurora-testnet-wallet.json'))
p.add_argument('--actors', type=Path, default=Path('secrets/aurora-agent-wallets.json'))
p.add_argument('--env', type=Path, default=Path('.env.agents'))
p.add_argument('--artifacts', type=Path, default=Path('out'))
p.add_argument('--extra-artifacts', type=Path)
p.add_argument('--run-inference', action='store_true')
p.add_argument('--context', default='colima-wavefund')
p.add_argument('--container', default='wavefund-build-check')
a = p.parse_args()
a.directory.mkdir(parents=True, exist_ok=True)
lock = (a.directory / 'operator.lock').open('a+')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit('Another agent operator owns this journal; no concurrent signing or inference.')
journal_path = a.directory / 'journal.jsonl'
events = [json.loads(line) for line in journal_path.read_text().splitlines()] if journal_path.exists() else []
confirmed = {e['hash'] for e in events if e.get('stage') == 'confirmed'}
pending = [e['hash'] for e in events if e.get('stage') == 'prepared' and e['hash'] not in confirmed]
if pending:
    sys.exit('Unresolved transaction: inspect receipts before continuing: ' + ', '.join(pending))
config = dict(phase=a.phase, events=events)
if a.phase == 'plan':
    if not a.run_inference:
        sys.exit('Use --run-inference to explicitly spend credits on at most four model calls.')
    if any(e.get('stage') == 'inference-request' for e in events):
        sys.exit('Inference already attempted in this session. No automatic paid retry.')
    snapshot = json.loads((a.directory / 'snapshot.json').read_text())
    config.update(snapshot=snapshot['snapshot'], market=snapshot['market'])
    environment = {}
    for line in a.env.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() in ['NEARAI_API_KEY', 'WAVEFUND_AGENT_MODEL']:
            environment[key.strip()] = value.strip().strip('"').strip("'")
    if not environment.get('NEARAI_API_KEY'):
        sys.exit('Configure the private NEAR AI key locally; never paste it in chat.')
    config.update(apiKey=environment['NEARAI_API_KEY'], model=environment.get('WAVEFUND_AGENT_MODEL'))
    del environment
else:
    config['manifest'] = json.loads(a.manifest.read_text())
    artifacts = {}
    for name in ['SupraPortfolioOracle', 'AuroraTestToken', 'Safe', 'ProposalTokens', 'ProposerRegistry',
                 'WaveV4ProposalMarket', 'QuantumRound', 'WaveHook', 'PerformanceTracker', 'TradingSafeModule']:
        matches = list(a.artifacts.glob(f'**/{name}.json'))
        if not matches and a.extra_artifacts:
            matches = list(a.extra_artifacts.glob(f'**/{name}.json'))
        if not matches:
            sys.exit(f'Missing public artifact: {name}')
        artifacts[name] = {'abi': json.loads(matches[0].read_text())['abi']}
    config['artifacts'] = artifacts
    wallet = json.loads(a.wallet.read_text())
    if isinstance(wallet, list):
        wallet = wallet[0]
    config['privateKey'] = wallet['private_key']
    del wallet
    if not a.actors.exists():
        if a.phase != 'prepare':
            sys.exit('Prepare the dedicated test-agent wallets first.')
        a.actors.parent.mkdir(parents=True, exist_ok=True)
        order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        keys = {name: '0x' + (secrets.randbelow(order - 1) + 1).to_bytes(32, 'big').hex()
                for name in ['Momentum', 'Conservative', 'Quant', 'Guardian']}
        fd = os.open(a.actors, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(keys, file)
    if a.actors.stat().st_mode & 0o077:
        sys.exit('Test-agent key file must be owner-only (chmod 600).')
    config['actorKeys'] = json.loads(a.actors.read_text())
    if a.phase == 'run':
        if any(e.get('stage') == 'schedule' for e in events):
            sys.exit('A timed round was already started; inspect/recover it instead of replaying.')
        config['plan'] = json.loads((a.directory / 'plan.json').read_text())

with journal_path.open('a') as journal, (a.directory / 'worker.stderr').open('a') as errors:
    child = subprocess.Popen(['docker', '--context', a.context, 'exec', '-i', a.container,
                              'node', '/work/scripts/aurora-agent-round.mjs'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True)
    child.stdin.write(json.dumps(config) + '\n')
    child.stdin.flush()
    del config
    for line in child.stdout:
        event = json.loads(line)
        journal.write(json.dumps(event) + '\n')
        journal.flush()
        os.fsync(journal.fileno())
        if event.get('stage') in ['prepared', 'inference-request']:
            acknowledgement = event['hash'] if event['stage'] == 'prepared' else f"inference-{event['request']}"
            child.stdin.write(json.dumps({'ack': acknowledgement}) + '\n')
            child.stdin.flush()
        if event.get('stage') in ['snapshot', 'plan', 'complete']:
            name = event['stage']
            value = event['plan'] if name == 'plan' else event
            temporary = a.directory / f'{name}.json.tmp'
            temporary.write_text(json.dumps(value, indent=2) + '\n')
            temporary.replace(a.directory / f'{name}.json')
        # Public model decisions remain in local files; print concise progress only.
        if event.get('stage') in ['plan', 'snapshot', 'complete']:
            print(json.dumps({'stage': event['stage'], 'file': str(a.directory / (event['stage'] + '.json'))}), flush=True)
        elif event.get('stage') == 'agent-record':
            record = event['record']
            print(json.dumps({'stage': 'agent-record', 'name': record['name'], 'usage': record['usage'], 'outputHash': record['outputHash']}), flush=True)
        else:
            print(json.dumps(event), flush=True)
    child.stdin.close()
    sys.exit(child.wait())
