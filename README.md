# Bug Explorer 🐛

A slowly-growing curio cabinet of rare, real-world insects. Each circle on the
pannable grid is one bug. Tap to inspect. New specimen added daily by Axel's
content cron.

**Live site:** _(set after first Vercel deploy)_
**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · Framer Motion · Vercel

---

## Roles

- **Saber** — PM
- **Atticus** — coder (framework, repo, site)
- **Axel** — creative, content, QA (daily image gen, copy, schema, testing)

## Content drop convention

This is the contract the daily cron writes to. **Do not break it without telling
Atticus.**

### 1. Image

Drop a circular-composition PNG (transparent or cream background) at:

```
public/bugs/<slug>.png
```

The site converts to WebP at build time via `next/image` — keep PNG as source
of truth. Recommended size: 1024×1024.

### 2. Data row

Append (or upsert by `slug`) one entry to `data/bugs.json`. Schema:

```ts
{
  slug: string;          // URL slug, e.g. "atlas-moth". STABLE FOREVER.
  commonName: string;    // e.g. "Atlas Moth"
  latinName: string;     // e.g. "Attacus atlas"
  habitat: string;       // short phrase, e.g. "Southeast Asian rainforests"
  sizeMm: number;        // largest dimension in mm
  weirdFact: string;     // one weird-but-true fact, ≤ 140 chars ideal
  whyItsCool: string;    // voice / opinion / why it earns a spot
  discoveredOn: string;  // ISO YYYY-MM-DD when added
  rarity: "common" | "uncommon" | "rare" | "legendary";
}
```

### 3. Rarity distribution (Axel's bias)

- 60% common — ringed in zinc
- 25% uncommon — ringed in emerald
- 12% rare — ringed in sky blue + soft glow
- 3% legendary — ringed in amber + strong glow

The latest `discoveredOn` bug gets an extra pulsing amber ring on the grid.

## Hex grid stability

Coords are deterministic via `slug → FNV-1a hash → spiral slot` (see
`src/lib/hex.ts`). Once a bug ships, its hex position never changes. Backfilling
older species is safe; they'll find unoccupied slots without disturbing
existing positions.

## Routes

- `/` — pannable grid of all bugs
- `/bug/<slug>` — single bug detail page (deeplinkable, share-friendly,
  static-generated at build time via `generateStaticParams`)

## Local development

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Deploy

Pushes to `main` auto-deploy via Vercel.

## Adding a bug manually (for testing)

1. Drop the PNG at `public/bugs/your-slug.png`.
2. Add an entry to `data/bugs.json`.
3. Commit and push — Vercel rebuilds and the new circle appears.
