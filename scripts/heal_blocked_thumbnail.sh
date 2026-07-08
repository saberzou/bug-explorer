#!/bin/bash
# Self-healing regen for the Bug Explorer nightly specimen when its thumbnail was
# BLOCKED at generation time (not merely stranded after generation).
#
# WHY THIS EXISTS (2026-07-08):
# The Bug Explorer nightly pipeline is PREP (01:35) -> FINISH (01:50) ->
# FINISH-SWEEP (02:10). PREP writes the data row + photos + prompt +
# .daily_prep_state.json. FINISH generates public/bugs/<slug>.png, runs the hard
# gate, commits, pushes. FINISH-SWEEP rescues a specimen whose thumb ALREADY
# exists but got stranded before commit.
#
# NONE of those can help when image_generate NEVER produced the PNG — e.g. when
# the host proxy (Shadowrocket) resolves api.openai.com / the Google endpoint into
# the 198.18.x.x fake-IP pool and OpenClaw's SSRF guard (correctly) refuses the
# request on its DNS pre-check. On those nights the row + photos + prompt land and
# get synced, but public/bugs/<slug>.png is simply missing, and FINISH-SWEEP's
# step 3 explicitly bails ("prepped but NO thumbnail ... needs a real re-run, not
# a net"). Worse: the next night's PREP overwrites .daily_prep_state.json in place,
# silently losing the blocked specimen (this is exactly how lichen-katydid was lost
# on 2026-07-07).
#
# This is the Bug Explorer twin of the Artist Study heal-blocked-artwork.sh
# (2026-07-06). It closes the blocked-thumbnail gap WITHOUT ever touching the SSRF
# guard or host DNS:
#   1. Read .daily_prep_state.json. If the slug's thumb already exists -> no-op.
#   2. Only proceed if networking is CLEAN — the image endpoints must resolve to a
#      REAL public IP (not 198.18.x fake-IP) on BOTH the app-layer resolver
#      (python getaddrinfo) AND the system stub resolver (nslookup), because the
#      SSRF guard resolves like nslookup. If still fake-IP on either, exit quietly
#      and retry next run. Self-heals the moment the proxy's fake-IP mapping clears.
#   3. When needed AND possible, fire an ISOLATED agent turn (image_generate is an
#      agent tool, not a CLI) that regenerates from the EXACT stored prompt file,
#      places the PNG at public/bugs/<slug>.png, then immediately runs the gated
#      finish_sweep.sh to hard-gate + commit + push it (so a daytime heal ships now
#      instead of waiting up to ~24h for the 02:10 nightly sweep).
#
# Idempotent + safe: never overwrites an existing thumbnail; never disables a
# safeguard; never commits by hand (finish_sweep.sh owns the gated ship); a no-op
# when the PNG already exists or networking is still blocked.
#
# Usage: bash scripts/heal_blocked_thumbnail.sh   (cd's to repo itself)

set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

REPO="/Users/saberzou/OpenClawProjects/axel/bug-explorer"
cd "$REPO" || { echo "HEAL ERROR: repo missing $REPO"; exit 1; }
STATE="data/.daily_prep_state.json"
LOG="/Users/saberzou/.openclaw/workspace-axel/findings/bug-heal.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Image API hosts whose DNS we treat as the networking-clean signal.
HOSTS=("api.openai.com" "generativelanguage.googleapis.com")

# --- networking-clean gate -------------------------------------------------
# Returns 0 (clean) only if at least one image host resolves to a NON-fake-IP on
# BOTH the app-layer resolver (python getaddrinfo) AND the system stub resolver
# (nslookup). During a Shadowrocket fake-IP flap the two can DISAGREE for the same
# host: python/dscacheutil return the cached clean public IP while nslookup still
# returns 198.18.x. The SSRF guard resolves like nslookup, so requiring nslookup
# to ALSO be clean makes this gate match what the guard actually sees. (Learned
# the hard way 2026-07-08: python said clean, guard still blocked.)
_is_blocked_ip() {
  case "$1" in
    198.18.*|198.19.*) return 0 ;;                 # benchmarking fake-IP pool
    10.*|127.*|0.*|169.254.*) return 0 ;;          # private / loopback / link-local
    192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
    "") return 0 ;;                                 # empty = treat as not-clean
  esac
  return 1
}

is_networking_clean() {
  local h py ns
  for h in "${HOSTS[@]}"; do
    py=$(python3 - "$h" <<'PY' 2>/dev/null
import socket, sys
try:
    print(socket.gethostbyname(sys.argv[1]))
except Exception:
    pass
PY
)
    _is_blocked_ip "$py" && continue
    ns=$(nslookup "$h" 2>/dev/null | awk '/^Address: /{a=$2} END{print a}')
    _is_blocked_ip "$ns" && continue
    echo "$py"
    return 0
  done
  return 1
}

