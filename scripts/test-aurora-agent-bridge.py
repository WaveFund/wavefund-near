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


if __name__ == '__main__':
    unittest.main()
