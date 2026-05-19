CREATE TABLE `db_instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`engine` text NOT NULL,
	`image_tag` text NOT NULL,
	`port` integer NOT NULL,
	`username` text NOT NULL,
	-- TODO(v0.5): encrypt via SecretsService — landing alongside audit-log integration (decisions.md Q4)
	`password` text NOT NULL,
	`data_dir` text NOT NULL,
	`container_name` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`pmm_registered` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_instances_name_unique` ON `db_instances` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `db_instances_container_name_unique` ON `db_instances` (`container_name`);--> statement-breakpoint
CREATE INDEX `idx_db_instances_engine` ON `db_instances` (`engine`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_db_instances_port` ON `db_instances` (`port`);--> statement-breakpoint
ALTER TABLE `sites` ADD `external_conf_path` text;