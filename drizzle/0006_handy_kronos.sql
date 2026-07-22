CREATE TABLE `session_capability_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`capability_name` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_usage_session_external_idx` ON `session_capability_usage` (`session_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `capability_usage_kind_name_idx` ON `session_capability_usage` (`kind`,`capability_name`);--> statement-breakpoint
CREATE INDEX `capability_usage_occurred_idx` ON `session_capability_usage` (`occurred_at`);