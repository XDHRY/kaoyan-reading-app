CREATE TABLE `announcements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`title` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`author_name` varchar(64) NOT NULL DEFAULT '掌门',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_attachments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint unsigned NOT NULL,
	`name` varchar(128) NOT NULL DEFAULT '',
	`mime` varchar(32) NOT NULL DEFAULT 'image/jpeg',
	`size` int NOT NULL DEFAULT 0,
	`data_base64` mediumtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticket_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_replies` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint unsigned NOT NULL,
	`author_id` bigint unsigned NOT NULL,
	`author_role` enum('user','admin') NOT NULL,
	`author_name` varchar(64) NOT NULL DEFAULT '',
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticket_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`kind` enum('bug','suggest','question','other') NOT NULL DEFAULT 'bug',
	`title` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`page_url` varchar(255) NOT NULL DEFAULT '',
	`location_text` varchar(255) NOT NULL DEFAULT '',
	`error_text` text,
	`console_errors` json,
	`user_agent` varchar(255) NOT NULL DEFAULT '',
	`viewport` varchar(32) NOT NULL DEFAULT '',
	`app_version` varchar(32) NOT NULL DEFAULT '',
	`status` enum('open','processing','resolved','closed') NOT NULL DEFAULT 'open',
	`status_log` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ticket_attach` ON `ticket_attachments` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_ticket_reply` ON `ticket_replies` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_ticket_user` ON `tickets` (`user_id`,`status`);