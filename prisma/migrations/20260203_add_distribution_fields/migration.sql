-- AlterTable
ALTER TABLE `PledgeRaidParticipant` ADD COLUMN `distributionAmount` INTEGER NULL DEFAULT 0,
ADD COLUMN `isDistributed` VARCHAR(1) NOT NULL DEFAULT 'N';
