CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`challenge` text NOT NULL,
	`purpose` text NOT NULL,
	`user_id` integer,
	`pending_username` text,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "challenges_purpose" CHECK("challenges"."purpose" in ('register', 'login', 'add-passkey'))
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer NOT NULL,
	`transports` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credentials_user` ON `credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `rate_events` (
	`ip` text NOT NULL,
	`action` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_events_ip_action` ON `rate_events` (`ip`,`action`,`at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);