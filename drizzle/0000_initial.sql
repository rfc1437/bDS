CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`model` text,
	`copilot_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text,
	`tool_call_id` text,
	`tool_calls` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`wxr_file_path` text,
	`uploads_folder_path` text,
	`last_analysis_result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`project_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text,
	`caption` text,
	`file_path` text NOT NULL,
	`sidecar_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`synced_at` integer,
	`checksum` text,
	`tags` text
);
--> statement-breakpoint
CREATE TABLE `post_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_post_id` text NOT NULL,
	`target_post_id` text NOT NULL,
	`link_text` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `post_media` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id` text NOT NULL,
	`media_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_media_post_media_idx` ON `post_media` (`post_id`,`media_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`project_id` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text,
	`content` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`author` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	`file_path` text DEFAULT '' NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`synced_at` integer,
	`checksum` text,
	`tags` text,
	`categories` text,
	`published_title` text,
	`published_content` text,
	`published_tags` text,
	`published_categories` text,
	`published_excerpt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_project_slug_idx` ON `posts` (`project_id`,`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`data_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`timestamp` integer NOT NULL,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_project_name_idx` ON `tags` (`project_id`,`name`);