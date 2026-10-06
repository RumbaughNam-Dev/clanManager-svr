-- Run once AFTER 02-drop-legacy-guests.sql and 03-verify.sql, while writers remain stopped.
-- missing_debriefing_users must be zero. Never disable foreign_key_checks.
ALTER TABLE debriefing ADD CONSTRAINT fk_debriefing_participant_user
  FOREIGN KEY (participant_id) REFERENCES `user` (id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
