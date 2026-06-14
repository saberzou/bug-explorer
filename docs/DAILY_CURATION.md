# Daily Curation Job — Bug Explorer

A stable, long-running content job for the OpenClaw agents (Axel & co). It adds
**one new specimen per day** to the grid, with two non-negotiable guarantees:

1. **No duplicates** — every specimen is a genuinely new species.
2. **Quality + stays in the circle** — the thumbnail is a crisp square PNG and
   the insect (legs, antennae, wings, tails, shadow) sits fully inside the
   circular crop, never amputated.

The job is **gated**: it may only commit when `scripts/validate_bug.py` exits 0.
That script is the contract — everything below exists to get a clean pass.

---

## Cadence & ownership

- **When:** once per day (cron). One specimen per run.
- **Who:** OpenClaw content agent (Axel). Atticus owns the framework/gate.
- **Where it writes:** the content-drop contract in [`README.md`](../README.md)
  and the schema in [`src/lib/types.ts`](../src/lib/types.ts). Do not break
  either without telling Atticus.
- **Idempotency:** a run either lands a *complete, validated* specimen (data row
  + image, both passing the gate) or it lands **nothing**. Never commit a half
  specimen (data without art, or art that fails the crop check).

---

## The daily procedure

### 1. Pick a species (rare, weird, real — and new)

- Real, documented species only. The hook is *weird-but-true*.
- Bias toward the **rare and surprising**; avoid the obvious garden bugs unless
  there's a genuinely strange fact.
- Honour the rarity mix (Axel's bias): ~60% common, 25% uncommon, 12% rare,
  3% legendary. Don't over-issue legendaries — scarcity is the point.
- **Must be new.** Check `data/bugs.json` before doing any work:
  - no existing `slug`, `commonName`, or `latinName` (case/accent-insensitive).
  - same *genus* as an existing bug is allowed but discouraged — keep the
    collection varied (the gate warns on genus repeats).

### 2. Write the data row

Append one object to `data/bugs.json` matching the schema in `types.ts`:

- `slug` — kebab-case, **stable forever** (drives URL, image path, hex coords).
- `commonName`, `latinName` (binomial), `habitat`.
- `sizeMm` + `sizeKind` (`"wingspan"` for moths/butterflies, else `"body"`).
- `weirdFact` (≤140 chars ideal), `whyItsCool` (≤160 chars ideal, voice/opinion).
- `rarity` ∈ `common | uncommon | rare | legendary`.
- `discoveredOn` — **frontier date**, ISO `YYYY-MM-DD`: `max(today, latest discoveredOn in the collection + 1 day)`. A new specimen always lands at the frontier (strictly after every existing bug) so the grid stays forward-only; never stamp it mid-timeline. The queue may run ahead of the wall-clock day — that's expected for a slowly-growing cabinet. (Backfilling an *older* species is a separate, deliberate act — don't use `--frontier` for it.)
- Optional: `order`, `family`, `colorPalette` (exactly 3 `#rrggbb`), `photos`.

### 3. Generate the thumbnail (circular-safe)

The grid and detail hero render the square PNG inside a **circle** (`object-cover`
+ `rounded-full`), so the corners and anything near the edge get clipped.

- Use `scripts/build_thumbnail_prompts.py` — its `STYLE_FOOTER` already encodes
  the **circular safe zone**: the whole insect inside the inscribed circle,
  ~60–68% of the frame, even margin, nothing reaching the edges/corners, long
  appendages curved inward, square cream fill to all four corners.
- Render at **1024×1024 PNG**, save to `public/bugs/<slug>.png`.
- Keep the established plate style: hand-drawn naturalist illustration, warm
  cream background, soft drop shadow, no text/labels of any kind.

### 4. Run the gate (must pass)

```bash
pip install pillow        # once; the image checks need it
python3 scripts/validate_bug.py        # validates today's cohort
```

The gate enforces:

- **Schema** — required fields, types, enums, ISO date, hex palette, kebab slug.
- **Dedup** — slug / common name / Latin name unique vs. the whole collection;
  genus repeat is a warning.
