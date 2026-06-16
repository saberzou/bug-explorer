import { NextResponse } from "next/server";
import { getBug } from "@/lib/bugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Candidate Gemini image models, tried in order until one works. Set
// GEMINI_IMAGE_MODEL to pin a specific id (it's tried first).
const MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-3.1-flash-image-preview",
].filter((m): m is string => Boolean(m));
const UNIQUE_MODELS = [...new Set(MODELS)];

// Accept the common Gemini/Google key names so whichever you set in Vercel works.
const API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GEMINI_KEY ||
  process.env.Gemini ||
  process.env.GEMINI ||
  ""
).trim();

// Only expose upstream error detail when explicitly debugging (avoid leaking
// provider error text / model ids to end users in production).
const DEBUG = process.env.LAB_DEBUG === "1";

// Per-IP limit (best-effort; X-Forwarded-For is client-influenced so this is a
// courtesy throttle, not a hard control)...
const ipHits = new Map<string, number[]>();
function ipLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  ipHits.set(ip, arr);
  return arr.length > 8;
}

// ...backed by a GLOBAL per-instance cap that bounds spend even if the per-IP
// key is spoofed. This is the real cost circuit-breaker for the paid API.
const globalHits: number[] = [];
function globalLimited(): boolean {
  const now = Date.now();
  while (globalHits.length && now - globalHits[0] > 60_000) globalHits.shift();
  globalHits.push(now);
  return globalHits.length > 30; // 30 generations / minute / instance
}

function hybridName(a: string, b: string): string {
  const last = (s: string) => s.trim().split(/\s+/).pop() || s;
  const wa = last(a);
  const wb = last(b);
  const head = wa.slice(0, Math.ceil(wa.length / 2));
  const tail = wb.slice(Math.floor(wb.length / 2));
  const blend = (head + tail).toLowerCase();
  return blend.charAt(0).toUpperCase() + blend.slice(1);
}

function fail(error: string, status: number, detail?: string) {
  return NextResponse.json(
    detail && DEBUG ? { error, detail } : { error },
    { status },
  );
}

export async function POST(req: Request) {
  if (!API_KEY) return fail("The lab is offline — no AI key configured yet.", 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (ipLimited(ip) || globalLimited()) {
    return fail("Whoa — too many experiments. Give the lab a minute.", 429);
  }

  let body: { a?: unknown; b?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Bad request.", 400);
  }
  const { a, b } = body;
  if (typeof a !== "string" || typeof b !== "string" || !a || !b || a === b) {
    return fail("Pick two different species.", 400);
  }
  const [bugA, bugB] = await Promise.all([getBug(a), getBug(b)]);
  if (!bugA || !bugB) return fail("Unknown species.", 400);

  const prompt =
    `A hand-drawn naturalist scientific illustration of a SINGLE fantastical hybrid insect — ` +
    `an imaginative crossbreed of a ${bugA.commonName} (${bugA.latinName}) and a ${bugB.commonName} ` +
    `(${bugB.latinName}). Believably fuse their most iconic shapes, patterns and colors into one ` +
    `creature. Vintage entomology field-guide aesthetic with subtle ink and watercolor texture, ` +
    `warm earthy palette, the single bug centered as a hero on a plain warm cream/beige SQUARE ` +
    `background (no scene, no environment), soft even lighting, gentle drop shadow. The whole insect ` +
    `— legs, antennae, wings, tails — sits inside the central circular safe zone with even margin; ` +
    `nothing touches the edges or corners. Illustrated, not photorealistic. ABSOLUTELY NO TEXT, ` +
    `LABELS, OR TYPOGRAPHY anywhere in the image.`;

  let detail = "no model attempted";
  for (const model of UNIQUE_MODELS) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000); // don't hang the function
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
          signal: ctrl.signal,
        },
      );
      if (!r.ok) {
        detail = `${model}: ${r.status} ${(await r.text()).replace(/\s+/g, " ").slice(0, 150)}`;
        console.error("gemini breed failed", detail);
        continue;
      }
      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
      if (!img?.inlineData?.data) {
        detail = `${model}: response had no image`;
        continue;
      }
      const mime = img.inlineData.mimeType || "image/png";
      return NextResponse.json({
        image: `data:${mime};base64,${img.inlineData.data}`,
        name: hybridName(bugA.commonName, bugB.commonName),
        parents: [bugA.commonName, bugB.commonName],
      });
    } catch (e) {
      detail = `${model}: ${String(e).slice(0, 150)}`;
      console.error("breed route error", detail);
    } finally {
      clearTimeout(timeout);
    }
  }
  return fail("The cross fizzled — generation failed.", 502, detail);
}
