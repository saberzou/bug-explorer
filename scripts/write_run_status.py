#!/usr/bin/env python3
"""Write the daily-add run status so the watchdog has a machine-readable signal.

Called at the END of every daily-add cron run (success OR failure). This is a
content-side status reporter, NOT part of the validation gate — it never blocks
a commit and never inspects image quality. Atticus's watchdog reads
data/last_daily_run.json to confirm the daily job is alive.

Usage:
    python3 scripts/write_run_status.py --status ok \
        --slug some-bug --common "Some Bug" --discovered 2026-06-26
    python3 scripts/write_run_status.py --status blocked --note "image provider geo-blocked"
    python3 scripts/write_run_status.py --status error --note "gate failed on dedup"

status ∈ ok | blocked | error
  ok      -> a complete, validated specimen was committed this run
  blocked -> ran cleanly but shipped nothing on purpose (e.g. image geo-blocked)
  error   -> the run failed (gate red, fetch failed, exception)
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"
STATUS_PATH = ROOT / "data" / "last_daily_run.json"


def bug_count() -> int:
    try:
        data = json.loads(BUGS_PATH.read_text())
        bugs = data["bugs"] if isinstance(data, dict) else data
        return len(bugs)
    except Exception:
        return -1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", required=True, choices=["ok", "blocked", "error"])
    ap.add_argument("--slug", default=None)
    ap.add_argument("--common", default=None)
    ap.add_argument("--discovered", default=None)
    ap.add_argument("--note", default=None)
    args = ap.parse_args()

    payload = {
        "status": args.status,
        "date": datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d"),
        "slug": args.slug,
        "commonName": args.common,
        "discoveredOn": args.discovered,
        "ranAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": args.note,
        "bugCount": bug_count(),
    }
    STATUS_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {STATUS_PATH.name}: status={args.status} slug={args.slug} bugs={payload['bugCount']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
