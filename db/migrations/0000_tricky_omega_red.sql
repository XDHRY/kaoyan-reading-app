CREATE TABLE `analyses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`source` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`passage_id` bigint unsigned NOT NULL,
	`payload` json NOT NULL,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bindings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`role` varchar(40) NOT NULL,
	`channel_id` bigint unsigned NOT NULL,
	`model` varchar(64) NOT NULL,
	`reasoning_effort` varchar(16),
	CONSTRAINT `bindings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`kind` enum('chat','image') NOT NULL,
	`protocol` enum('openai','anthropic') NOT NULL,
	`base_url` varchar(255) NOT NULL,
	`api_key` text NOT NULL,
	`models` json NOT NULL,
	`reasoning_effort` varchar(16),
	`config` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`user_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `channels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generated_sets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`topic` varchar(128) NOT NULL,
	`difficulty` varchar(16) NOT NULL DEFAULT 'medium',
	`payload` json NOT NULL,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `generated_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_cards` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`node_id` varchar(32) NOT NULL,
	`kind` enum('main','sub','logic','option') NOT NULL,
	`title` varchar(128) NOT NULL,
	`title_en` varchar(128) NOT NULL DEFAULT '',
	`points` json NOT NULL,
	`cautions` json NOT NULL,
	`vocab` json NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `knowledge_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_cards_node_id_unique` UNIQUE(`node_id`)
);
--> statement-breakpoint
CREATE TABLE `method_clauses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`clause_id` varchar(40) NOT NULL,
	`domain` enum('structure','step','type','logic','option','sentence') NOT NULL,
	`ref_key` varchar(32) NOT NULL DEFAULT '',
	`title` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `method_clauses_id` PRIMARY KEY(`id`),
	CONSTRAINT `method_clauses_clause_id_unique` UNIQUE(`clause_id`)
);
--> statement-breakpoint
CREATE TABLE `passages` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`year` int NOT NULL,
	`text_no` int NOT NULL,
	`paragraphs` json NOT NULL,
	`source_tag` varchar(64) NOT NULL DEFAULT '',
	`verify_status` enum('verified','single_source','flagged') NOT NULL DEFAULT 'single_source',
	`verify_note` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_jobs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`kind` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`ref_id` bigint unsigned NOT NULL,
	`status` enum('running','done','error') NOT NULL DEFAULT 'running',
	`stage` varchar(20) NOT NULL DEFAULT '',
	`stages` json NOT NULL,
	`payload` json NOT NULL,
	`answers` json,
	`error_msg` varchar(512) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipeline_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `practice_records` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`source` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`passage_id` bigint unsigned NOT NULL,
	`answers` json NOT NULL,
	`verdicts` json,
	`duration_sec` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `practice_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`agent_role` varchar(40) NOT NULL,
	`name` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`is_active` boolean NOT NULL DEFAULT true,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`passage_id` bigint unsigned NOT NULL,
	`q_no` int NOT NULL,
	`stem` text NOT NULL,
	`q_type` varchar(32) NOT NULL DEFAULT 'unknown',
	`options` json NOT NULL,
	`answer` varchar(1),
	`locator_hint` varchar(255),
	CONSTRAINT `questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sentence_analyses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`source` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`passage_id` bigint unsigned NOT NULL,
	`para_no` int NOT NULL,
	`sent_idx` int NOT NULL,
	`sentence` text NOT NULL,
	`payload` json NOT NULL,
	`model_used` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sentence_analyses_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sent` UNIQUE(`source`,`passage_id`,`para_no`,`sent_idx`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`token` varchar(80) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`k` varchar(64) NOT NULL,
	`v` text NOT NULL,
	CONSTRAINT `site_settings_k` PRIMARY KEY(`k`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(32) NOT NULL,
	`password_hash` varchar(128) NOT NULL DEFAULT '',
	`salt` varchar(64) NOT NULL DEFAULT '',
	`recovery_question` varchar(128) NOT NULL DEFAULT '',
	`recovery_hash` varchar(128) NOT NULL DEFAULT '',
	`avatar_char` varchar(4) NOT NULL DEFAULT '',
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `vocab_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`word` varchar(64) NOT NULL,
	`zh` varchar(255) NOT NULL DEFAULT '',
	`context` text,
	`passage_id` bigint unsigned,
	`familiarity` int NOT NULL DEFAULT 0,
	`image` longtext,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vocab_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_vocab_user_word` UNIQUE(`user_id`,`word`)
);
--> statement-breakpoint
CREATE TABLE `wrong_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`source` enum('exam','generated') NOT NULL DEFAULT 'exam',
	`ref_id` bigint unsigned NOT NULL,
	`question_id` bigint unsigned,
	`q_no` int NOT NULL,
	`q_type` varchar(32) NOT NULL DEFAULT 'unknown',
	`stem` text NOT NULL,
	`options` json NOT NULL,
	`correct_answer` varchar(1) NOT NULL,
	`my_answer` varchar(1) NOT NULL,
	`mastered` boolean NOT NULL DEFAULT false,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wrong_items_id` PRIMARY KEY(`id`)
);
