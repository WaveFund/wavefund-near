#!/usr/bin/env python3
"""Fetch checksum-pinned source only. Never executes dependency installation scripts."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
pins = json.loads((ROOT / "docs/dependency-pins.json").read_text())
for relative, pin in pins.items():
    target = ROOT / "lib" / relative
    marker = target / ".wayfund-source"
    if marker.exists():
        if marker.read_text().strip() != pin["commit"]:
            raise SystemExit(f"Dependency version mismatch: {relative}")
        print(f"Present: {relative}")
        continue
    # Parent repositories contain empty gitlink directories. Preserve unrelated content.
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"Refusing to overwrite unmarked dependency: {relative}")
    url = f"https://codeload.github.com/{pin['repo']}/tar.gz/{pin['commit']}"
    request = urllib.request.Request(url, headers={"User-Agent": "Wayfund-local-build"})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != pin["archive_sha256"]:
        raise SystemExit(f"Archive checksum mismatch: {relative}")
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            parts = member.name.split("/", 1)
            if len(parts) != 2 or not parts[1]:
                continue
            member.name = parts[1]
            if member.issym() or member.islnk():
                continue
            archive.extract(member, target, filter="data")
    marker.write_text(pin["commit"] + "\n")
    print(f"Fetched: {relative}")
