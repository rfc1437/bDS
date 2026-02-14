DROP TABLE `sync_log`;--> statement-breakpoint
ALTER TABLE `media` DROP COLUMN `sync_status`;--> statement-breakpoint
ALTER TABLE `media` DROP COLUMN `synced_at`;--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `sync_status`;--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `synced_at`;