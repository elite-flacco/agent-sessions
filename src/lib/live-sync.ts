import { syncAll } from "@/collector";

let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Incrementally ingest changed source files, at most once per interval
 * across all requests. Unchanged files are fingerprint-skipped by the
 * collector, so the steady-state cost is one stat per source file.
 */
export function refreshIngestedData(minIntervalMs = 10_000): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastAttemptAt < minIntervalMs) return Promise.resolve();
  lastAttemptAt = Date.now();
  inFlight = syncAll()
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
