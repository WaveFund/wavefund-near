#!/usr/bin/env python3
"""Encode signed RedStone numeric packages. Does not sign, trust JSON signer labels or broadcast."""
import argparse
import base64
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
from redstone_common import select_snapshot


def encode_packages(packages):
    result = bytearray()
    for package in packages:
        points = sorted(package["dataPoints"], key=lambda p: p["dataFeedId"].encode().ljust(32, b"\0"))
        if not points or len({p["dataFeedId"] for p in points}) != len(points):
            raise ValueError("Empty or duplicate feed identifiers")
        for point in points:
            symbol = point["dataFeedId"].encode("ascii")
            if not symbol or len(symbol) > 32 or point.get("decimals", 8) != 8 or point.get("valueByteSize", 32) != 32:
                raise ValueError("Only standard eight-decimal numeric feeds are supported")
            value = int((Decimal(str(point["value"])) * 10**8).to_integral_value(rounding=ROUND_HALF_UP))
            result.extend(symbol.ljust(32, b"\0"))
            result.extend(value.to_bytes(32, "big"))
        result.extend(int(package["timestampMilliseconds"]).to_bytes(6, "big"))
        result.extend((32).to_bytes(4, "big"))
        result.extend(len(points).to_bytes(3, "big"))
        signature = base64.b64decode(package["signature"], validate=True)
        if len(signature) != 65:
            raise ValueError("Expected 65-byte signature")
        result.extend(signature)
    result.extend(len(packages).to_bytes(2, "big"))
    result.extend(b"\0\0\0")  # empty unsigned metadata
    result.extend(bytes.fromhex("000002ed57011e0000"))
    return bytes(result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    response = select_snapshot(json.loads(args.input.read_text()))
    # Keep package contents/signatures intact; a package may contain both requested feeds.
    packages = []
    seen = set()
    for feed in ("USDC", "ETH"):
        if feed not in response:
            raise SystemExit(f"Missing {feed} packages")
        for package in response[feed]:
            key = package["signature"]
            if key not in seen:
                seen.add(key)
                packages.append(package)
    args.output.write_bytes(encode_packages(packages))
    print(f"Encoded {len(packages)} packages; verify signatures and freshness in Solidity before use.")
