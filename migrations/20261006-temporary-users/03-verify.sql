-- All counts must be zero after cleanup.
SELECT COUNT(*) AS legacy_guest_table FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guest_user';
SELECT COUNT(*) AS legacy_guest_columns FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = 'schedule_participant' AND COLUMN_NAME = 'guest_id')
OR (TABLE_NAME = 'form_submission' AND COLUMN_NAME = 'participant_guest_id'));
SELECT COUNT(*) AS missing_debriefing_users FROM debriefing d
LEFT JOIN `user` u ON u.id = d.participant_id WHERE u.id IS NULL;
