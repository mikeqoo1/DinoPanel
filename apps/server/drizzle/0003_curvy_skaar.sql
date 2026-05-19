CREATE TABLE `acme_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`directory_url` text NOT NULL,
	`email` text NOT NULL,
	`key_pem` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_acme_accounts_pair` ON `acme_accounts` (`directory_url`,`email`);--> statement-breakpoint
CREATE TABLE `acme_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`challenge` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_acme_orders_site` ON `acme_orders` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_acme_orders_started` ON `acme_orders` (`started_at`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`primary_domain` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`managed_by_dinopanel` integer DEFAULT true NOT NULL,
	`orphaned` integer DEFAULT false NOT NULL,
	`cert_paths` text,
	`cert_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_name_unique` ON `sites` (`name`);--> statement-breakpoint
CREATE INDEX `idx_sites_primary_domain` ON `sites` (`primary_domain`);