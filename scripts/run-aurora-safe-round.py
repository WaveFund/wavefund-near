#!/usr/bin/env python3
"""Host-side stdin bridge: never copies a key file into the container or argv.

The Node runner must already be copied into a credential-free container with
the project's pinned viem dependency. Compiler artifacts are public data.
"""
import argparse
import fcntl
import json
import pathlib
import subprocess
import sys

p = argparse.ArgumentParser()
p.add_argument('--phase', choices=['deploy', 'round'], default='deploy')
p.add_argument('--artifacts', type=pathlib.Path, required=True)
p.add_argument('--extra-artifacts', type=pathlib.Path)
p.add_argument('--wallet', type=pathlib.Path, required=True)
p.add_argument('--journal', type=pathlib.Path, required=True)
p.add_argument('--context', default='colima-wavefund')
p.add_argument('--container', default='wavefund-build-check')
a = p.parse_args()
a.journal.parent.mkdir(parents=True, exist_ok=True)
guard = a.journal.with_suffix('.lock').open('a+')
try:
    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit('This testnet journal is already in use; do not launch concurrent signers.')
artifacts = {}
for name in ['SupraPortfolioOracle', 'AuroraTestToken', 'SafeProxy', 'Safe',
             'ProposalTokens', 'ProposerRegistry', 'WaveV4ProposalMarket',
             'QuantumRound', 'WaveHook', 'HookDeployer', 'PerformanceTracker',
             'TradingSafeModule']:
    found = list(a.artifacts.glob(f'**/{name}.json'))
    if not found and a.extra_artifacts:
        found = list(a.extra_artifacts.glob(f'**/{name}.json'))
    if not found:
        sys.exit(f'Missing public artifact: {name}')
    artifact = json.loads(found[0].read_text())
    artifacts[name] = {k: artifact[k] for k in ['abi', 'bytecode']}

events = [json.loads(line) for line in a.journal.read_text().splitlines()] if a.journal.exists() else []
confirmed = {e['hash'] for e in events if e.get('stage') == 'confirmed'}
ambiguous = [e['hash'] for e in events if e.get('stage') == 'prepared' and e['hash'] not in confirmed]
if ambiguous:
    sys.exit('Unresolved broadcast: inspect receipts before resuming: ' + ', '.join(ambiguous))
contracts = {e['key']: e['address'] for e in events if e.get('stage') == 'contract'}
completed = [e['label'] for e in events if e.get('stage') == 'confirmed']
schedule = next((e for e in reversed(events) if e.get('stage') == 'schedule'), None)
wallet = json.loads(a.wallet.read_text())
if isinstance(wallet, list):
    wallet = wallet[0]
config = dict(privateKey=wallet['private_key'], artifacts=artifacts, contracts=contracts,
              completed=completed, phase=a.phase, schedule=schedule)
del wallet
with a.journal.open('a') as journal:
    process = subprocess.Popen(['docker', '--context', a.context, 'exec', '-i', a.container,
                                'node', '/work/scripts/aurora-safe-round.mjs'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True)
    process.stdin.write(json.dumps(config))
    process.stdin.close()
    del config
    for line in process.stdout:
        event = json.loads(line)  # Do not print arbitrary executable output.
        safe_line = json.dumps(event)
        journal.write(safe_line + '\n')
        journal.flush()
        print(safe_line, flush=True)
    status = process.wait()
    if status and not events:
        print('Runner stopped; inspect the journal. No automatic transaction retries.', file=sys.stderr)
    sys.exit(status)
