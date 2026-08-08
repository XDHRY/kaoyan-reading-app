CREATE TABLE `interactive_records` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`kind` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`ref_id` bigint unsigned NOT NULL,
	`q_no` int NOT NULL,
	`my_q_type` varchar(32) NOT NULL DEFAULT '',
	`my_para_no` int,
	`my_answer` varchar(1) NOT NULL,
	`my_reflection` text,
	`correct` boolean NOT NULL,
	`step_score` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `interactive_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_interactive_user` ON `interactive_records` (`user_id`,`kind`,`ref_id`);