CREATE TABLE `post_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`translation_for` text NOT NULL,
	`language` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text,
	`content` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	`file_path` text DEFAULT '' NOT NULL,
	`checksum` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_translations_translation_language_idx` ON `post_translations` (`translation_for`,`language`);