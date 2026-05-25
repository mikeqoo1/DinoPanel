CREATE TABLE `backups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`source` text NOT NULL,
	`retention_group` text,
	`keep_last_n` integer,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `db_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backups_instance_idx` ON `backups` (`instance_id`);--> statement-breakpoint
CREATE INDEX `backups_retention_idx` ON `backups` (`instance_id`,`retention_group`,`created_at`);