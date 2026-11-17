ALTER TABLE `challenges` ADD `pending_user_handle` text;--> statement-breakpoint
ALTER TABLE `users` ADD `webauthn_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_webauthn_user_id_unique` ON `users` (`webauthn_user_id`);