Backup of Bug Explorer FINISH cron (4d864a43-7d2a-4eec-a96b-820d92144776) payload.message
Taken 2026-07-12 before the flap-resilience patch.
Restore by copying the block below back into the cron payload.message if the fix misbehaves.

--- see git / cron history for the verbatim pre-patch text (captured in transcript 2026-07-12) ---
Key pre-patch behaviors being changed:
1. STEP 1 image provider: model="openai/gpt-image-1.5" only, "Google is geo-blocked" note, no bypass fallback.
2. GRACEFUL SKIP: git checkout -- data/bugs.json; rm -f public/bugs/<slug>.png public/bugs/.prompt-<slug>.txt data/.daily_prep_state.json; git clean -fd photos; git checkout -- data/bug_photos.json  (DELETES healer inputs).
