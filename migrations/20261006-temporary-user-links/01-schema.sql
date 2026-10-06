-- 임시 사용자 → 가입 사용자 연결 기능. 공용 DB에 운영자가 1회 실행합니다.
-- 선행: 20261006-temporary-users의 통합 user 스키마가 적용되어 있어야 합니다.
-- 기존 사용자/일정/서류 데이터의 삭제나 이관은 하지 않습니다.
-- 실행 순서: DB 백업 → 이 파일 → Prisma Client 생성 및 백엔드 배포 → 앱 반영.
-- MySQL DDL은 자동 커밋됩니다. 일부만 실행됐다면 INFORMATION_SCHEMA로 확인 후
-- 누락 구문만 적용하세요. 전체 파일을 중복 실행하지 마세요.

-- AlterTable
ALTER TABLE `user` ADD COLUMN `temporary_linked_at` DATETIME(3) NULL,
    ADD COLUMN `temporary_linked_to_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `temporary_user_link_audit` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `source_id` INTEGER NOT NULL,
    `target_id` INTEGER NOT NULL,
    `actor_id` INTEGER NOT NULL,
    `source_user_id` VARCHAR(50) NOT NULL,
    `target_user_id` VARCHAR(50) NOT NULL,
    `actor_user_id` VARCHAR(50) NOT NULL,
    `source_name` VARCHAR(50) NOT NULL,
    `target_name` VARCHAR(50) NOT NULL,
    `actor_name` VARCHAR(50) NOT NULL,
    `origin_schedule_id` INTEGER UNSIGNED NOT NULL,
    `details` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `temporary_user_link_audit_source_id_key`(`source_id`),
    INDEX `temporary_user_link_audit_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `temporary_user_link_audit_target_id_created_at_idx`(`target_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `temporary_user_link_schedule` (
    `audit_id` INTEGER UNSIGNED NOT NULL,
    `schedule_id` INTEGER UNSIGNED NOT NULL,

    INDEX `temporary_user_link_schedule_schedule_id_idx`(`schedule_id`),
    PRIMARY KEY (`audit_id`, `schedule_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `temporary_user_link_schedule` ADD CONSTRAINT `temporary_user_link_schedule_audit_id_fkey` FOREIGN KEY (`audit_id`) REFERENCES `temporary_user_link_audit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
