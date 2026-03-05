CREATE TABLE `dismissed_duplicate_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`post_id_a` text NOT NULL,
	`post_id_b` text NOT NULL,
	`dismissed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_pairs_idx` ON `dismissed_duplicate_pairs` (`project_id`,`post_id_a`,`post_id_b`);--> statement-breakpoint
CREATE TABLE `embedding_keys` (
	`label` integer PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`project_id` text NOT NULL,
	`content_hash` text NOT NULL
);