# --- 1. is anything pending? ----------------------------------------------
if [ ! -f "$STATE" ]; then echo "Heal: no prep handoff, nothing pending."; exit 0; fi

SLUG=$(python3 -c "import json;print(json.load(open('$STATE'))['slug'])" 2>/dev/null)
COMMON=$(python3 -c "import json;print(json.load(open('$STATE')).get('commonName',''))" 2>/dev/null)
LATIN=$(python3 -c "import json;print(json.load(open('$STATE')).get('latinName',''))" 2>/dev/null)
DISC=$(python3 -c "import json;print(json.load(open('$STATE')).get('discovered',''))" 2>/dev/null)
PROMPT_FILE=$(python3 -c "import json;print(json.load(open('$STATE')).get('promptFile',''))" 2>/dev/null)
[ -z "$SLUG" ] && { echo "Heal: prep state unreadable, leaving for a human."; log "PENDING note=state-unreadable"; exit 0; }

CANON="public/bugs/$SLUG.png"

# --- 2. thumb already there? -> nothing blocked ---------------------------
if [ -f "$CANON" ]; then echo "Heal: $SLUG thumbnail already present — nothing blocked, FINISH-SWEEP will ship it."; exit 0; fi

# Prompt file must still exist to regen from.
[ -z "$PROMPT_FILE" ] && PROMPT_FILE="public/bugs/.prompt-$SLUG.txt"
if [ ! -f "$PROMPT_FILE" ]; then echo "Heal: $SLUG has no thumb AND no prompt file ($PROMPT_FILE) — cannot regen, needs a real re-run."; log "PENDING slug=$SLUG note=no-prompt-file"; exit 0; fi

# --- 3. networking-clean gate ---------------------------------------------
CLEAN_IP=$(is_networking_clean) || {
  echo "Heal: $SLUG thumb missing but networking still blocked (image hosts on fake-IP pool). Deferring — will retry next run."
  log "DEFER slug=$SLUG note=fake-IP-blocked"
  exit 0
}

echo "Heal: $SLUG thumb missing, networking clean (resolved public IP $CLEAN_IP). Firing regen agent turn."
log "HEAL slug=$SLUG networking-clean ip=$CLEAN_IP — dispatching regen"

# --- 4. dispatch isolated regen agent turn --------------------------------
# image_generate is an AGENT tool, so drive an isolated agent turn. The turn reads
# the stored prompt verbatim, generates, and places the PNG at the canonical path.
# It must NOT commit — the gated FINISH-SWEEP (02:10) owns the ship decision.
read -r -d '' AGENT_MSG <<EOF || true
[HEAL BLOCKED BUG THUMBNAIL] Networking is clean again. Regenerate the missing Bug Explorer daily thumbnail.

Repo: ${REPO}
Slug: ${SLUG}
Common name: ${COMMON}
Discovered: ${DISC}
Canonical output PNG (must end up here): ${REPO}/${CANON}
Stored prompt file: ${REPO}/${PROMPT_FILE}

Steps:
1. Read the stored prompt file verbatim as the image prompt (do NOT rewrite it).
2. Call image_generate with size 1024x1024, filename "${SLUG}.png". If the default endpoint is still blocked, try model openai/gpt-image-2 then google/gemini-3-pro-image-preview.
3. Once it lands in the media tool-output dir, cp the newest matching file to exactly ${REPO}/${CANON} (never overwrite if it already exists).
4. Confirm ${REPO}/${CANON} exists. If it does NOT (still blocked / gen failed), STOP and report: still-blocked.
5. If it DOES exist, immediately ship it through the gated safety-net so it does not sit uncommitted until the nightly 02:10 sweep:
     bash ${REPO}/scripts/finish_sweep.sh
   That script runs the hard gate and only commits+pushes if green; it is idempotent and safe to call now. Report one line with its result (e.g. 'healed + shipped ${SLUG}' or the sweep's PENDING/gate-red line). Do NOT commit or push by hand — let finish_sweep.sh own the gated ship.
EOF

if openclaw agent --agent axel --deliver --message "$AGENT_MSG" >> "$LOG" 2>&1; then
  sleep 2
  if [ -f "$CANON" ]; then
    echo "Heal: HEALED $SLUG — thumbnail regenerated; regen turn runs finish_sweep.sh to gate+ship it."
    log "HEALED slug=$SLUG note=thumb-regenerated-sweep-chained"
  else
    echo "Heal: $SLUG regen dispatched (async); PNG not yet on disk. Next run will confirm/retry."
    log "PENDING slug=$SLUG note=regen-dispatched-async"
  fi
else
  echo "Heal: ERROR dispatching regen agent turn for $SLUG."
  log "ERROR slug=$SLUG note=dispatch-failed"
  exit 1
fi

exit 0
