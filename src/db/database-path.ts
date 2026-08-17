import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the SQLite database location. AGENTARIUM_DATABASE_PATH wins, the
 * pre-rename RELAY_DATABASE_PATH is still honored, and the default is
 * data/agentarium.db. When neither variable is set and only the pre-rename
 * data/relay.db exists, it is adopted in place — renamed together with its WAL
 * sidecars — so collected history survives the rename without a full rescan.
 */
export function resolveDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const configured = env.AGENTARIUM_DATABASE_PATH ?? env.RELAY_DATABASE_PATH;
  if (configured) return path.resolve(configured);

  const databasePath = path.join(cwd, "data", "agentarium.db");
  const legacyPath = path.join(cwd, "data", "relay.db");
  if (!fs.existsSync(databasePath) && fs.existsSync(legacyPath)) {
    fs.renameSync(legacyPath, databasePath);
    for (const suffix of ["-shm", "-wal"]) {
      const legacySidecar = `${legacyPath}${suffix}`;
      if (fs.existsSync(legacySidecar)) {
        fs.renameSync(legacySidecar, `${databasePath}${suffix}`);
      }
    }
  }
  return databasePath;
}
