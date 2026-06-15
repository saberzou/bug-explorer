#!/usr/bin/env python3
"""Watchdog gate for the Bug Explorer daily-add cron.

Single source of truth for "did the daily job run, and did it run cleanly?"
The watchdog cron (Atticus) is a thin caller: it execs this script, reads the
exit code + one-line JSON on stdout, and routes the alert. ALL judgment lives
here; the caller owns only routing.

DESIGN CONTRACT
---------------
The heartbeat of the system is: did a daily-add run write a FRESH, today-dated
entry to data/last_daily_run.json? The queue runs ~10 days ahead of real time,
so discoveredOn in bugs.json is informational ONLY and is never a gate. A
today-dated row in bugs.json would false-alarm every healthy night for ~10
days. The status file is the sole gate.

last_daily_run.json status enum (written by write_run_status.py):
  ok        -> a complete, validated specimen was committed this run
  blocked   -> ran cleanly but shipped nothing on purpose (e.g. image geo-blocked)
  error     -> the run failed (gate red, fetch failed, exception)
  bootstrap -> seed value before the first real scheduled run (not yet armed)

EXIT CODES (what the watchdog caller routes on)
  0 = healthy        -> today's run landed with status=ok        -> stay silent
  1 = silent_failure -> no run today / file stale / file missing  -> alert Saber DM
  2 = content_failure-> ran today but status=blocked|error        -> ping Atticus in group, NOT Saber DM
  3 = seed           -> status=bootstrap, no real run expected yet -> stay silent

STDOUT (one-line JSON, always emitted)
  {"verdict":"healthy|silent_failure|content_failure|seed",
   "date":<status file date|null>,
   "expected_date":"YYYY-MM-DD",
   "status":"ok|blocked|error|bootstrap|missing",
   "slug":<str|null>,
   "commit":<sha|null>,
   "detail":"<one human sentence>"}

The script answers "did today's run happen?" by testing
  last_daily_run.date == today (local CST)
i.e. the cron executed today and wrote a fresh status. A run that wrote
{date:today, status:error} is a CONTENT failure (system alive, exit 2). A run
that never wrote {date:today} at all is a SILENT failure (exit 1).
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = ROOT / "data" / "last_daily_run.json"

EXIT_HEALTHY = 0
EXIT_SILENT = 1
EXIT_CONTENT = 2
EXIT_SEED = 3


def today_local() -> str:
    """Today's date in the host's local timezone (gateway runs CST)."""
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")


def head_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        sha = out.stdout.strip()
        return sha or None
    except Exception:
        return None


def emit(verdict: str, status: str, expected: str, *, date=None, slug=None,
         detail: str, commit=None) -> dict:
    return {
        "verdict": verdict,
        "date": date,
        "expected_date": expected,
        "status": status,
        "slug": slug,
        "commit": commit if commit is not None else head_commit(),
        "detail": detail,
    }


def main() -> int:
    expected = today_local()

    # --- file missing entirely -> silent failure ---
    if not STATUS_PATH.exists():
        payload = emit(
            "silent_failure", "missing", expected,
            detail=f"Status file {STATUS_PATH.name} is missing; daily-add job has never reported.",
        )
        print(json.dumps(payload))
        return EXIT_SILENT

    # --- file unreadable / corrupt -> silent failure ---
    try:
        data = json.loads(STATUS_PATH.read_text())
    except Exception as exc:
        payload = emit(
            "silent_failure", "missing", expected,
            detail=f"Status file {STATUS_PATH.name} is unreadable ({exc.__class__.__name__}); treating as silent failure.",
        )
        print(json.dumps(payload))
        return EXIT_SILENT

    status = data.get("status")
    run_date = data.get("date")
    slug = data.get("slug")
    common = data.get("commonName")
    note = data.get("note")

    # --- seed / not yet armed -> silent, no alarm ---
    if status == "bootstrap":
        payload = emit(
            "seed", "bootstrap", expected, date=run_date, slug=slug,
            detail="Status file is still the bootstrap seed; first scheduled run has not happened yet.",
        )
        print(json.dumps(payload))
        return EXIT_SEED

    # --- stale: ran some prior day but not today -> silent failure ---
    if run_date != expected:
        last = run_date or "never"
        label = common or slug or "unknown specimen"
        payload = emit(
            "silent_failure", status or "missing", expected, date=run_date, slug=slug,
            detail=(
                f"Bug Explorer didn't update today ({expected}). "
                f"Last good run was {last}"
                + (f", slug {slug} ({label})" if slug else "")
                + f". Status file shows status={status!r}."
            ),
        )
        print(json.dumps(payload))
        return EXIT_SILENT

    # --- ran today: now branch on status quality ---
    if status == "ok":
        label = common or slug or "a specimen"
        payload = emit(
            "healthy", "ok", expected, date=run_date, slug=slug,
            detail=f"Healthy: today's run committed {label}" + (f" ({slug})" if slug else "") + ".",
        )
        print(json.dumps(payload))
        return EXIT_HEALTHY

    if status in ("blocked", "error"):
        reason = note or ("ran but shipped nothing" if status == "blocked" else "run failed")
        payload = emit(
            "content_failure", status, expected, date=run_date, slug=slug,
            detail=(
                f"Bug Explorer ran today but status={status!r}: {reason}. "
                f"System is alive; this is a content problem, not a dead cron."
            ),
        )
        print(json.dumps(payload))
        return EXIT_CONTENT

    # --- unknown status value but dated today -> treat as content failure, fail loud-ish ---
    payload = emit(
        "content_failure", status or "missing", expected, date=run_date, slug=slug,
        detail=f"Run reported today with unrecognized status={status!r}; routing as content failure for review.",
    )
    print(json.dumps(payload))
    return EXIT_CONTENT


if __name__ == "__main__":
    raise SystemExit(main())
