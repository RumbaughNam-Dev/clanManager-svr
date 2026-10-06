-- 01-expand.sql has already been executed. Do not execute it again.
-- Shared development/production DB: stop BOTH servers and all writers first.
-- Run this once, then 04-debriefing-constraint.sql, deploy the new backend and restart.
-- Do NOT run the previous 02-migrate.sql. No user identities are migrated here.
-- MySQL DDL commits implicitly; do not ignore errors or use --force.
DROP PROCEDURE IF EXISTS remove_allblue_legacy_guests;
DELIMITER $$
CREATE PROCEDURE remove_allblue_legacy_guests()
BEGIN
  DECLARE finished BOOLEAN DEFAULT FALSE;
  DECLARE table_name_value VARCHAR(64);
  DECLARE constraint_name_value VARCHAR(64);
  DECLARE invalid_rows INT DEFAULT 0;
  DECLARE fk_cursor CURSOR FOR
    SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'guest_user'
      AND ((TABLE_NAME = 'schedule_participant' AND COLUMN_NAME = 'guest_id')
        OR (TABLE_NAME = 'form_submission' AND COLUMN_NAME = 'participant_guest_id'));
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET finished = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  SELECT COUNT(*) INTO invalid_rows FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'guest_user'
      AND NOT ((TABLE_NAME = 'schedule_participant' AND COLUMN_NAME = 'guest_id')
        OR (TABLE_NAME = 'form_submission' AND COLUMN_NAME = 'participant_guest_id'));
  IF invalid_rows > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unexpected guest_user references; inspect before dropping.';
  END IF;

  START TRANSACTION;
  -- Remove only definitely guest-only debriefings, never a valid user recipient.
  DELETE d FROM debriefing d
    JOIN schedule_participant sp ON sp.schedule_id = d.schedule_id AND sp.guest_id = d.participant_id
    LEFT JOIN `user` u ON u.id = d.participant_id
    WHERE sp.user_id IS NULL AND u.id IS NULL;
  -- Preserve real-user participation, including any old row having both IDs.
  DELETE FROM schedule_participant WHERE guest_id IS NOT NULL AND user_id IS NULL;
  -- Signed forms and their UUIDs/content remain available in the instructor's forms.
  -- Only the obsolete guest reference is removed; existing user references remain.
  UPDATE form_submission SET participant_guest_id = NULL WHERE participant_guest_id IS NOT NULL;

  SELECT COUNT(*) INTO invalid_rows FROM schedule_participant WHERE user_id IS NULL;
  IF invalid_rows > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unidentified participant rows remain; no changes committed.';
  END IF;
  SELECT COUNT(*) INTO invalid_rows FROM debriefing d LEFT JOIN `user` u ON u.id = d.participant_id WHERE u.id IS NULL;
  IF invalid_rows > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unidentified debriefing recipients remain; no changes committed.';
  END IF;
  COMMIT;

  OPEN fk_cursor;
  drop_foreign_keys: LOOP
    FETCH fk_cursor INTO table_name_value, constraint_name_value;
    IF finished THEN LEAVE drop_foreign_keys; END IF;
    SET @guest_drop_sql = CONCAT('ALTER TABLE `', REPLACE(table_name_value, '`', '``'),
      '` DROP FOREIGN KEY `', REPLACE(constraint_name_value, '`', '``'), '`');
    PREPARE guest_drop_stmt FROM @guest_drop_sql;
    EXECUTE guest_drop_stmt;
    DEALLOCATE PREPARE guest_drop_stmt;
  END LOOP;
  CLOSE fk_cursor;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'form_submission' AND INDEX_NAME = 'idx_fs_schedule_guest') THEN
    ALTER TABLE form_submission DROP INDEX idx_fs_schedule_guest;
  END IF;
  ALTER TABLE form_submission DROP COLUMN participant_guest_id;
  ALTER TABLE schedule_participant DROP COLUMN guest_id;
  DROP TABLE guest_user;
END$$
DELIMITER ;
CALL remove_allblue_legacy_guests();
DROP PROCEDURE remove_allblue_legacy_guests;
