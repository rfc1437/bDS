CREATE TABLE `ai_models` (
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`name` text NOT NULL,
	`family` text,
	`attachment` integer DEFAULT false,
	`reasoning` integer DEFAULT false,
	`tool_call` integer DEFAULT false,
	`structured_output` integer DEFAULT false,
	`temperature` integer DEFAULT false,
	`knowledge` text,
	`release_date` text,
	`last_updated_date` text,
	`open_weights` integer DEFAULT false,
	`input_price` real,
	`output_price` real,
	`cache_read_price` real,
	`cache_write_price` real,
	`context_window` integer,
	`max_input_tokens` integer,
	`max_output_tokens` integer,
	`interleaved` text,
	`status` text,
	`provider_npm` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `model_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_catalog_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_model_modalities` (
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`direction` text NOT NULL,
	`modality` text NOT NULL,
	PRIMARY KEY(`provider`, `model_id`, `direction`, `modality`)
);
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`env` text,
	`npm` text,
	`api` text,
	`doc` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP TABLE `model_catalog`;--> statement-breakpoint
DROP TABLE `model_catalog_meta`;