-- Run against the AllBlue database before deploying the notice API.
CREATE TABLE IF NOT EXISTS `notice` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(200) NOT NULL,
  `content` TEXT NOT NULL,
  `pinned` BOOLEAN NOT NULL DEFAULT false,
  `popup` BOOLEAN NOT NULL DEFAULT false,
  `deleted` BOOLEAN NOT NULL DEFAULT false,
  `authorId` VARCHAR(191) NOT NULL,
  `authorName` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `notice_deleted_pinned_createdAt_idx` (`deleted`, `pinned`, `createdAt`),
  INDEX `notice_deleted_popup_createdAt_idx` (`deleted`, `popup`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
