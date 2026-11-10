"""Offline bridge safety regressions. No real wallet or Docker daemon is used."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class BridgeSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.journal = self.root / 'run.jsonl'
        self.artifacts = self.root / 'out'
        self.artifacts.mkdir()
        self.command = [sys.executable, str(Path(__file__).with_name('run-aurora-safe-round.py')),
                        '--artifacts', str(self.artifacts), '--wallet', str(self.root / 'no-wallet.json'),
                        '--journal', str(self.journal)]

    def run_bridge(self):
        return subprocess.run(self.command, text=True, capture_output=True, timeout=10)

    def test_concurrent_signer_blocked_before_credentials(self):
        with self.journal.with_suffix('.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_bridge()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('journal is already in use', result.stderr)
        # Discriminate the inputs: releasing the lock reaches artifact validation.
        result = self.run_bridge()
        self.assertIn('Missing public artifact', result.stderr)
        self.assertNotIn('journal is already in use', result.stderr)

    def test_unresolved_broadcast_blocks_wallet_read(self):
        for name in ['SupraPortfolioOracle', 'AuroraTestToken', 'SafeProxy', 'Safe',
                     'ProposalTokens', 'ProposerRegistry', 'WaveV4ProposalMarket',
                     'QuantumRound', 'WaveHook', 'HookDeployer', 'PerformanceTracker',
                     'TradingSafeModule']:
            (self.artifacts / f'{name}.json').write_text(json.dumps({'abi': [], 'bytecode': {'object': '0x00'}}))
        prepared = {'stage': 'prepared', 'hash': '0xabc', 'label': 'test-only'}
        self.journal.write_text(json.dumps(prepared) + '\n')
        result = self.run_bridge()
        self.assertIn('Unresolved broadcast', result.stderr)
        self.assertNotIn('no-wallet.json', result.stderr)
        self.journal.write_text(json.dumps(prepared) + '\n' + json.dumps({
            'stage': 'confirmed', 'hash': '0xabc', 'label': 'test-only'}) + '\n')
        result = self.run_bridge()
        self.assertNotIn('Unresolved broadcast', result.stderr)
        self.assertIn('no-wallet.json', result.stderr)  # Now, and only now, wallet reading is reached.


if __name__ == '__main__':
    unittest.main()
