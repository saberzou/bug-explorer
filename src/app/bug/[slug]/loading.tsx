import BugDetailSkeleton from "@/components/BugDetailSkeleton";

/**
 * Route-level loading UI for /bug/[slug]. App Router shows this while the
 * static page resolves during client-side navigation between bugs.
 */
export default function BugDetailLoading() {
  return <BugDetailSkeleton />;
}
