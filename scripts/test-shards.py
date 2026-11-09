#!/usr/bin/env python3
"""Run every top-level Foundry suite separately; fail on missing or failed tests."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--docker-container")
parser.add_argument("--docker-context")
parser.add_argument("--compiler")
parser.add_argument("--log-dir", default="test-results")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
logs = Path(args.log_dir).resolve()
logs.mkdir(parents=True, exist_ok=True)
passed = failed = skipped = 0
suite_count = 0
for path in sorted((root / "test").glob("*.t.sol")):
    relative = str(path.relative_to(root))
    command = ["forge", "test", "--offline", "--match-path", relative, "--skip", "script", "-vv"]
    if args.compiler:
        command += ["--use", args.compiler]
    if args.docker_container:
        prefix = ["docker"]
        if args.docker_context:
            prefix += ["--context", args.docker_context]
        command = prefix + ["exec", "-e", "FOUNDRY_SPARSE_MODE=true", args.docker_container] + command
    environment = dict(os.environ, FOUNDRY_SPARSE_MODE="true")
    result = subprocess.run(command, cwd=root, env=environment, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (logs / (path.stem + ".log")).write_text(result.stdout)
    matches = re.findall(r"(\d+) tests? passed, (\d+) failed, (\d+) skipped", result.stdout)
    if not matches:
        print(f"ERROR {relative}: no completed test summary\n{result.stdout[-3000:]}", flush=True)
        sys.exit(1)
    p, f, s = map(int, matches[-1])
    if result.returncode != 0 or f or s or p == 0:
        print(f"FAIL {relative}: {p} passed / {f} failed\n{result.stdout[-5000:]}", flush=True)
        sys.exit(1)
    passed += p
    failed += f
    skipped += s
    suite_count += 1
    print(f"PASS {relative}: {p} tests", flush=True)
print(f"COMPLETE: {suite_count} files; {passed} passed, {failed} failed, {skipped} skipped", flush=True)
