import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databasePath = process.env.RELAY_DATABASE_PATH
  ? path.resolve(process.env.RELAY_DATABASE_PATH)
  : path.join(process.cwd(), "data", "relay.db");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
migrate(drizzle(sqlite), {
  migrationsFolder: path.join(process.cwd(), "drizzle"),
});
sqlite.close();
console.log(`Relay database migrated at ${databasePath}`);
