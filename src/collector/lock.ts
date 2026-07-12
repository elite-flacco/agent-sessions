import crypto from "node:crypto";
import { sqlite } from "@/db/client";

export type LeaseName = "sync" | "watch";

export const leaseOwner = `${process.pid}-${crypto.randomUUID()}`;

/**
 * Acquire or renew a durable lease. Succeeds when the lease is free, expired,
 * or already held by this owner; fails when another live process holds it.
 */
export function acquireLease(
  name: LeaseName,
  ttlMs: number,
  owner = leaseOwner,
): boolean {
  const now = new Date();
  const result = sqlite
    .prepare(
      `INSERT INTO collector_leases (name, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at
      WHERE collector_leases.owner = excluded.owner OR collector_leases.expires_at < excluded.acquired_at`,
    )
    .run(
      name,
      owner,
      now.toISOString(),
      new Date(now.getTime() + ttlMs).toISOString(),
    );
  return result.changes > 0;
}

export function releaseLease(name: LeaseName, owner = leaseOwner): void {
  sqlite
    .prepare("DELETE FROM collector_leases WHERE name = ? AND owner = ?")
    .run(name, owner);
}
