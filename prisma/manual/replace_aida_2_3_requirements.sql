-- Shared allblue database. Run before deploying the backend/mobile changes.
-- Retrying skips an existing measured_value column, but still resets AIDA2/3 achievements.
-- Only AIDA levels 2 and 3 are replaced. Their old achievement rows are deleted.
-- User licenses, certificates, debriefings and other levels/associations are retained.
-- STA uses unit SEC and measured_value in total seconds; DYN/CWT/FIM use METER.
-- Theory Exam uses PERFORMANCE. User-provided task lists use SCHOOL provenance.
USE allblue;
-- MySQL-compatible conditional DDL (ADD COLUMN IF NOT EXISTS is not portable).
SET @aida_measurement_ddl = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_license_achievement'
      AND COLUMN_NAME = 'measured_value'
  ),
  'SELECT ''measured_value already exists; skipping ADD COLUMN'' AS migration_info',
  'ALTER TABLE user_license_achievement ADD COLUMN measured_value DECIMAL(7,2) NULL'
);
PREPARE aida_measurement_stmt FROM @aida_measurement_ddl;
EXECUTE aida_measurement_stmt;
DEALLOCATE PREPARE aida_measurement_stmt;

-- Run the entire file as a script on ONE connection; stop on the first error.
-- Rows are validated in a temporary table before any existing tasks are deleted.
SET @aida2 = (SELECT l.id FROM license l JOIN association a ON a.id = l.association_id WHERE a.code = 'AIDA' AND l.level_order = 2 AND l.is_instructor = 0);
SET @aida3 = (SELECT l.id FROM license l JOIN association a ON a.id = l.association_id WHERE a.code = 'AIDA' AND l.level_order = 3 AND l.is_instructor = 0);
DROP TEMPORARY TABLE IF EXISTS aida_requirement_stage;
CREATE TEMPORARY TABLE aida_requirement_stage LIKE license_requirement;
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, NULL, 'PERFORMANCE', 'SKILL', NULL, 'Theory Exam', '이론시험', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 10, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, NULL, 'POOL', 'GROUP', NULL, 'Pool Requirements', '제한수역', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 20, NOW());
SET @group_id = 20;
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'Snorkel 300m or Swim 200m', '스노클링300m / 수영 200m', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 30, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'Relaxation', '긴장완화', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 40, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'Breathing', '호흡법', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 50, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'STA Buddying', 'STA 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 60, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'STA Rescue', 'STA 구조', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 70, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'DYN Buddying', 'DYN 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 80, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'DYN Finning', 'DYN 피닝', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 90, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'SKILL', NULL, 'DYN Rescue', 'DYN 구조', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 100, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'MEASURE', 'STA', 'STA', NULL, 'SEC', NULL, NULL, NULL, 0, 'SCHOOL', 110, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'POOL', 'MEASURE', 'DYN', 'DYN', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 120, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, NULL, 'OPEN_WATER', 'GROUP', NULL, 'Open Water Requirements', '개방수역', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 130, NOW());
SET @group_id = 130;
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'FIM', '', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 140, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Lanyard Q/R (Optional)', '랜야드 빠른제거', 'NONE', NULL, NULL, NULL, 1, 'SCHOOL', 150, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Controlled Turn', '적절한 방향전환', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 160, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Equalization', '압력평형', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 170, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Duck dives', '덕다이브', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 180, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Body positioning', 'CWT 자세', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 190, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Line orientation', 'CWT 라인정렬', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 200, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Finning', 'CWT 피닝', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 210, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Buddying', 'CWT 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 220, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Surface rescue', '수면 구조', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 230, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Rescue 5-10m', '수심 구조 5-10m', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 240, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'MEASURE', 'CWT', 'CWT', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 250, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida2, @group_id, 'OPEN_WATER', 'MEASURE', 'FIM', 'FIM', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 260, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, NULL, 'PERFORMANCE', 'SKILL', NULL, 'Theory Exam', '이론시험', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 10, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, NULL, 'POOL', 'GROUP', NULL, 'Pool Requirements', '제한수역', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 20, NOW());
SET @group_id = 20;
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'STA Buddying', 'STA 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 30, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'STA Rescue', 'STA 레스큐', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 40, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'DYN Buoyancy', 'DYN 부력', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 50, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'DYN CO2 Table', 'DYN CO2테이블', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 60, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'DYN Buddying', 'DYN 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 70, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'DYN Finning', 'DYN 피닝', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 80, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'SKILL', NULL, 'DYN Rescue', 'DYN 구조', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 90, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'MEASURE', 'DYN', 'DYN', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 100, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'POOL', 'MEASURE', 'STA', 'STA', NULL, 'SEC', NULL, NULL, NULL, 0, 'SCHOOL', 110, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, NULL, 'OPEN_WATER', 'GROUP', NULL, 'Open Water Requirements', '개방수역', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 120, NOW());
SET @group_id = 120;
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Neutral Buoyancy', '중성부력', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 130, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Lanyard Quick release', '랜야드 빠른제거', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 140, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Controlled Turn', '적절한 방향전환', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 150, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Loss of mask -10m', '셀프레스큐: 노마스크 - 10m', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 160, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Arms-only ascent - 15m', '셀프레스큐: 암스온리 - 15m', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 170, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Line orientation', 'CWT 라인정렬', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 180, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Finning', 'CWT 피닝', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 190, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'CWT Buddying', 'CWT 버디', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 200, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Free-Fall', '프리폴', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 210, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Frenzel Equalization', '프렌젤 압력평형', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 220, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Surface rescue', '수면 구조', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 230, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, '50m tow', '50m 토잉', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 240, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'SKILL', NULL, 'Rescue 10-15m', '수심 구조 10-15m', 'NONE', NULL, NULL, NULL, 0, 'SCHOOL', 250, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'MEASURE', 'CWT', 'CWT', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 260, NOW());
INSERT INTO aida_requirement_stage (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) VALUES (@aida3, @group_id, 'OPEN_WATER', 'MEASURE', 'FIM', 'FIM', NULL, 'METER', NULL, NULL, NULL, 0, 'SCHOOL', 270, NOW());

