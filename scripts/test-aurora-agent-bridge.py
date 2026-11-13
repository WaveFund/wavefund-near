"""Offline tests: no real wallet, model request or Docker daemon."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AgentBridgeSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.command = [sys.executable, str(Path(__file__).with_name('run-aurora-agents.py')),
                        '--phase', 'plan', '--directory', str(self.root)]

    def run_bridge(self, *args):
        return subprocess.run(self.command + list(args), capture_output=True, text=True, timeout=10)

    def test_tee_requires_expanded_profile_and_separate_policy(self):
        result = self.run_bridge('--tee', '--run-inference')
        self.assertIn('--tee applies only', result.stderr)
        result = self.run_bridge('--tee', '--profile', 'hybrid', '--run-inference', '--target', '3')
        self.assertIn('--tee and --tee-policy must be supplied together', result.stderr)
        result = self.run_bridge('--tee-policy', 'missing-policy.json', '--profile', 'hybrid', '--target', '3')
        self.assertIn('--tee and --tee-policy must be supplied together', result.stderr)

    def test_explicit_paid_flag_required_before_reading_credentials(self):
        result = self.run_bridge()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('explicitly spend credits', result.stderr)
        # With the flag it reaches public snapshot loading, not the paid-flag error.
        result = self.run_bridge('--run-inference')
        self.assertNotIn('explicitly spend credits', result.stderr)
        self.assertIn('snapshot.json', result.stderr)

    def test_paid_inference_is_not_automatically_repeated(self):
        journal = self.root / 'journal.jsonl'
        journal.write_text(json.dumps({'stage': 'inference-request', 'request': 1}) + '\n')
        result = self.run_bridge('--run-inference')
        self.assertIn('Inference already attempted', result.stderr)
        self.assertNotIn('snapshot.json', result.stderr)
        journal.write_text('')
        self.assertIn('snapshot.json', self.run_bridge('--run-inference').stderr)

    def test_unknown_broadcast_blocks_all_other_phases(self):
        journal = self.root / 'journal.jsonl'
        pending = {'stage': 'prepared', 'hash': '0xabc', 'label': 'fixture'}
        journal.write_text(json.dumps(pending) + '\n')
        self.assertIn('Unresolved transaction', self.run_bridge('--run-inference').stderr)
        journal.write_text(json.dumps(pending) + '\n' + json.dumps({'stage': 'confirmed', 'hash': '0xabc'}) + '\n')
        result = self.run_bridge('--run-inference')
        self.assertNotIn('Unresolved transaction', result.stderr)
        self.assertIn('snapshot.json', result.stderr)

    def test_concurrent_operator_is_blocked(self):
        with (self.root / 'operator.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertIn('no concurrent signing or inference', self.run_bridge('--run-inference').stderr)
        self.assertIn('snapshot.json', self.run_bridge('--run-inference').stderr)

    def test_recovery_phase_is_explicit_and_still_blocks_unknown_broadcast(self):
        command = self.command.copy()
        command[command.index('plan')] = 'recover-cancel'
        journal = self.root / 'journal.jsonl'
        journal.write_text(json.dumps({'stage': 'prepared', 'hash': '0xabc'}) + '\n')
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unresolved transaction', result.stderr)
        self.assertNotIn('invalid choice', result.stderr)

    def test_swarm_selects_eight_actors_without_scripted_forecasters(self):
        (self.root / 'snapshot.json').write_text(json.dumps({'snapshot': {}, 'market': {}, 'researchContext': {'evidenceId': 'fixture'}}))
        environment_file = self.root / 'fake.env'
        environment_file.write_text('NEARAI_API_KEY=unit-test-placeholder\nWAVEFUND_AGENT_MODEL=unit-test-model\n')
        executable = self.root / 'docker'
        executable.write_text('#!/usr/bin/env python3\nimport sys,json\nc=json.loads(sys.stdin.readline())\nprint(json.dumps({"stage":"plan","plan":{"swarm":c["swarm"],"hybrid":c["hybrid"],"actors":c["actorNames"],"research":c["researchContext"]}}))\n')
        executable.chmod(0o700)
        environment = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']}
        result = subprocess.run(self.command + ['--profile', 'swarm', '--run-inference', '--env', str(environment_file)], capture_output=True, text=True, timeout=10, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads((self.root / 'plan.json').read_text())
        self.assertTrue(plan['swarm'])
        self.assertFalse(plan['hybrid'])
        self.assertEqual(len(plan['actors']), 8)
        self.assertEqual(plan['research']['evidenceId'], 'fixture')

    def fake_docker(self, event_stage):
        executable = self.root / 'docker'
        executable.write_text('#!/usr/bin/env python3\nimport sys,json\nc=json.loads(sys.stdin.readline())\n'
                              'keys=["scriptedTarget","evaluationSeconds","manipulationProbe","hybrid"]\n'
                              f'print(json.dumps({{"stage":"{event_stage}",' + ('"plan":' if event_stage == 'plan' else '"seen":') +
                              '{k:c.get(k) for k in keys}}))\n')
        executable.chmod(0o700)
        return {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']}

    def test_hybrid_plan_requires_and_forwards_a_pre_registered_target_and_window(self):
        (self.root / 'snapshot.json').write_text(json.dumps({'snapshot': {}, 'market': {}, 'researchContext': {'evidenceId': 'fixture'}}))
        environment_file = self.root / 'fake.env'
        environment_file.write_text('NEARAI_API_KEY=unit-test-placeholder\n')
        environment = self.fake_docker('plan')
        base = self.command + ['--profile', 'hybrid', '--run-inference', '--env', str(environment_file)]
        missing = subprocess.run(base, capture_output=True, text=True, timeout=10, env=environment)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('explicit pre-registered --target', missing.stderr)
        result = subprocess.run(base + ['--target', '1', '--evaluation-seconds', '900'], capture_output=True, text=True, timeout=10, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads((self.root / 'plan.json').read_text())
        self.assertEqual([plan['scriptedTarget'], plan['evaluationSeconds'], plan['manipulationProbe']], [1, 900, None])

    def test_round_term_flags_are_bounded_and_phase_scoped(self):
        for args, message in [(['--evaluation-seconds', '179'], '180..3600'), (['--evaluation-seconds', '3601'], '180..3600'),
                              (['--target', '5'], 'invalid choice'), (['--target', '2'], 'only for the hybrid profile'),
                              (['--manipulation-probe-usdc', '10'], 'only to the run phase'),
                              (['--profile', 'classic', '--evaluation-seconds', '600', '--run-inference'], 'classic profile keeps its 180')]:
            result = self.run_bridge(*args)
            self.assertNotEqual(result.returncode, 0, args)
            self.assertIn(message, result.stderr, args)
        # Discriminates: in-range values pass argument validation and reach snapshot loading.
        self.assertIn('snapshot.json', self.run_bridge('--profile', 'swarm', '--evaluation-seconds', '3600', '--run-inference').stderr)

    def run_phase(self, plan, *args):
        manifest = self.root / 'manifest.json'
        manifest.write_text('{}')
        artifacts = self.root / 'out'
        artifacts.mkdir(exist_ok=True)
        for name in ['SupraPortfolioOracle', 'AuroraTestToken', 'Safe', 'ProposalTokens', 'ProposerRegistry',
                     'WaveV4ProposalMarket', 'QuantumRound', 'WaveHook', 'PerformanceTracker', 'TradingSafeModule']:
            (artifacts / f'{name}.json').write_text(json.dumps({'abi': []}))
        wallet = self.root / 'wallet.json'
        wallet.write_text(json.dumps({'private_key': 'unit-test-placeholder'}))
        actors = self.root / 'actors.json'
        actors.write_text(json.dumps({n: 'unit-test-placeholder' for n in ['Conservative', 'Balanced', 'Momentum', 'HighBeta', 'Quant', 'Guardian', 'FeeAnalyst', 'StressAnalyst']}))
        actors.chmod(0o600)
        (self.root / 'plan.json').write_text(json.dumps(plan))
        command = self.command.copy()
        command[command.index('plan')] = 'run'
        return subprocess.run(command + ['--profile', 'hybrid', '--manifest', str(manifest), '--artifacts', str(artifacts),
                                         '--wallet', str(wallet), '--actors', str(actors)] + list(args),
                              capture_output=True, text=True, timeout=10, env=self.fake_docker('complete'))

    def test_run_phase_reads_terms_from_the_plan_and_caps_the_probe(self):
        plan = {'scriptedTarget': 2, 'evaluationSeconds': 900}
        result = self.run_phase(plan, '--manipulation-probe-usdc', '1500.25')
        self.assertEqual(result.returncode, 0, result.stderr)
        seen = json.loads((self.root / 'complete.json').read_text())['seen']
        self.assertEqual(seen, {'scriptedTarget': 2, 'evaluationSeconds': 900, 'manipulationProbe': {'stableAmount': '1500250000'}, 'hybrid': True})
        for args, message in [(['--target', '3'], 'differs from the pre-registered plan'), (['--evaluation-seconds', '180'], 'differs from the pre-registered plan'),
                              (['--manipulation-probe-usdc', '20000.000001'], 'at most 20000'), (['--manipulation-probe-usdc', '0'], 'must be > 0'),
                              (['--manipulation-probe-usdc', '1.0000001'], '6 decimals'), (['--manipulation-probe-usdc', 'nan'], 'at most 20000')]:
            result = self.run_phase(plan, *args)
            self.assertNotEqual(result.returncode, 0, args)
            self.assertIn(message, result.stderr, args)
        self.assertEqual(self.run_phase(plan, '--target', '2', '--manipulation-probe-usdc', '20000').returncode, 0)
        seen = json.loads((self.root / 'complete.json').read_text())['seen']
        self.assertEqual(seen['manipulationProbe'], {'stableAmount': '20000000000'})

    def align_phase(self, journal_events=(), *args):
        manifest = self.root / 'manifest.json'
        manifest.write_text(json.dumps({'chainId': 1313161555}))
        artifacts = self.root / 'out'
        artifacts.mkdir(exist_ok=True)
        for name in ['SupraPortfolioOracle', 'AuroraTestToken', 'Safe', 'ProposalTokens', 'ProposerRegistry',
                     'WaveV4ProposalMarket', 'QuantumRound', 'WaveHook', 'PerformanceTracker', 'TradingSafeModule']:
            (artifacts / f'{name}.json').write_text(json.dumps({'abi': []}))
        wallet = self.root / 'wallet.json'
        wallet.write_text(json.dumps({'private_key': 'unit-test-placeholder'}))
        actors = self.root / 'actors.json'
        actors.write_text(json.dumps({n: 'unit-test-placeholder' for n in ['Momentum', 'Conservative', 'Quant', 'Guardian']}))
        actors.chmod(0o600)
        (self.root / 'journal.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in journal_events))
        executable = self.root / 'docker'
        executable.write_text('#!/usr/bin/env python3\nimport sys,json\nc=json.loads(sys.stdin.readline())\n'
                              'print(json.dumps({"stage":"pool-aligned","seen":{"phase":c["phase"],"chainId":c["manifest"].get("chainId"),'
                              '"plan":"plan" in c,"apiKey":"apiKey" in c,"events":len(c["events"])}}))\n')
        executable.chmod(0o700)
        command = self.command.copy()
        command[command.index('plan')] = 'align-pool'
        return subprocess.run(command + ['--manifest', str(manifest), '--artifacts', str(artifacts), '--wallet', str(wallet), '--actors', str(actors)] + list(args),
                              capture_output=True, text=True, timeout=10,
                              env={**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']})

    def test_align_pool_needs_no_plan_or_model_key_and_writes_its_report(self):
        result = self.align_phase()
        self.assertEqual(result.returncode, 0, result.stderr)
        seen = json.loads((self.root / 'pool-aligned.json').read_text())['seen']
        self.assertEqual(seen, {'phase': 'align-pool', 'chainId': 1313161555, 'plan': False, 'apiKey': False, 'events': 0})
        # A repeat in the same alignment directory is allowed; the worker numbers attempts from the journal.
        result = self.align_phase([{'stage': 'align-start', 'attempt': 1}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / 'pool-aligned.json').read_text())['seen']['events'], 1)

    def test_align_pool_and_round_journals_never_mix(self):
        for event in [{'stage': 'schedule'}, {'stage': 'actors'}, {'stage': 'confirmed', 'hash': '0x1', 'label': 'round3:open'}]:
            result = self.align_phase([event])
            self.assertNotEqual(result.returncode, 0, event)
            self.assertIn('separate alignment directory', result.stderr, event)
        for flag, message in [(['--run-inference'], 'does not apply to align-pool'), (['--target', '1'], 'only to the plan phase'),
                              (['--manipulation-probe-usdc', '10'], 'only to the run phase'), (['--evaluation-seconds', '600'], 'only to the plan phase')]:
            result = self.align_phase((), *flag)
            self.assertNotEqual(result.returncode, 0, flag)
            self.assertIn(message, result.stderr, flag)
        # Symmetric: a round phase refuses an alignment journal.
        (self.root / 'journal.jsonl').write_text(json.dumps({'stage': 'align-start', 'attempt': 1}) + '\n')
        self.assertIn('pool-alignment journal', self.run_bridge('--run-inference').stderr)


    def swarm2_worker(self, requests):
        """Fake worker: records its config, then asks for `requests` acknowledged inference calls, then emits a plan."""
        (self.root / 'snapshot.json').write_text(json.dumps({'snapshot': {}, 'market': {}, 'researchContext': {'evidenceId': 'fixture'}}))
        environment_file = self.root / 'fake.env'
        environment_file.write_text('NEARAI_API_KEY=unit-test-placeholder\nWAVEFUND_AGENT_MODEL=unit-test-model\n')
        executable = self.root / 'docker'
        executable.write_text('#!/usr/bin/env python3\nimport sys,json\nc=json.loads(sys.stdin.readline())\n'
                              f'for i in range(1, {requests} + 1):\n'
                              '    print(json.dumps({"stage":"inference-request","request":i}), flush=True)\n'
                              '    ack=json.loads(sys.stdin.readline())\n'
                              '    assert ack["ack"]==f"inference-{i}"\n'
                              'print(json.dumps({"stage":"plan","plan":{"swarm2":c.get("swarm2"),"swarm":c["swarm"],"hybrid":c["hybrid"],"actors":c["actorNames"],"model":c["model"],"tee":"teePolicy" in c}}), flush=True)\n')
        executable.chmod(0o700)
        environment = {**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH']}
        return subprocess.run(self.command + ['--profile', 'swarm2', '--run-inference', '--env', str(environment_file)], capture_output=True, text=True, timeout=10, env=environment)

    def test_swarm2_forwards_fourteen_actors_and_no_single_model_within_fourteen_calls(self):
        result = self.swarm2_worker(14)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads((self.root / 'plan.json').read_text())
        self.assertEqual([plan['swarm2'], plan['swarm'], plan['hybrid'], plan['model']], [True, False, False, None])
        self.assertEqual(len(plan['actors']), 14)
        self.assertEqual(len(set(plan['actors'])), 14)
        self.assertIn('Contrarian', plan['actors'])
        self.assertIn('Skeptic', plan['actors'])

    def test_swarm2_never_acknowledges_a_fifteenth_model_call(self):
        result = self.swarm2_worker(15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Model-call cap exceeded: swarm2 allows 14 calls', result.stderr)
        self.assertFalse((self.root / 'plan.json').exists())
        journal = [json.loads(line) for line in (self.root / 'journal.jsonl').read_text().splitlines()]
        self.assertEqual(sum(1 for e in journal if e.get('stage') == 'inference-request'), 14)
        self.assertEqual(journal[-1], {'stage': 'inference-cap', 'status': 'failed', 'cap': 14, 'request': 15})

    def test_swarm2_accepts_tee_with_policy(self):
        result = self.run_bridge('--tee', '--tee-policy', 'missing-policy.json', '--profile', 'swarm2', '--run-inference')
        self.assertNotIn('--tee applies only', result.stderr)
        self.assertNotIn('invalid choice', result.stderr)

if __name__ == '__main__':
    unittest.main()
