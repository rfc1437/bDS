CREATE TABLE `db_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`from_cli` integer DEFAULT 1 NOT NULL,
	`seen_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `scripts` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `scripts` ADD `content` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `content` text;