-- All four group IDs in staging are sort_order values, mapped to real IDs below.
SET @aida_stage_valid = (
  @aida2 IS NOT NULL AND @aida3 IS NOT NULL
  AND (SELECT COUNT(*) FROM aida_requirement_stage WHERE license_id = @aida2) = 26
  AND (SELECT COUNT(*) FROM aida_requirement_stage WHERE license_id = @aida3) = 27
);
START TRANSACTION;
DELETE ach FROM user_license_achievement ach JOIN license_requirement r ON r.id = ach.requirement_id
WHERE @aida_stage_valid = 1 AND r.license_id IN (@aida2, @aida3);
UPDATE license_requirement SET parent_id = NULL WHERE @aida_stage_valid = 1 AND license_id IN (@aida2, @aida3);
DELETE FROM license_requirement WHERE @aida_stage_valid = 1 AND license_id IN (@aida2, @aida3);
INSERT INTO license_requirement (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) SELECT s.license_id, NULL, s.req_group, s.req_type, s.code, s.name, s.name_ko, s.unit, s.min_value, s.max_value, s.display_value, s.is_optional, s.source_type, s.sort_order, s.updated_at FROM aida_requirement_stage s WHERE @aida_stage_valid = 1 AND s.parent_id IS NULL ORDER BY s.license_id, s.sort_order;
INSERT INTO license_requirement (license_id, parent_id, req_group, req_type, code, name, name_ko, unit, min_value, max_value, display_value, is_optional, source_type, sort_order, updated_at) SELECT s.license_id, g.id, s.req_group, s.req_type, s.code, s.name, s.name_ko, s.unit, s.min_value, s.max_value, s.display_value, s.is_optional, s.source_type, s.sort_order, s.updated_at FROM aida_requirement_stage s JOIN license_requirement g ON g.license_id = s.license_id AND g.sort_order = s.parent_id AND g.req_type = 'GROUP' WHERE @aida_stage_valid = 1 AND s.parent_id IS NOT NULL ORDER BY s.license_id, s.sort_order;
COMMIT;
DROP TEMPORARY TABLE aida_requirement_stage;
SELECT @aida_stage_valid AS replacement_completed;
-- Expected: AIDA2 26 rows (24 tasks + 2 headings), AIDA3 27 rows (25 tasks + 2 headings).
SELECT l.code, COUNT(*) AS rows_count, SUM(r.req_type <> 'GROUP') AS task_count,
       SUM(r.req_type = 'MEASURE') AS measure_count
FROM license_requirement r JOIN license l ON l.id = r.license_id JOIN association a ON a.id = l.association_id
WHERE a.code = 'AIDA' AND l.level_order IN (2, 3) AND l.is_instructor = 0
GROUP BY l.id, l.code;
