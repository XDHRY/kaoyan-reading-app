CREATE TABLE `answer_diffs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`source` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`passage_id` bigint unsigned NOT NULL,
	`q_no` int NOT NULL,
	`ai_answer` varchar(1) NOT NULL,
	`official_answer` varchar(1) NOT NULL,
	`root_cause` varchar(32) NOT NULL DEFAULT '',
	`ai_reasoning` text,
	`official_logic` text,
	`user_takeaway` text,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `answer_diffs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_diff` UNIQUE(`source`,`passage_id`,`q_no`,`ai_answer`,`official_answer`)
);
--> statement-breakpoint
CREATE TABLE `essay_drafts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`title` varchar(128) NOT NULL DEFAULT '',
	`essay_type` varchar(24) NOT NULL DEFAULT 'picture',
	`prompt` text NOT NULL,
	`state` json NOT NULL,
	`essay_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `essay_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `essays` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`title` varchar(128) NOT NULL DEFAULT '',
	`essay_type` varchar(24) NOT NULL DEFAULT 'picture',
	`prompt` text NOT NULL,
	`content` text NOT NULL,
	`review` json,
	`score` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `essays_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_materials` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`kind` varchar(24) NOT NULL DEFAULT 'note',
	`title` varchar(128) NOT NULL DEFAULT '',
	`content` text NOT NULL,
	`used_count` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_materials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wrong_insights` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`wrong_id` bigint unsigned,
	`error_type` varchar(24) NOT NULL DEFAULT '',
	`content` text NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'attention',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wrong_insights_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wrong_item_analyses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`wrong_id` bigint unsigned NOT NULL,
	`error_type` varchar(24) NOT NULL DEFAULT '',
	`root_cause` text,
	`distractor_pull` text,
	`knowledge_gap` text,
	`method_refs` json,
	`suggestion` text,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wrong_item_analyses_id` PRIMARY KEY(`id`),
	CONSTRAINT `wrong_item_analyses_wrong_id_unique` UNIQUE(`wrong_id`)
);
--> statement-breakpoint
CREATE TABLE `wrong_recommendations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`headline` varchar(128) NOT NULL DEFAULT '',
	`advice` text,
	`focus_types` json NOT NULL,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wrong_recommendations_id` PRIMARY KEY(`id`),
	CONSTRAINT `wrong_recommendations_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_salt` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `error_type` varchar(24) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `has_analysis` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `insight_status` varchar(16) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `review_stage` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `review_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `next_review_at` timestamp;--> statement-breakpoint
ALTER TABLE `wrong_items` ADD `last_reviewed_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_drafts_user` ON `essay_drafts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_essays_user` ON `essays` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_materials_user` ON `user_materials` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_insights_user` ON `wrong_insights` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_user_content` ON `pipeline_jobs` (`user_id`,`kind`,`ref_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_records_user` ON `practice_records` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_wrong_user` ON `wrong_items` (`user_id`);