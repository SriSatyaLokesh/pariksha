-- Phase 10: Docker self-host password and optional TOTP (S-01, S-02).
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "totp_secret" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false NOT NULL;
