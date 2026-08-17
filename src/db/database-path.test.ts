import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabasePath } from "./database-path";

let directory = "";

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentarium-path-"));
});

afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("resolveDatabasePath", () => {
  it("prefers AGENTARIUM_DATABASE_PATH and resolves it", () => {
    expect(
      resolveDatabasePath({
        NODE_ENV: "test",
        AGENTARIUM_DATABASE_PATH: path.join(directory, "custom.db"),
        RELAY_DATABASE_PATH: path.join(directory, "legacy.db"),
      }),
    ).toBe(path.join(directory, "custom.db"));
  });

  it("still honors the pre-rename RELAY_DATABASE_PATH", () => {
    expect(
      resolveDatabasePath({
        NODE_ENV: "test",
        RELAY_DATABASE_PATH: path.join(directory, "legacy.db"),
      }),
    ).toBe(path.join(directory, "legacy.db"));
  });

  it("defaults to data/agentarium.db and adopts a legacy default-location database in place", async () => {
    const dataDir = path.join(directory, "adopt", "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, "relay.db"), "legacy");
    await fs.writeFile(path.join(dataDir, "relay.db-wal"), "legacy-wal");
    await fs.writeFile(path.join(dataDir, "relay.db-shm"), "legacy-shm");

    const resolved = resolveDatabasePath(
      { NODE_ENV: "test" },
      path.join(directory, "adopt"),
    );

    expect(resolved).toBe(path.join(dataDir, "agentarium.db"));
    expect(await fs.readdir(dataDir)).toEqual([
      "agentarium.db",
      "agentarium.db-shm",
      "agentarium.db-wal",
    ]);
    expect(await fs.readFile(resolved, "utf8")).toBe("legacy");
  });

  it("keeps an existing default database and leaves the legacy file untouched", async () => {
    const dataDir = path.join(directory, "existing", "data");
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, "agentarium.db"), "current");
    await fs.writeFile(path.join(dataDir, "relay.db"), "legacy");

    const resolved = resolveDatabasePath(
      { NODE_ENV: "test" },
      path.join(directory, "existing"),
    );

    expect(resolved).toBe(path.join(dataDir, "agentarium.db"));
    expect(await fs.readFile(resolved, "utf8")).toBe("current");
    expect(await fs.readFile(path.join(dataDir, "relay.db"), "utf8")).toBe(
      "legacy",
    );
  });

  it("never adopts a legacy database outside the default location", async () => {
    const root = path.join(directory, "configured");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "relay.db"), "legacy");

    expect(
      resolveDatabasePath(
        {
          NODE_ENV: "test",
          AGENTARIUM_DATABASE_PATH: path.join(root, "agentarium.db"),
        },
        root,
      ),
    ).toBe(path.join(root, "agentarium.db"));
    expect(await fs.readFile(path.join(root, "relay.db"), "utf8")).toBe(
      "legacy",
    );
  });
});