- **Image** — file exists, square, ≥1024², and for the cream-plate style the
  subject stays within `SAFE_RADIUS_FRAC` (0.94) of the circle radius with a
  sane coverage band. A photographic (non-plate) image warns that circle-safety
  can't be guaranteed — prefer plates for new bugs.

If it **fails on the image**: adjust the prompt (more padding, appendages
inward, smaller subject) and **re-generate, then re-run the gate**. Loop until
green. Do not relax the thresholds to force a pass.

A skipped image check (Pillow missing) counts as a **failure** for the job —
install Pillow and re-run.

### 5. Commit only on green

```bash
python3 scripts/validate_bug.py --frontier && \
  git add data/bugs.json public/bugs/<slug>.png && \
  git commit -m "Add <Common Name> (<Latin name>) — daily specimen <YYYY-MM-DD>"
```

The daily commit gate uses `--frontier`, which additionally requires the new
specimen to be dated strictly after the latest existing bug (the forward-only
invariant). Plain `validate_bug.py` / CI `--all` deliberately omit `--frontier`
so legacy mid-timeline rows and backfills still validate.

End the commit body with the session link per repo convention.

### 6. Ship

Per `README.md`, pushes to `main` auto-deploy to production via Vercel. Push to
`main` (or open a PR if review is wanted) — the new circle appears after the
build. Layout is forward-only **as long as you add at the frontier**: the new
bug claims the next outer spiral slot and existing bugs stay put. Note that
`src/lib/hex.ts` assigns slots by sorting on `discoveredOn` (slug as tie-break),
so a specimen stamped *mid-timeline* would shove every later-dated bug one slot
outward — which is exactly what the `--frontier` gate prevents.

---

## Validation reference

```bash
python3 scripts/validate_bug.py                 # latest discoveredOn cohort (default)
python3 scripts/validate_bug.py --frontier      # daily add: cohort + frontier-date gate
python3 scripts/validate_bug.py --slug <slug>   # one specimen
python3 scripts/validate_bug.py --date 2026-06-14
python3 scripts/validate_bug.py --all           # full sweep (CI / backlog audit)
python3 scripts/validate_bug.py --all --no-image
```

Exit `0` = safe to commit. Exit `1` = do not commit; read the FAIL lines.

Tunables live at the top of `scripts/validate_bug.py` (`SAFE_RADIUS_FRAC`,
`BG_DIST_THRESH`, coverage band, plate-detection thresholds). Change them
deliberately, with Atticus — they define "in the circle." The `--frontier` flag
(daily add only) additionally enforces the forward-only date invariant; CI and
`--all`/`--date`/`--slug` runs intentionally omit it so legacy mid-timeline rows
and deliberate backfills still validate.

---

## Stability notes (why this stays reliable over months)

- **Gate is the source of truth.** As long as the job won't commit on a red
  gate, the collection can't drift into dupes or cropped art.
- **Forward-only layout (when you add at the frontier).** `src/lib/hex.ts`
  assigns coords by `discoveredOn` (sorted ascending, slug tie-break), so a
  frontier add grows the spiral outward and never moves existing bugs. A
  mid-timeline date would reflow every later bug — the `--frontier` gate on the
  daily add blocks that.
- **Plate style is fixed** in one place (`build_thumbnail_prompts.py`), so the
  look stays consistent as the catalog grows.
- **Atomic runs.** Data row + image are committed together, only after the gate.

## Known backlog (run `--all` to refresh)

A first full sweep flagged **~18 legacy thumbnails** whose art reaches past the
circular crop (subject filling ~99–101% of the frame, or wings/legs into the
corners — e.g. `monarch-butterfly`, `rosy-maple-moth`, `bombardier-beetle`,
`glasswing-butterfly`, `hercules-beetle`). They predate the safe-zone rule and
are being clipped in the live UI. Re-generate them with the updated brief as
capacity allows; the gate lists the current set any time via `--all`.
