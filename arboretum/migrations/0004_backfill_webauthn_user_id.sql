-- Accounts from before the WebAuthn user handle existed get one: 32 random bytes as 64 hex characters, which is
-- also valid base64url (it decodes to 48 bytes, under the 64 WebAuthn allows) and round-trips unchanged.
UPDATE `users` SET `webauthn_user_id` = lower(hex(randomblob(32))) WHERE `webauthn_user_id` IS NULL;
