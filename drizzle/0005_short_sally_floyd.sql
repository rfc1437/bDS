CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'utility' NOT NULL,
	`entrypoint` text DEFAULT 'render' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_project_slug_idx` ON `scripts` (`project_id`,`slug`);