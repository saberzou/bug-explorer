/**
 * Cross-route handoff for GSAP page transitions.
 *
 * BugGrid (home) stashes the clicked bug circle's bounding rect + background
 * color into sessionStorage. The detail page (BugDetailHero) reads it on
 * mount, snaps its circular hero into that rect, and tweens it to its
 * natural position with GSAP. This is a hand-rolled FLIP done across a route
 * boundary, because GSAP's Flip plugin keeps state in module memory that
 * doesn't survive Next.js's hard route swap.
 *
 * If the user lands on a detail page from elsewhere (deep link, fresh tab,
 * pop-state from cache, reduced motion), the handoff is simply absent and
 * everything renders normally.
 */
export interface BugTransitionHandoff {
  slug: string;
  /** Bounding rect of the source circle at click time (viewport coords). */
  rect: { x: number; y: number; w: number; h: number };
  /** Optional palette color so the placeholder behind the image matches. */
  bg?: string;
  /** Epoch ms — stale handoffs get ignored. */
  ts: number;
}

const KEY = "bug-transition-handoff";
const TTL_MS = 4000; // anything older than a few seconds is no longer relevant

export function storeHandoff(payload: BugTransitionHandoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function readHandoff(slug: string): BugTransitionHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BugTransitionHandoff;
    if (parsed.slug !== slug) return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearHandoff() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Honour OS-level reduced-motion preference. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Where the user opened a bug detail page FROM ("/" grid or "/atlas" globe), so
 * the detail page's back link returns to the right view instead of always the
 * grid. Set on the source click; read on the detail page.
 */
const ORIGIN_KEY = "bug-origin";

export function setBugOrigin(path: string): void {
  try {
    sessionStorage.setItem(ORIGIN_KEY, path);
  } catch {
    // ignore
  }
}

export function getBugOrigin(): string | null {
  try {
    return sessionStorage.getItem(ORIGIN_KEY);
  } catch {
    return null;
  }
}
