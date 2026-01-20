-- CreateTable
CREATE TABLE `ClanRequest` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `world` VARCHAR(50) NOT NULL,
    `serverNo` INTEGER NOT NULL,
    `clanName` VARCHAR(100) NOT NULL,
    `loginId` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `depositorName` VARCHAR(50) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewerNote` VARCHAR(255) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_status_created`(`status`, `createdAt`),
    UNIQUE INDEX `ClanRequest_world_serverNo_clanName_key`(`world`, `serverNo`, `clanName`),
    UNIQUE INDEX `ClanRequest_world_serverNo_loginId_key`(`world`, `serverNo`, `loginId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Clan` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `world` VARCHAR(50) NOT NULL,
    `serverNo` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Clan_world_serverNo_name_key`(`world`, `serverNo`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clanId` BIGINT NULL,
    `loginId` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'LEADER', 'USER') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_loginId_key`(`loginId`),
    INDEX `idx_user_clan`(`clanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BossMeta` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `respawn` INTEGER NOT NULL,
    `isRandom` BOOLEAN NOT NULL DEFAULT false,
    `location` VARCHAR(255) NOT NULL,
    `tpSave` VARCHAR(50) NULL,
    `difficulty` VARCHAR(20) NULL,
    `notes` VARCHAR(255) NULL,
    `orderNo` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isFixBoss` VARCHAR(1) NOT NULL DEFAULT 'N',
    `genTime` SMALLINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BossMeta_name_key`(`name`),
    INDEX `idx_bossmeta_isfixboss`(`isFixBoss`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BossTimeline` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clanId` BIGINT NOT NULL,
    `bossName` VARCHAR(191) NOT NULL,
    `cutAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `imageIds` JSON NULL,
    `respawn` INTEGER NULL,
    `noGenCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_timeline_clan`(`clanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LootItem` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `timelineId` BIGINT NOT NULL,
    `itemName` VARCHAR(100) NOT NULL,
    `isSold` BOOLEAN NOT NULL DEFAULT false,
    `soldAt` DATETIME(3) NULL,
    `soldPrice` INTEGER NULL,
    `toTreasury` BOOLEAN NOT NULL DEFAULT false,
    `lootUserId` VARCHAR(100) NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(50) NOT NULL,

    INDEX `idx_lootitem_timeline`(`timelineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LootDistribution` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `timelineId` BIGINT NOT NULL,
    `lootItemId` BIGINT NULL,
    `recipientLoginId` VARCHAR(50) NOT NULL,
    `amount` INTEGER NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT false,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(50) NOT NULL,

    INDEX `idx_distribution_timeline`(`timelineId`),
    INDEX `idx_distribution_lootitem`(`lootItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `treasury_ledger` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clanId` BIGINT NOT NULL,
    `timelineId` BIGINT NULL,
    `lootItemId` BIGINT NULL,
    `entryType` ENUM('SALE_TREASURY', 'MANUAL_IN', 'MANUAL_OUT', 'PLEDGE_RAID', 'PLEDGE_RAID_CANCEL') NOT NULL,
    `amount` INTEGER NOT NULL,
    `note` VARCHAR(255) NULL,
    `balance` INTEGER NOT NULL,
    `createdBy` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_treasury_clan_created`(`clanId`, `created_at`),
    INDEX `treasury_ledger_lootItemId_fkey`(`lootItemId`),
    INDEX `treasury_ledger_timelineId_fkey`(`timelineId`),
    UNIQUE INDEX `treasury_ledger_clanId_entryType_timelineId_lootItemId_key`(`clanId`, `entryType`, `timelineId`, `lootItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BossCounter` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `clanId` BIGINT NOT NULL,
    `bossName` VARCHAR(50) NOT NULL,
    `dazeCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_bossCounterClan`(`clanId`),
    UNIQUE INDEX `BossCounter_clanId_bossName_key`(`clanId`, `bossName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feedback` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `status` ENUM('WRITTEN', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'REJECTED') NOT NULL DEFAULT 'WRITTEN',
    `authorId` BIGINT NOT NULL,
    `handledById` BIGINT NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Feedback_createdAt_idx`(`createdAt`),
    INDEX `Feedback_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `Feedback_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `Feedback_deleted_createdAt_idx`(`deleted`, `createdAt`),
    INDEX `Feedback_title_idx`(`title`),
    INDEX `Feedback_deletedById_fkey`(`deletedById`),
    INDEX `Feedback_handledById_fkey`(`handledById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeedbackComment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `feedbackId` BIGINT NOT NULL,
    `authorId` BIGINT NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `deleted` BOOLEAN NOT NULL DEFAULT false,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeedbackComment_feedbackId_createdAt_idx`(`feedbackId`, `createdAt`),
    INDEX `FeedbackComment_authorId_createdAt_idx`(`authorId`, `createdAt`),
    INDEX `FeedbackComment_deleted_idx`(`deleted`),
    INDEX `FeedbackComment_deletedById_fkey`(`deletedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PledgeBossRaidMeta` (
    `bossMetaId` INTEGER NOT NULL AUTO_INCREMENT,
    `raidLevel` INTEGER NOT NULL,
    `bossName` VARCHAR(191) NOT NULL,
    `howManyKey` INTEGER NOT NULL,
    `useYn` VARCHAR(191) NOT NULL DEFAULT 'Y',

    PRIMARY KEY (`bossMetaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `itemId` INTEGER NOT NULL AUTO_INCREMENT,
    `itemName` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL,

    PRIMARY KEY (`itemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PledgeRaidResult` (
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `week` INTEGER NOT NULL,
    `clanId` INTEGER NOT NULL,
    `bossMetaId` INTEGER NOT NULL,
    `isTreasury` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(64) NULL,
    `updatedBy` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL,

    PRIMARY KEY (`year`, `month`, `week`, `clanId`, `bossMetaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PledgeRaidParticipant` (
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `week` INTEGER NOT NULL,
    `clanId` INTEGER NOT NULL,
    `bossMetaId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`year`, `month`, `week`, `clanId`, `bossMetaId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PledgeRaidDropItem` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `week` INTEGER NOT NULL,
    `clanId` INTEGER NOT NULL,
    `bossMetaId` INTEGER NOT NULL,
    `isSold` INTEGER NOT NULL,
    `soldPrice` INTEGER NOT NULL,
    `isTreasury` INTEGER NOT NULL DEFAULT 0,
    `itemName` VARCHAR(191) NOT NULL,
    `rootUserId` VARCHAR(191) NOT NULL,
    `isDistributed` INTEGER NOT NULL DEFAULT 0,

    INDEX `PledgeRaidDropItem_year_month_week_clanId_bossMetaId_idx`(`year`, `month`, `week`, `clanId`, `bossMetaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BossTimeline` ADD CONSTRAINT `BossTimeline_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LootItem` ADD CONSTRAINT `LootItem_timelineId_fkey` FOREIGN KEY (`timelineId`) REFERENCES `BossTimeline`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LootDistribution` ADD CONSTRAINT `LootDistribution_lootItemId_fkey` FOREIGN KEY (`lootItemId`) REFERENCES `LootItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LootDistribution` ADD CONSTRAINT `LootDistribution_timelineId_fkey` FOREIGN KEY (`timelineId`) REFERENCES `BossTimeline`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `treasury_ledger` ADD CONSTRAINT `treasury_ledger_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `treasury_ledger` ADD CONSTRAINT `treasury_ledger_lootItemId_fkey` FOREIGN KEY (`lootItemId`) REFERENCES `LootItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `treasury_ledger` ADD CONSTRAINT `treasury_ledger_timelineId_fkey` FOREIGN KEY (`timelineId`) REFERENCES `BossTimeline`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BossCounter` ADD CONSTRAINT `BossCounter_clanId_fkey` FOREIGN KEY (`clanId`) REFERENCES `Clan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_handledById_fkey` FOREIGN KEY (`handledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackComment` ADD CONSTRAINT `FeedbackComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackComment` ADD CONSTRAINT `FeedbackComment_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeedbackComment` ADD CONSTRAINT `FeedbackComment_feedbackId_fkey` FOREIGN KEY (`feedbackId`) REFERENCES `Feedback`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
