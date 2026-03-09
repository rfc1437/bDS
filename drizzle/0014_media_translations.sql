CREATE TABLE `media_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`translation_for` text NOT NULL,
	`language` text NOT NULL,
	`title` text,
	`alt` text,
	`caption` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_translations_translation_language_idx` ON `media_translations` (`translation_for`,`language`);--> statement-breakpoint
ALTER TABLE `media` ADD `language` text;