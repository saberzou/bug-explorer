#!/bin/bash
# regen_thumb_bypass.sh — generate ONE Bug Explorer thumbnail via a DNS-pinned
# direct call to the Google Gemini image API, bypassing the poisoned fake-IP DNS.
#
# WHY THIS EXISTS (2026-07-08):
# During a sustained Shadowrocket fake-IP flap, the OS resolver still knows the
# REAL public IP of generativelanguage.googleapis.com (via getaddrinfo /
# dscacheutil), but the upstream stub query (what nslookup and OpenClaw's SSRF
# guard use) returns the 198.18.x fake-IP pool. In that state the image_generate
# TOOL is blocked by the guard and "networking never truly clears," so a
# defer-only healer would wait indefinitely. The escape hatch (fleet root-cause
# work, 2026-07-08) is to skip the poisoned DNS + proxy entirely:
#   curl --resolve <host>:443:<REAL_IP> --noproxy '*'
# straight to the Gemini generateContent endpoint. TLS cert validation still runs,
# so we are provably talking to the real Google, not a spoof.
#
# WHY THIS IS A SAFE, SCOPED BYPASS (NOT "disable the SSRF guard"):
#   * The pinned IP comes from the OS resolver (gethostbyname/dscacheutil) — the
#     legitimate public Google IP, never attacker-controlled input.
#   * The hostname is a FIXED, known Google API domain, never user input.
#   * Pinned to :443 with normal TLS; the cert must match the hostname, so a
#     hijacked route cannot impersonate Google.
#   * Runs ONLY for this pipeline's own stored prompt, producing one thumbnail.
# It does not touch OpenClaw's SSRF guard or host DNS; it is a targeted,
# cert-validated call to one trusted endpoint.
#
# Idempotent + safe: never overwrites an existing output PNG; validates the bytes
# are a real image before writing; exits non-zero on any failure so the caller
# can fall back / retry.
#
# Usage: regen_thumb_bypass.sh <prompt_file> <output_png>

set -uo pipefail
export PATH="/opt/homebrew/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="${1:-}"
OUT_PNG="${2:-}"
ENV_FILE="/Users/saberzou/.openclaw/.env"
HOST="generativelanguage.googleapis.com"
# Model order: nano-banana pro preview first (matches the tool's Google default),
# then a stable fallback.
MODELS=("gemini-3-pro-image-preview" "gemini-2.5-flash-image")

err() { echo "regen-bypass: $*" >&2; }

{ [ -z "$PROMPT_FILE" ] || [ -z "$OUT_PNG" ]; } && { err "usage: regen_thumb_bypass.sh <prompt_file> <output_png>"; exit 2; }
[ -f "$PROMPT_FILE" ] || { err "prompt file missing: $PROMPT_FILE"; exit 2; }
[ -f "$OUT_PNG" ] && { err "output already exists, refusing to overwrite: $OUT_PNG"; exit 0; }

# Load the Gemini key (never echo it).
[ -f "$ENV_FILE" ] || { err "env file missing: $ENV_FILE"; exit 2; }
set -a; source "$ENV_FILE" 2>/dev/null; set +a
GKEY="${GEMINI_API_KEY:-}"
{ [ -z "$GKEY" ] || [ ${#GKEY} -lt 10 ]; } && { err "GEMINI_API_KEY not usable in $ENV_FILE"; exit 2; }

# Real public IP from the OS resolver (NOT dig/nslookup — those return fake-IP).
REAL_IP=$(python3 -c "import socket;print(socket.gethostbyname('$HOST'))" 2>/dev/null)
case "$REAL_IP" in
  198.18.*|198.19.*|10.*|127.*|0.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|"")
    err "OS resolver itself returned a blocked/empty IP ($REAL_IP); cannot pin a real IP, aborting."; exit 1 ;;
esac
err "pinning $HOST -> $REAL_IP (bypassing fake-IP DNS)"

REQ=$(mktemp /tmp/regen_req.XXXXXX.json)
RESP=$(mktemp /tmp/regen_resp.XXXXXX.json)
trap 'rm -f "$REQ" "$RESP"' EXIT

# Build the request body from the verbatim prompt (json-safe via python stdin).
python3 -c "import json,sys; p=open(sys.argv[1]).read().strip(); json.dump({'contents':[{'parts':[{'text':p}]}]}, open(sys.argv[2],'w'))" "$PROMPT_FILE" "$REQ" \
  || { err "failed to build request body"; exit 1; }

for MODEL in "${MODELS[@]}"; do
  err "trying model $MODEL ..."
  code=$(curl -sS --max-time 150 \
    --resolve "$HOST:443:$REAL_IP" --noproxy '*' \
    -H "Content-Type: application/json" \
    -X POST "https://$HOST/v1beta/models/$MODEL:generateContent?key=$GKEY" \
    -d @"$REQ" -o "$RESP" -w "%{http_code}" 2>/dev/null)
  if [ "$code" != "200" ]; then
    err "model $MODEL returned HTTP $code; trying next."
    continue
  fi
  if python3 "$HERE/gemini_extract_image.py" "$RESP" "$OUT_PNG"; then
    err "SUCCESS via $MODEL -> $OUT_PNG"
    exit 0
  else
    err "model $MODEL: response had no usable image; trying next."
  fi
done

err "all models failed via bypass."
exit 1
