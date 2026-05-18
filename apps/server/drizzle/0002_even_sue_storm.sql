CREATE TABLE `firewall_rule_meta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`port` integer NOT NULL,
	`proto` text NOT NULL,
	`source` text,
	`action` text NOT NULL,
	`comment` text,
	`created_by` integer,
	`created_at` integer NOT NULL,
	`staged_at` integer,
	`confirming_at` integer,
	`confirmed_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`result` text NOT NULL,
	`reason` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_login_attempts_created` ON `login_attempts` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_login_attempts_username` ON `login_attempts` (`username`);--> statement-breakpoint
CREATE TABLE `operation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`body_summary` text,
	`status_code` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_operation_log_created` ON `operation_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_operation_log_user` ON `operation_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_operation_log_path` ON `operation_log` (`path`);--> statement-breakpoint
CREATE TABLE `scheduled_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`exit_code` integer,
	`output` text,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scheduled_runs_task` ON `scheduled_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_runs_started` ON `scheduled_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`cron` text NOT NULL,
	`payload` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
