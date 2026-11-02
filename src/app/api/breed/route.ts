import { NextResponse } from "next/server";
import { getBug } from "@/lib/bugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OpenAI image generation can take 20–60 s; give the function room for that
// plus one fallback attempt.
export const maxDuration = 120;

// ── Providers ────────────────────────────────────────────────────────────────
// OpenAI (GPT Image) is the primary image generator. Gemini stays as a
// fallback: it's used when no OpenAI key is set, or if every OpenAI model
// fails. Remove the Gemini key in Vercel to switch it off entirely.

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();

// Candidate OpenAI image models, tried in order. Set OPENAI_IMAGE_MODEL to pin
// a specific id (it's tried first). Flare is the fast everyday model.
const OPENAI_MODELS = unique([
  process.env.OPENAI_IMAGE_MODEL,
  "gpt-image-2.5-flare",
  "gpt-image-2",
  "gpt-image-1",
]);

// low | medium | high (plus xhigh / max on the 2.5 models). Medium is the
// speed/cost sweet spot for a 1024² illustration.
const OPENAI_QUALITY = (process.env.OPENAI_IMAGE_QUALITY || "medium").trim();

// Candidate Gemini image models, tried in order until one works. Set
// GEMINI_IMAGE_MODEL to pin a specific id (it's tried first).
const GEMINI_MODELS = unique([
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-3.1-flash-image-preview",
]);

// Accept the common Gemini/Google key names so whichever you set in Vercel works.
const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GEMINI_KEY ||
  process.env.Gemini ||
  process.env.GEMINI ||
  ""
).trim();

// Stop starting new attempts after this long so the whole request finishes
// inside maxDuration.
const OVERALL_BUDGET_MS = 100_000;
const OPENAI_ATTEMPT_MS = 75_000;
const GEMINI_ATTEMPT_MS = 30_000;

// Only expose upstream error detail when explicitly debugging (avoid leaking
// provider error text / model ids to end users in production).
const DEBUG = process.env.LAB_DEBUG === "1";

function unique(models: (string | undefined)[]): string[] {
  return [...new Set(models.map((m) => m?.trim()).filter((m): m is string => Boolean(m)))];
}

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

type Generated = { mime: string; base64: string };

/** Outcome of one attempt: an image, or why it failed and whether the rest of
 *  this provider's models are worth trying (a bad key fails them all). */
type Attempt = { image: Generated } | { detail: string; skipProvider: boolean };

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithOpenAI(model: string, prompt: string, ms: number): Promise<Attempt> {
  return withTimeout(ms, async (signal) => {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: "1024x1024",
        quality: OPENAI_QUALITY,
        output_format: "png",
      }),
      signal,
    });
    if (!r.ok) {
      const text = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
      // 401/403: bad key or unverified org. 429: out of quota. Every model on
      // this account will fail the same way, so move on to the fallback.
      return {
        detail: `openai ${model}: ${r.status} ${text}`,
        skipProvider: r.status === 401 || r.status === 403 || r.status === 429,
      };
    }
    const data = await r.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (typeof b64 !== "string" || !b64) {
      return { detail: `openai ${model}: response had no image`, skipProvider: false };
    }
    return { image: { mime: "image/png", base64: b64 } };
  });
}

async function generateWithGemini(model: string, prompt: string, ms: number): Promise<Attempt> {
  return withTimeout(ms, async (signal) => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal,
      },
    );
    if (!r.ok) {
      const text = (await r.text()).replace(/\s+/g, " ").slice(0, 150);
      return { detail: `gemini ${model}: ${r.status} ${text}`, skipProvider: false };
    }
    const data = await r.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
    if (!img?.inlineData?.data) {
      return { detail: `gemini ${model}: response had no image`, skipProvider: false };
    }
    return { image: { mime: img.inlineData.mimeType || "image/png", base64: img.inlineData.data } };
  });
}

type Provider = {
  name: string;
  models: string[];
  attemptMs: number;
  generate: (model: string, prompt: string, ms: number) => Promise<Attempt>;
};

function configuredProviders(): Provider[] {
  const providers: Provider[] = [];
  if (OPENAI_API_KEY) {
    providers.push({ name: "openai", models: OPENAI_MODELS, attemptMs: OPENAI_ATTEMPT_MS, generate: generateWithOpenAI });
  }
  if (GEMINI_API_KEY) {
    providers.push({ name: "gemini", models: GEMINI_MODELS, attemptMs: GEMINI_ATTEMPT_MS, generate: generateWithGemini });
  }
  return providers;
}

export async function POST(req: Request) {
  const providers = configuredProviders();
  if (providers.length === 0) return fail("The lab is offline — no AI key configured yet.", 503);

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

  const started = Date.now();
  const details: string[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const remaining = OVERALL_BUDGET_MS - (Date.now() - started);
      if (remaining < 10_000) {
        details.push("time budget exhausted");
        return fail("The cross fizzled — generation failed.", 502, details.join(" | "));
      }
      try {
        const attempt = await provider.generate(model, prompt, Math.min(provider.attemptMs, remaining));
        if ("image" in attempt) {
          return NextResponse.json({
            image: `data:${attempt.image.mime};base64,${attempt.image.base64}`,
            name: hybridName(bugA.commonName, bugB.commonName),
            parents: [bugA.commonName, bugB.commonName],
          });
        }
        details.push(attempt.detail);
        console.error("breed attempt failed", attempt.detail);
        if (attempt.skipProvider) break;
      } catch (e) {
        const detail = `${provider.name} ${model}: ${String(e).slice(0, 150)}`;
        details.push(detail);
        console.error("breed route error", detail);
      }
    }
  }
  return fail("The cross fizzled — generation failed.", 502, details.join(" | ") || "no model attempted");
}
