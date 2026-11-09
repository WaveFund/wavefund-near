#!/usr/bin/env python3
"""Download signed packages only. No wallet access or broadcast; authenticated calls may consume gateway quota."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
from redstone_common import select_snapshot

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
key = os.environ.get("REDSTONE_GATEWAY_API_KEY")
if not key:
    sys.exit("REDSTONE_GATEWAY_API_KEY is not set. No request sent; historical fixtures are not a live-data fallback.")
url = "https://oracle-gateway.a.redstone.finance/v2/data-packages/latest-by-data-feeds/redstone-primary-prod?dataFeedIds=ETH%2CUSDC"
request = urllib.request.Request(url, headers={"User-Agent": "Wayfund-oracle-proof", "x-api-key": key})
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        data = response.read(1_000_001)
except urllib.error.HTTPError as exc:
    sys.exit(f"Gateway HTTP {exc.code}; response/key not logged. No price accepted.")
except urllib.error.URLError:
    sys.exit("Gateway unavailable. No price accepted.")
if len(data) > 1_000_000:
    sys.exit("Response exceeds the accepted size.")
packages = json.loads(data)
now = int(time.time())
for feed in ("ETH", "USDC"):
    items = packages.get(feed)
    if not isinstance(items, list) or not 3 <= len(items) <= 10:
        sys.exit(f"Expected 3–10 candidate packages for {feed}.")
    packages[feed] = [item for item in items if 0 <= now - int(item["timestampMilliseconds"]) // 1000 <= 60]
try:
    packages = select_snapshot(packages)
except ValueError:
    sys.exit("No complete current ETH/USDC snapshot. No file written.")
args.output.write_text(json.dumps(packages, indent=2) + "\n")
print("Downloaded current candidate packages. Solidity must still verify signatures, per-feed quorum and common timestamps.")
