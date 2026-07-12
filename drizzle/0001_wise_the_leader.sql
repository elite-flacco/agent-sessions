CREATE TABLE `adapter_scans` (
	`provider` text PRIMARY KEY NOT NULL,
	`last_scan_at` text NOT NULL,
	`sources` integer NOT NULL,
	`imported` integer NOT NULL,
	`errors` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collector_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
