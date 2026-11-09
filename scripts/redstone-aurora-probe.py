#!/usr/bin/env python3
"""Unsigned, ephemeral RPC checks only. The historical diagnostic intentionally does not validate freshness."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()


def selector(signature):
    return subprocess.check_output(["cast", "sig", signature], text=True).strip()


def rpc(endpoint, method, params):
    request = urllib.request.Request(endpoint, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json", "User-Agent": "Wayfund-readonly-proof"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


probe = json.loads((ROOT / "out/RedstoneSignatureProbe.sol/RedstoneSignatureProbe.json").read_text())["deployedBytecode"]["object"]
compiled = json.loads((ROOT / "out/RedstonePortfolioOracle.sol/RedstonePortfolioOracle.json").read_text())["deployedBytecode"]
runtime = bytearray.fromhex(compiled["object"].removeprefix("0x"))
references = compiled["immutableReferences"]
if len(references) != 1:
    raise SystemExit("Unexpected immutable layout; re-review before using overrides")
for locations in references.values():
    for entry in locations:
        runtime[entry["start"]:entry["start"] + entry["length"]] = (60).to_bytes(entry["length"], "big")
production = "0x" + runtime.hex()
payload = (ROOT / "test/fixtures/redstone-primary-historical.bin").read_bytes()
tampered = bytearray(payload)
tampered[63] ^= 1
address = "0x1000000000000000000000000000000000000001"
rows = []
for endpoint in ("https://testnet.aurora.dev", "https://mainnet.aurora.dev"):
    block = rpc(endpoint, "eth_getBlockByNumber", ["latest", False])["result"]
    cases = [
        ("authentic_historical_signature_diagnostic", probe, selector("inspect()") + payload.hex(), None),
        ("tampered_signature_rejected", probe, selector("inspect()") + tampered.hex(), "SignerNotAuthorised(address)"),
        ("production_stale_data_rejected", production, selector("update()") + payload.hex(), "StalePublication(uint256)"),
    ]
    for label, code, data, expected_error in cases:
        response = rpc(endpoint, "eth_call", [{"to": address, "data": data, "gas": "0x1e8480"}, block["number"], {address: {"code": code}}])
        if expected_error:
            if "error" not in response or selector(expected_error)[2:].lower() not in json.dumps(response).lower():
                raise SystemExit(f"Expected error missing: {label}: {response}")
        else:
            result = response.get("result", "")[2:]
            values = [int(result[i:i+64], 16) for i in range(0, len(result), 64)]
            if values != [99988697, 348695203485, 1719856900000]:
                raise SystemExit(f"Unexpected verification result: {values}")
        rows.append({"endpoint": endpoint, "block": block["number"], "block_timestamp": int(block["timestamp"], 16), "case": label, "runtime_sha256": hashlib.sha256(bytes.fromhex(code.removeprefix("0x"))).hexdigest(), "response": response})
        print(f"PASS {endpoint}: {label}")
args.output.write_text(json.dumps(rows, indent=2) + "\n")
