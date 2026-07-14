ALTER TABLE `sessions` ADD `parent_external_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `session_kind` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `agent_label` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `agent_depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `sessions_parent_idx` ON `sessions` (`provider`,`parent_external_id`);