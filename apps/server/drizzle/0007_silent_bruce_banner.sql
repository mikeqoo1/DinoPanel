ALTER TABLE `nexus_samples` ADD `requests_24h` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `component_count` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `unique_users_30d` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `peak_requests_per_day_30d` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `peak_requests_per_minute_1d` integer;