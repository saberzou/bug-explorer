# Bug Explorer — agent orientation

A pannable grid of rare real-world insects. One new specimen is added per day.
Next.js 15 (App Router) · TypeScript · Tailwind v4 · Framer Motion / GSAP · Vercel.

## Daily content job (the common task)

If you're here to add today's specimen — or any bug — **follow the runbook and
pass the gate before committing**:

- Runbook: [`docs/DAILY_CURATION.md`](docs/DAILY_CURATION.md)
- Gate (must exit 0 before any commit):
  ```bash
  pip install pillow            # image checks need Pillow
  python3 scripts/validate_bug.py        # validates today's cohort
  ```

The gate enforces: **no duplicate** slug/common/Latin name, schema correctness,
and **image quality + circular-crop safety** (the insect must stay inside the
round crop, never clipped). Do not relax the thresholds to force a pass —
re-generate the art instead. A skipped image check (Pillow missing) counts as a
failure.

CI re-runs the gate on every PR to `main` (`.github/workflows/validate.yml`), so
a duplicate or cropped specimen cannot reach production.

## Content contract & schema

- Drop convention + rarity bias: [`README.md`](README.md)
- Schema: [`src/lib/types.ts`](src/lib/types.ts)
- Image: `public/bugs/<slug>.png`, 1024×1024, cream-plate illustration style;
  generation brief in `scripts/build_thumbnail_prompts.py`.

## Stable invariants — don't break these

- `slug` is **permanent** — it drives the URL, image path, and hex coordinates.
- Hex layout is forward-only (`src/lib/hex.ts`) **when bugs are added at the
  frontier**: it sorts by `discoveredOn` (slug tie-break) and walks the spiral,
  so a new frontier-dated bug grows the cluster outward and existing bugs never
  move. A mid-timeline date reflows every later bug — the daily add guards
  against this with `validate_bug.py --frontier`. Don't reorder or reflow.
- A run is atomic: commit the data row **and** its image together, only after a
  green gate. Never commit a half specimen.

## Build / dev

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # production build (static export of all bug pages)
```
