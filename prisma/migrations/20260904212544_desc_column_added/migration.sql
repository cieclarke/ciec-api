/*
  Warnings:

  - Added the required column `description` to the `Image` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Image` ADD COLUMN `description` VARCHAR(255) NULL;

-- Backfill existing rows with empty string
UPDATE `Image` SET `description` = '';

-- Make the column NOT NULL
ALTER TABLE `Image` MODIFY COLUMN `description` VARCHAR(255) NOT NULL;
