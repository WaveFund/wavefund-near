#!/usr/bin/env python3
"""Explicit testnet bridge. Inference and signing run in separate Node processes.

Only the inference phase receives the NEAR AI key. Non-inference phases receive
dedicated testnet wallet keys. All credentials travel through ephemeral stdin, not argv.

align-pool trades the private investment pool back to the verified oracle price before a
round (owner wallet only). Give it its own --directory (e.g. .run/tidepool-v1/align-r3):
round journals and alignment journals never mix.
"""
import argparse
from decimal import Decimal, InvalidOperation
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--phase', required=True, choices=['prepare', 'snapshot', 'plan', 'run', 'recover-cancel', 'align-pool'])
p.add_argument('--directory', type=Path, default=Path('.run/aurora-agents/round2'))
p.add_argument('--manifest', type=Path, default=Path('deployments/aurora-testnet.json'))
p.add_argument('--wallet', type=Path, default=Path('secrets/aurora-testnet-wallet.json'))
p.add_argument('--actors', type=Path, default=Path('secrets/aurora-agent-wallets.json'))
p.add_argument('--env', type=Path, default=Path('.env.agents'))
p.add_argument('--artifacts', type=Path, default=Path('out'))
p.add_argument('--extra-artifacts', type=Path)
p.add_argument('--run-inference', action='store_true')
p.add_argument('--tee', action='store_true', help='Require full preflight hardware and model response verification')
p.add_argument('--tee-policy', type=Path, help='Reviewed public TEE measurement/NVIDIA key policy JSON')
p.add_argument('--profile', choices=['classic', 'hybrid', 'swarm', 'swarm2'], default='classic')
p.add_argument('--context', default='colima-wavefund')
p.add_argument('--container', default='wavefund-build-check')
# Pre-registered round terms. Plan phase records them in plan.json; run phase reads them from the plan only.
p.add_argument('--target', type=int, choices=range(5), metavar='{0..4}',
               help='hybrid plan phase: scripted forecaster target (0 Hold, 1 Conservative, 2 Balanced, 3 Momentum, 4 HighBeta)')
p.add_argument('--evaluation-seconds', type=int, help='plan phase: evaluation window 180..3600 seconds after trading end')
p.add_argument('--manipulation-probe-usdc', help='run phase: operator pool-manipulation probe size in whole test USDC (max 20000, up to 6 decimals)')
a = p.parse_args()
if a.phase == 'align-pool' and a.run_inference:
    p.error('--run-inference does not apply to align-pool (no model calls)')
if a.evaluation_seconds is not None and not 180 <= a.evaluation_seconds <= 3600:
    p.error('--evaluation-seconds must be an integer in 180..3600')
if a.target is not None and a.phase not in ['plan', 'run']:
    p.error('--target applies only to the plan phase (and may be repeated, unchanged, at run)')
if a.evaluation_seconds is not None and a.phase not in ['plan', 'run']:
    p.error('--evaluation-seconds applies only to the plan phase (and may be repeated, unchanged, at run)')
probe_amount = None
if a.manipulation_probe_usdc is not None:
    if a.phase != 'run':
        p.error('--manipulation-probe-usdc applies only to the run phase')
    try:
        amount = Decimal(a.manipulation_probe_usdc)
    except InvalidOperation:
        p.error('--manipulation-probe-usdc must be a decimal number of test USDC')
    raw = amount * 1000000
    if not amount.is_finite() or raw != raw.to_integral_value() or raw <= 0 or raw > 20000 * 1000000:
        p.error('--manipulation-probe-usdc must be > 0, at most 20000 and at most 6 decimals')
    probe_amount = str(int(raw))
if a.tee and (a.profile not in ['hybrid', 'swarm', 'swarm2'] or a.phase not in ['plan', 'run']):
    p.error('--tee applies only to hybrid/swarm/swarm2 planning or execution')
if a.tee != bool(a.tee_policy):
    p.error('--tee and --tee-policy must be supplied together')
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
round_journal = any(e.get('stage') in ['schedule', 'actors', 'prepared-actors', 'snapshot', 'plan', 'inference-request'] or
                    str(e.get('label', '')).startswith('round') for e in events)
align_journal = any(e.get('stage') == 'align-start' or str(e.get('label', '')).startswith('align') for e in events)
if a.phase == 'align-pool' and round_journal:
    sys.exit('This directory holds a round journal; use a separate alignment directory (e.g. .run/tidepool-v1/align-r3).')
