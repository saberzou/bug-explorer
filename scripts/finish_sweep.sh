#!/bin/bash
# Safety-net sweep for the Bug Explorer nightly FINISH cron.
#
# WHY THIS EXISTS (2026-06-29):
# PREP (01:35) writes the data row + photos + prompt + .daily_prep_state.json and
# hands off. FINISH (01:50) generates the thumbnail, runs the hard gate, commits,
# pushes, announces. On some nights FINISH hits the known intermittent post-prep
# tail-abort ("AbortError: aborted", ~31/35/38/95s, ~4 of 12 runs) AFTER the
# image lands but BEFORE the commit+push, stranding a complete, gate-ready
# specimen in the working tree. The site stays frozen at yesterday's frontier
# (e.g. Pelican Spider stranded behind Ogre-faced on 2026-06-29, shipped by hand).
#
# This net runs ~02:10, AFTER FINISH (01:50). It only acts when prep is stranded:
# state file present + thumbnail present + gate green + unpushed. Then it commits
# atomically + pushes. It does NOT regenerate images (no creds/long step here) —
# if the thumb is missing or gate is red, it reports and leaves it for a human/agent.
# Idempotent: if FINISH already shipped, prints "nothing to ship" and exits clean.
#
# Usage: bash scripts/finish_sweep.sh   (from repo root; cd's there itself)

set -uo pipefail
REPO="/Users/saberzou/OpenClawProjects/axel/bug-explorer"
cd "$REPO" || { echo "SWEEP ERROR: repo missing $REPO"; exit 1; }
STATE="data/.daily_prep_state.json"

# 1. No prep handoff → nothing was prepped, or FINISH already cleaned it after shipping.
if [ ! -f "$STATE" ]; then echo "Sweep: no prep handoff, nothing stranded."; exit 0; fi

SLUG=$(python3 -c "import json;print(json.load(open('$STATE'))['slug'])" 2>/dev/null)
COMMON=$(python3 -c "import json;print(json.load(open('$STATE'))['commonName'])" 2>/dev/null)
LATIN=$(python3 -c "import json;print(json.load(open('$STATE'))['latinName'])" 2>/dev/null)
DISC=$(python3 -c "import json;print(json.load(open('$STATE'))['discovered'])" 2>/dev/null)
[ -z "$SLUG" ] && { echo "Sweep: prep state unreadable, leaving for a human."; exit 0; }

# 2. Already pushed? frontier slug live → idempotent no-op.
git fetch -q origin main 2>/dev/null
if git show origin/main:data/bugs.json 2>/dev/null | python3 -c "import json,sys;b=json.load(sys.stdin);b=b if isinstance(b,list) else b.get('bugs',b);sys.exit(0 if b and b[-1].get('slug')=='$SLUG' else 1)"; then
  echo "Sweep: $SLUG already live on origin — nothing to ship."; rm -f "$STATE"; exit 0
fi

# 3. Thumb must already exist — sweep does NOT regenerate.
if [ ! -f "public/bugs/$SLUG.png" ]; then echo "Sweep: $SLUG prepped but NO thumbnail — FINISH never generated it; needs a real re-run, not a net. Leaving tree intact."; exit 0; fi

# 4. Hard gate must be green.
rm -f public/bugs/.prompt-$SLUG.txt
if ! python3 scripts/validate_bug.py --frontier >/dev/null 2>&1; then echo "Sweep: $SLUG gate RED — not auto-shipping. Needs image fix. Tree left intact."; exit 0; fi

# 5. Stranded + green → finish it.
git add data/bugs.json public/bugs/$SLUG.png data/bug_photos.json public/bugs/photos/$SLUG/ 2>/dev/null
git commit -q -m "Add $COMMON ($LATIN) — daily specimen $DISC (finish-sweep)" || { echo "Sweep: nothing staged, already committed; just pushing."; }
python3 scripts/write_run_status.py --status ok --slug "$SLUG" --common "$COMMON" --discovered "$DISC" >/dev/null 2>&1
git add data/last_daily_run.json 2>/dev/null && git commit -q -m "chore: daily-run status $DISC (finish-sweep)" 2>/dev/null
rm -f "$STATE"
git pull --rebase -q origin main && git push -q origin main && echo "Sweep: RESCUED $COMMON — committed+pushed." || { echo "Sweep: push failed."; exit 1; }
