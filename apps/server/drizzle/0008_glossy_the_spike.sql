ALTER TABLE `nexus_samples` ADD `blocked_requests` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `throttled_requests` integer;--> statement-breakpoint
ALTER TABLE `nexus_samples` ADD `grace_throttled_requests` integer;