if a.phase != 'align-pool' and align_journal:
    sys.exit('This directory holds a pool-alignment journal; use a separate round directory.')
hybrid = a.profile == 'hybrid'
swarm = a.profile == 'swarm'
swarm2 = a.profile == 'swarm2'
expanded = hybrid or swarm or swarm2
# Paid model calls per plan phase, by profile (mirrors runtime/agents/provider.mjs PROFILE_CALLS). No retries.
CALL_CAPS = {'classic': 4, 'hybrid': 4, 'swarm': 8, 'swarm2': 12}
call_cap = CALL_CAPS[a.profile]
# swarm2 adds one proposer and four forecasters (runtime/agents/swarm-config.mjs); prepare generates their keys.
SWARM2_ACTORS = ['Conservative', 'Balanced', 'Momentum', 'HighBeta',
                 'Quant', 'Guardian', 'FeeAnalyst', 'StressAnalyst', 'BaseRate', 'VolAnalyst', 'Regime', 'Skeptic']
# Exactly one paid call per swarm2 agent: the cap is proposers + forecasters, never more.
if CALL_CAPS['swarm2'] != len(SWARM2_ACTORS):
    sys.exit('swarm2 call cap must equal its proposer + forecaster count')
actor_names = SWARM2_ACTORS if swarm2 else ['Conservative', 'Balanced', 'Momentum', 'HighBeta', 'Quant', 'Guardian', 'FeeAnalyst', 'StressAnalyst'] if expanded else ['Momentum', 'Conservative', 'Quant', 'Guardian']
config = dict(phase=a.phase, events=events, hybrid=hybrid, swarm=swarm, actorNames=actor_names)
if swarm2:
    config['swarm2'] = True
if a.tee:
    config['teePolicy'] = json.loads(a.tee_policy.read_text())
if a.target is not None and not hybrid:
    sys.exit('--target is only for the hybrid profile (scripted forecasters).')
if a.phase == 'plan' and hybrid and a.target is None:
    sys.exit('Hybrid plan requires an explicit pre-registered --target {0..4}.')
if a.phase == 'plan' and not expanded and a.evaluation_seconds not in [None, 180]:
    sys.exit('The classic profile keeps its 180 second horizon.')
