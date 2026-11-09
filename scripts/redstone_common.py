"""Client selection is a convenience; Solidity performs authoritative signature/quorum checks."""


def select_snapshot(response):
    candidates = {}
    for feed in ("USDC", "ETH"):
        groups = {}
        for package in response.get(feed, []):
            timestamp = int(package["timestampMilliseconds"])
            groups.setdefault(timestamp, {})[package["signature"]] = package
        candidates[feed] = {timestamp: list(rows.values()) for timestamp, rows in groups.items() if len(rows) >= 3}
    common = candidates["USDC"].keys() & candidates["ETH"].keys()
    if not common:
        raise ValueError("No common ETH/USDC timestamp with three candidate packages per feed")
    timestamp = max(common)
    return {feed: groups[timestamp] for feed, groups in candidates.items()}
