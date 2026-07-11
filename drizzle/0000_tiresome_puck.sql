CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_session_external_idx` ON `activity_events` (`session_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `ingestion_sources` (
	`path` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`size` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`last_synced_at` text NOT NULL,
	`parse_state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`provider` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`repository` text,
	`cwd` text,
	`branch` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`updated_at` text NOT NULL,
	`files_changed` integer,
	`additions` integer,
	`deletions` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_tokens` integer,
	`model` text,
	`estimated_cost_usd` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_provider_external_idx` ON `sessions` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `sessions_started_idx` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `sessions_status_idx` ON `sessions` (`status`);--> statement-breakpoint
CREATE TABLE `sync_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`source_path` text NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`occurred_at` text NOT NULL
);
