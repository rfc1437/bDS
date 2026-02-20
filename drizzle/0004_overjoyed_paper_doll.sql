CREATE TABLE `generated_file_hashes` (
	`project_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_file_hashes_project_path_idx` ON `generated_file_hashes` (`project_id`,`relative_path`);