if a.phase == 'plan':
    if not a.run_inference:
        sys.exit('Use --run-inference to explicitly spend credits on at most thirteen model calls for swarm2, eight for swarm, four otherwise.')
    if any(e.get('stage') == 'inference-request' for e in events):
        sys.exit('Inference already attempted in this session. No automatic paid retry.')
    snapshot = json.loads((a.directory / 'snapshot.json').read_text())
    config.update(snapshot=snapshot['snapshot'], market=snapshot['market'])
    if a.target is not None:
        config['scriptedTarget'] = a.target
    if a.evaluation_seconds is not None:
        config['evaluationSeconds'] = a.evaluation_seconds
    if expanded or snapshot.get('researchContext'):
        config['researchContext'] = snapshot['researchContext']
    environment = {}
    for line in a.env.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() in ['NEARAI_API_KEY', 'NEARAI_API_KEY_1', 'NEARAI_API_KEY_2', 'WAVEFUND_AGENT_MODEL'] and not (swarm2 and key.strip() == 'WAVEFUND_AGENT_MODEL'):
            environment[key.strip()] = value.strip().strip('"').strip("'")
    if not environment.get('NEARAI_API_KEY'):
        sys.exit('Configure the private NEAR AI key locally; never paste it in chat.')
    # swarm2 assigns one allowlisted model per agent in code; a single env model is never used.
    config.update(apiKey=environment['NEARAI_API_KEY'], backupApiKeys=[environment[k] for k in ['NEARAI_API_KEY_1', 'NEARAI_API_KEY_2'] if environment.get(k)], model=None if swarm2 else environment.get('WAVEFUND_AGENT_MODEL'))
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
    keys = json.loads(a.actors.read_text()) if a.actors.exists() else {}
    missing = [name for name in actor_names if name not in keys]
    if missing:
        if a.phase != 'prepare':
            sys.exit('Prepare the dedicated test-agent wallets first.')
        a.actors.parent.mkdir(parents=True, exist_ok=True)
        order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
        for name in missing:
            keys[name] = '0x' + (secrets.randbelow(order - 1) + 1).to_bytes(32, 'big').hex()
        temporary = a.actors.with_suffix('.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(keys, file)
            file.flush()
            os.fsync(file.fileno())
        temporary.replace(a.actors)
    if a.actors.stat().st_mode & 0o077:
        sys.exit('Test-agent key file must be owner-only (chmod 600).')
    config['actorKeys'] = json.loads(a.actors.read_text())
    if a.phase == 'run':
        if any(e.get('stage') == 'schedule' for e in events):
            sys.exit('A timed round was already started; inspect/recover it instead of replaying.')
        plan = json.loads((a.directory / 'plan.json').read_text())
        planned_seconds = plan.get('evaluationSeconds', 180)
        if a.evaluation_seconds is not None and a.evaluation_seconds != planned_seconds:
            sys.exit('--evaluation-seconds differs from the pre-registered plan; the plan wins, refusing to run.')
        if a.target is not None and a.target != plan.get('scriptedTarget'):
            sys.exit('--target differs from the pre-registered plan; the plan wins, refusing to run.')
        config['evaluationSeconds'] = planned_seconds
        if hybrid and 'scriptedTarget' in plan:
            config['scriptedTarget'] = plan['scriptedTarget']
        if probe_amount is not None:
            config['manipulationProbe'] = {'stableAmount': probe_amount}
        config['plan'] = plan

with journal_path.open('a') as journal, (a.directory / 'worker.stderr').open('a') as errors:
    child = subprocess.Popen(['docker', '--context', a.context, 'exec', '-i', a.container,
                              'node', '/work/scripts/aurora-agent-round.mjs'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True)
    child.stdin.write(json.dumps(config) + '\n')
    child.stdin.flush()
    del config
    inference_requests = 0
    for line in child.stdout:
        event = json.loads(line)
        if event.get('stage') == 'inference-request':
            inference_requests += 1
            if inference_requests > call_cap or event.get('request') != inference_requests:
                # Never acknowledge a call beyond the profile cap: the worker waits for the ack before spending.
                child.kill()
                journal.write(json.dumps({'stage': 'inference-cap', 'status': 'failed', 'cap': call_cap, 'request': event.get('request')}) + '\n')
                journal.flush()
                sys.exit(f'Model-call cap exceeded: {a.profile} allows {call_cap} calls; worker stopped before the extra call.')
        journal.write(json.dumps(event) + '\n')
        journal.flush()
        os.fsync(journal.fileno())
        if event.get('stage') in ['prepared', 'inference-request']:
            acknowledgement = event['hash'] if event['stage'] == 'prepared' else f"inference-{event['request']}"
            child.stdin.write(json.dumps({'ack': acknowledgement}) + '\n')
            child.stdin.flush()
        if event.get('stage') in ['snapshot', 'plan', 'complete', 'pool-aligned', 'tee-verification-failed'] and (event.get('stage') != 'plan' or 'plan' in event):
            name = event['stage']
            value = event['plan'] if name == 'plan' else event
            temporary = a.directory / f'{name}.json.tmp'
            temporary.write_text(json.dumps(value, indent=2) + '\n')
            temporary.replace(a.directory / f'{name}.json')
        # Public model decisions remain in local files; print concise progress only.
        if event.get('stage') == 'plan' and event.get('status') == 'failed':
            print(json.dumps({'stage': 'plan', 'status': 'failed', 'reason': event.get('reason'), 'errorName': event.get('errorName')}), flush=True)
        elif event.get('stage') in ['plan', 'snapshot', 'complete']:
            print(json.dumps({'stage': event['stage'], 'file': str(a.directory / (event['stage'] + '.json'))}), flush=True)
        elif event.get('stage') == 'tee-verification-failed':
            print(json.dumps({'stage': event['stage'], 'agent': event.get('agent'), 'reason': event.get('reason'), 'checks': event.get('checks')}), flush=True)
        elif event.get('stage') == 'agent-record':
            record = event['record']
            print(json.dumps({'stage': 'agent-record', 'name': record['name'], 'usage': record['usage'], 'outputHash': record['outputHash']}), flush=True)
        else:
            print(json.dumps(event), flush=True)
    child.stdin.close()
    sys.exit(child.wait())
