#!/bin/bash
# prep_guard.sh — run at the TOP of PREP's STEP 0, BEFORE clearing state.
#
# WHY THIS EXISTS (2026-07-08):
# PREP historically did an UNCONDITIONAL cleanup at the start of each night:
#     rm -f data/.daily_prep_state.json
#     git clean -fd public/bugs/photos/ public/bugs/
# If the PREVIOUS night prepped a specimen that FINISH never shipped (e.g. the
# thumbnail was blocked by the fake-IP flap), that blind wipe DELETED the whole
# un-shipped prep with no trace. That is exactly how lichen-katydid (2026-07-07)
# was silently lost.
#
# This guard makes the pre-clear step SAFE: before anything is wiped, it checks
# whether the existing state points to a specimen that is NOT yet live on origin.
# If so, it makes ONE rescue attempt via heal_blocked_thumbnail.sh (which now
# ships-during-a-flap through the DNS-pinned bypass), then re-checks. Whatever the
# outcome, it LOGS it, so an un-shipped specimen can never vanish silently again.
#
# It NEVER force-ships past the hard gate and NEVER overwrites a live specimen. It
# only rescues-or-records before the normal clear proceeds. After this returns,
# PREP does its usual clean for the new night.
#
# Exit code is always 0 (advisory guard; PREP continues regardless). All outcomes
# go to the log + stdout.
#
# Usage: bash scripts/prep_guard.sh
set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"
REPO="/Users/saberzou/OpenClawProjects/axel/bug-explorer"
cd "$REPO" || exit 0
STATE="data/.daily_prep_state.json"
LOG="/Users/saberzou/.openclaw/workspace-axel/findings/prep-guard.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
log(){ echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

# No leftover state -> nothing to protect, normal clear can proceed.
if [ ! -f "$STATE" ]; then echo "prep-guard: no leftover state, clean start."; log "CLEAN-START note=no-leftover-state"; exit 0; fi

SLUG=$(python3 -c "import json;print(json.load(open('$STATE')).get('slug',''))" 2>/dev/null)
DISC=$(python3 -c "import json;print(json.load(open('$STATE')).get('discovered',''))" 2>/dev/null)
if [ -z "$SLUG" ]; then echo "prep-guard: leftover state unreadable; recording before clear."; log "UNREADABLE-STATE cleared"; exit 0; fi

# Is this slug already live on origin? If yes, it shipped -> safe to clear.
git fetch -q origin main 2>/dev/null
if git show origin/main:data/bugs.json 2>/dev/null | python3 -c "import json,sys; b=json.load(sys.stdin); b=b if isinstance(b,list) else b.get('bugs',b); sys.exit(0 if b and any(x.get('slug')=='$SLUG' for x in b) else 1)"; then
  echo "prep-guard: previous specimen $SLUG already live on origin; safe to clear."
  log "OK slug=$SLUG note=already-live-safe-clear"
  exit 0
fi

# Un-shipped specimen from a prior night. Try ONE rescue before it gets wiped.
echo "prep-guard: previous specimen $SLUG ($DISC) is NOT live on origin — un-shipped. Attempting one rescue before clear."
log "UNSHIPPED slug=$SLUG disc=$DISC note=attempting-rescue"

# CRITICAL: snapshot the state (and prompt, if present) BEFORE calling the healer.
# The healer chains finish_sweep, which deletes data/.daily_prep_state.json as part
# of its cleanup even when it does NOT ship the bug — so if we waited until after
# the rescue to preserve, the file would already be gone (learned 2026-07-08). We
# snapshot first, then delete the snapshot only if the rescue actually shipped.
SAVE="$REPO/data/unshipped-$SLUG-$DISC.json"
cp "$STATE" "$SAVE" 2>/dev/null && log "SNAPSHOT slug=$SLUG saved=$SAVE" || log "SNAPSHOT-FAILED slug=$SLUG"
PROMPT_SRC=$(python3 -c "import json;print(json.load(open('$STATE')).get('promptFile',''))" 2>/dev/null)
[ -z "$PROMPT_SRC" ] && PROMPT_SRC="public/bugs/.prompt-$SLUG.txt"
if [ -f "$REPO/$PROMPT_SRC" ]; then
  cp "$REPO/$PROMPT_SRC" "$REPO/data/unshipped-$SLUG-$DISC.prompt.txt" 2>/dev/null || true
fi

bash "$REPO/scripts/heal_blocked_thumbnail.sh" >> "$LOG" 2>&1 || true

# Re-check: did the rescue land it live?
git fetch -q origin main 2>/dev/null
if git show origin/main:data/bugs.json 2>/dev/null | python3 -c "import json,sys; b=json.load(sys.stdin); b=b if isinstance(b,list) else b.get('bugs',b); sys.exit(0 if b and any(x.get('slug')=='$SLUG' for x in b) else 1)"; then
  echo "prep-guard: RESCUED $SLUG — it is now live on origin. Clearing state for the new night is safe."
  log "RESCUED slug=$SLUG note=healed-before-prep-clear"
  # Shipped fine — the snapshot is no longer needed.
  rm -f "$SAVE" "$REPO/data/unshipped-$SLUG-$DISC.prompt.txt" 2>/dev/null
else
  # Could not rescue (still flapping AND OS resolver also poisoned, or gate red).
  # The pre-rescue snapshot survives so a human / the next heal run can recover it,
  # and it is surfaced loudly in the log instead of vanishing.
  if [ -f "$SAVE" ]; then
    echo "prep-guard: could not rescue $SLUG; its state is preserved at $SAVE (NOT lost silently)."
    log "LOSS-PREVENTED slug=$SLUG disc=$DISC saved=$SAVE note=rescue-failed-snapshot-kept"
  else
    echo "prep-guard: could not rescue $SLUG and snapshot failed — surfacing loudly in log."
    log "LOSS slug=$SLUG disc=$DISC note=rescue-failed-AND-snapshot-failed"
  fi
fi
exit 0
