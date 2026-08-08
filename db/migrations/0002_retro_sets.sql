CREATE TABLE `retro_sets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`record_id` bigint unsigned NOT NULL,
	`note_hash` varchar(32) NOT NULL DEFAULT '',
	`self_note` text,
	`context` json NOT NULL,
	`generated_id` bigint unsigned NOT NULL,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `retro_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `essays` MODIFY COLUMN `content` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_retro_user` ON `retro_sets` (`user_id`,`record_id`);