-- Phase 8g Task 3: The Proctor Broadcast (`C-10`, `K12`, `K13`).
-- A nullable `proctor_message` and epoch ms timestamp `proctor_message_at`.
-- Null means no broadcast pending; populated means pending delivery on candidate responses.
ALTER TABLE `attempt` ADD COLUMN `proctor_message` text;
ALTER TABLE `attempt` ADD COLUMN `proctor_message_at` integer;
