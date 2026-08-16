"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DASHBOARD_REFRESH_INTERVAL_MS } from "@/lib/polling";

/**
 * Rereads server data on the shared dashboard cadence. `router.refresh()` only
 * rereads SQLite; ingestion freshness is handled server-side by each page's
 * throttled `refreshIngestedData()` call.
 */
export function useDashboardPolling(): void {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(
      () => router.refresh(),
      DASHBOARD_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [router]);
}
