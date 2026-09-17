CREATE TABLE `nexus_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`ts` integer NOT NULL,
	`requests` integer NOT NULL,
	`resp_2xx` integer NOT NULL,
	`resp_3xx` integer NOT NULL,
	`resp_4xx` integer NOT NULL,
	`resp_5xx` integer NOT NULL,
	`bytes_down` integer NOT NULL,
	`bytes_up` integer NOT NULL,
	`by_format` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `nexus_samples_instance_ts_idx` ON `nexus_samples` (`instance_id`,`ts`);