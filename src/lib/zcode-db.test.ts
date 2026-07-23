import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetZcodeDbCache,
  getZcodeSessionMetadataResult,
  isZcodeCapabilityDbAvailable,
  isZcodeDbAvailable,
} from "./zcode-db";

const temporaryDirectories: string[] = [];

async function zcodeFixture(schema: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-zcode-db-"));
  temporaryDirectories.push(directory);
  const dbPath = path.join(directory, "zcode.db");
  const db = new Database(dbPath);
  if (schema) db.exec(schema);
  db.close();
  process.env.ZCODE_DB_PATH = dbPath;
  __resetZcodeDbCache();
  return dbPath;
}

afterEach(async () => {
  __resetZcodeDbCache();
  delete process.env.ZCODE_DB_PATH;
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("Zcode capability database health", () => {
  it("rejects an open database that lacks the authoritative session query", async () => {
    await zcodeFixture(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
    `);

    expect(isZcodeDbAvailable()).toBe(true);
    expect(isZcodeCapabilityDbAvailable()).toBe(false);
    expect(getZcodeSessionMetadataResult("missing")).toEqual({ ok: false });
  });

  it("accepts a database with every authoritative capability query", async () => {
    await zcodeFixture(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL,
        parent_id TEXT, task_type TEXT NOT NULL, title_source TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE tool_usage (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        started_at INTEGER NOT NULL
      );
    `);

    expect(isZcodeCapabilityDbAvailable()).toBe(true);
    expect(getZcodeSessionMetadataResult("missing")).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
