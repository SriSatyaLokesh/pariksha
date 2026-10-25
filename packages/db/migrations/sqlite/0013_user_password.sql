-- Phase 10: Docker self-host password and optional TOTP (S-01, S-02).
ALTER TABLE `user` ADD COLUMN `password_hash` text;
ALTER TABLE `user` ADD COLUMN `totp_secret` text;
ALTER TABLE `user` ADD COLUMN `totp_enabled` integer DEFAULT 0 NOT NULL;
