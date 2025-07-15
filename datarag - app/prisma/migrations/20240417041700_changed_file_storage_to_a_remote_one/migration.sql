/*
  Warnings:

  - You are about to drop the column `file` on the `Document` table. All the data in the column will be lost.
  - Added the required column `fileurl` to the `Document` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Document` DROP COLUMN `file`,
    ADD COLUMN `fileurl` VARCHAR(191) NOT NULL;
