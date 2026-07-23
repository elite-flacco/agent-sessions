import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull(),
    sourcePath: text("source_path"),
    provider: text("provider").notNull(),
    parentExternalId: text("parent_external_id"),
    sessionKind: text("session_kind").notNull().default("main"),
    agentLabel: text("agent_label"),
    agentDepth: integer("agent_depth").notNull().default(0),
    title: text("title").notNull(),
    summary: text("summary"),
    repository: text("repository"),
    cwd: text("cwd"),
    branch: text("branch"),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    updatedAt: text("updated_at").notNull(),
    filesChanged: integer("files_changed"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),
    model: text("model"),
    estimatedCostUsd: real("estimated_cost_usd"),
  },
  (table) => [
    uniqueIndex("sessions_provider_external_idx").on(
      table.provider,
      table.externalId,
    ),
    index("sessions_started_idx").on(table.startedAt),
    index("sessions_status_idx").on(table.status),
    index("sessions_parent_idx").on(table.provider, table.parentExternalId),
  ],
);

export const sessionModelUsage = sqliteTable(
  "session_model_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    reportedCostUsd: real("reported_cost_usd"),
  },
  (table) => [
    uniqueIndex("usage_session_model_idx").on(table.sessionId, table.model),
  ],
);

export const sessionCapabilityUsage = sqliteTable(
  "session_capability_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    capabilityName: text("capability_name").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("capability_usage_session_external_idx").on(
      table.sessionId,
      table.externalId,
    ),
    index("capability_usage_kind_name_idx").on(
      table.kind,
      table.capabilityName,
    ),
    index("capability_usage_occurred_idx").on(table.occurredAt),
  ],
);

export const activityEvents = sqliteTable(
  "activity_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_session_external_idx").on(
      table.sessionId,
      table.externalId,
    ),
  ],
);

export const ingestionSources = sqliteTable("ingestion_sources", {
  path: text("path").primaryKey(),
  provider: text("provider").notNull(),
  size: integer("size").notNull(),
  modifiedAt: integer("modified_at").notNull(),
  fingerprint: text("fingerprint").notNull(),
  lastSyncedAt: text("last_synced_at").notNull(),
  parseState: text("parse_state").notNull(),
});

export const adapterScans = sqliteTable("adapter_scans", {
  provider: text("provider").primaryKey(),
  lastScanAt: text("last_scan_at").notNull(),
  sources: integer("sources").notNull(),
  imported: integer("imported").notNull(),
  errors: integer("errors").notNull(),
  capabilityReconciliationComplete: integer(
    "capability_reconciliation_complete",
  )
    .notNull()
    .default(0),
});

export const collectorLeases = sqliteTable("collector_leases", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const syncErrors = sqliteTable("sync_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  sourcePath: text("source_path").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  occurredAt: text("occurred_at").notNull(),
});
