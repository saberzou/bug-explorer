"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBugOrigin } from "@/lib/transition";

/**
 * Back link on the detail page that returns to wherever the bug was opened
 * from — the globe ("/atlas") or the grid ("/"). Carries data-bug-back (the
 * GSAP reverse-transition hook) and data-detail-fade (content fade).
 */
export default function BugBackLink() {
  const [href, setHref] = useState("/");
  useEffect(() => {
    const o = getBugOrigin();
    if (o) setHref(o);
  }, []);
  const label = href.startsWith("/atlas") ? "← back to globe" : "← back to grid";
  return (
    <Link
      href={href}
      data-bug-back
      data-detail-fade
      className="self-start text-xs uppercase tracking-widest text-zinc-400 hover:text-amber-200"
    >
      {label}
    </Link>
  );
}
