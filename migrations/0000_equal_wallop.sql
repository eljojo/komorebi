CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`label` text NOT NULL,
	`scope` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "api_tokens_scope" CHECK("api_tokens"."scope" in ('read', 'write')),
	CONSTRAINT "api_tokens_label" CHECK(length("api_tokens"."label") between 1 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `playlist_items` (
	`playlist_id` integer NOT NULL,
	`position` integer NOT NULL,
	`preset_id` integer NOT NULL,
	`dwell_s` real NOT NULL,
	`crossfade_s` real NOT NULL,
	PRIMARY KEY(`playlist_id`, `position`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preset_id`) REFERENCES `presets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`share_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "playlists_visibility" CHECK("playlists"."visibility" in ('public', 'unlisted', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlists_share_token_unique` ON `playlists` (`share_token`);--> statement-breakpoint
CREATE INDEX `playlists_owner` ON `playlists` (`owner_id`);--> statement-breakpoint
CREATE TABLE `preset_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`preset_id` integer NOT NULL,
	`n` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`tags` text NOT NULL,
	`params` text NOT NULL,
	`komorebi_commit` text,
	`parent` text,
	`via` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`preset_id`) REFERENCES `presets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preset_versions_preset_n` ON `preset_versions` (`preset_id`,`n`);--> statement-breakpoint
CREATE TABLE `presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`share_token` text NOT NULL,
	`head_version_id` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "presets_visibility" CHECK("presets"."visibility" in ('public', 'unlisted', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presets_share_token_unique` ON `presets` (`share_token`);--> statement-breakpoint
CREATE INDEX `presets_owner` ON `presets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);