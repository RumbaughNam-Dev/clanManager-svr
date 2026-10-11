-- 개발·운영이 공유하는 AllBlue DB에 한 번만 실행합니다.
-- 기존 자격증은 NULL로 남겨 이미지 연결을 추정하지 않습니다.
ALTER TABLE `user_license`
  ADD COLUMN `cert_request_id` INT NULL,
  ADD INDEX `idx_ul_cert_request` (`cert_request_id`),
  ADD CONSTRAINT `user_license_cert_request_id_fkey`
    FOREIGN KEY (`cert_request_id`) REFERENCES `cert_request` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
