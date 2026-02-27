CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'post' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_project_slug_idx` ON `templates` (`project_id`,`slug`);--> statement-breakpoint
ALTER TABLE `posts` ADD `template_slug` text;--> statement-breakpoint
ALTER TABLE `tags` ADD `post_template_slug` text;