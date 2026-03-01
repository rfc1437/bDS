CREATE TABLE `model_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`family` text,
	`context_window` integer,
	`max_input_tokens` integer,
	`max_output_tokens` integer,
	`input_price` real,
	`output_price` real,
	`cache_read_price` real,
	`supports_attachments` integer DEFAULT false,
	`supports_reasoning` integer DEFAULT false,
	`supports_tool_call` integer DEFAULT false,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_catalog_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
