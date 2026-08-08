ALTER TABLE `vocab_items` MODIFY COLUMN `image` longtext;--> statement-breakpoint
CREATE INDEX `idx_analyses_source_ref_created` ON `analyses` (`source`,`passage_id`,`created_at`);