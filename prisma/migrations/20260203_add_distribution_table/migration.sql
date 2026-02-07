-- AlterTable
ALTER TABLE `PledgeRaidParticipant` 
DROP COLUMN `distributionAmount`,
DROP COLUMN `isDistributed`;

-- CreateTable
CREATE TABLE `PledgeRaidDistributeStatus` (
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `week` INTEGER NOT NULL,
    `clanId` INTEGER NOT NULL,
    `bossMetaId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `dropItemId` BIGINT NOT NULL,
    `distAmount` BIGINT NULL,
    `distYn` CHAR(1) NULL,

    PRIMARY KEY (`year`, `month`, `week`, `clanId`, `bossMetaId`, `userId`, `dropItemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
