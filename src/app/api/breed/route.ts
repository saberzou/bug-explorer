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

// Best-effort per-instance rate limit (serverless instances are ephemeral, so
// this is a soft guard against accidental hammering, not airtight abuse control).
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 8; // 8 breeds / minute / instance
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

export async function POST(req: Request) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "The lab is offline — no AI key configured yet." },
      { status: 503 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Whoa — too many experiments. Give the lab a minute." },
      { status: 429 },
    );
  }

  let body: { a?: string; b?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const { a, b } = body;
  if (!a || !b || a === b) {
    return NextResponse.json({ error: "Pick two different species." }, { status: 400 });
  }
  const [bugA, bugB] = await Promise.all([getBug(a), getBug(b)]);
  if (!bugA || !bugB) {
    return NextResponse.json({ error: "Unknown species." }, { status: 400 });
  }

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
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!r.ok) {
        detail = `${model}: ${r.status} ${(await r.text()).replace(/\s+/g, " ").slice(0, 150)}`;
        console.error("gemini breed failed", detail);
        continue; // try the next model id
      }
      const data = await r.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
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
    }
  }
  // All models failed — surface the real reason so it can be diagnosed on-screen.
  return NextResponse.json(
    { error: "The cross fizzled — generation failed.", detail },
    { status: 502 },
  );
}
