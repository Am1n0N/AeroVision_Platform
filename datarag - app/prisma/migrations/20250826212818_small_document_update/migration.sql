/*
  Warnings:

  - You are about to alter the column `eventType` on the `analytics_events` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(100)`.
  - You are about to alter the column `category` on the `knowledge_base_entries` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(100)`.
  - You are about to alter the column `name` on the `knowledge_base_tags` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(50)`.
  - A unique constraint covering the columns `[name]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vectorId]` on the table `document_chunks` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[vectorId]` on the table `knowledge_base_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `analytics_events` MODIFY `eventType` VARCHAR(100) NOT NULL,
    MODIFY `metadata` TEXT NULL;

-- AlterTable
ALTER TABLE `chat_messages` MODIFY `content` TEXT NOT NULL,
    MODIFY `metadata` TEXT NULL;

-- AlterTable
ALTER TABLE `document_chunks` MODIFY `chunkType` VARCHAR(191) NULL DEFAULT 'text',
    MODIFY `metadata` TEXT NULL;

-- AlterTable
ALTER TABLE `document_messages` MODIFY `content` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `errorReason` TEXT NULL,
    MODIFY `description` TEXT NULL,
    MODIFY `fileUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `knowledge_base_entries` MODIFY `title` VARCHAR(500) NOT NULL,
    MODIFY `category` VARCHAR(100) NULL,
    MODIFY `metadata` TEXT NULL;

-- AlterTable
ALTER TABLE `knowledge_base_tags` MODIFY `name` VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE `message_sources` MODIFY `metadata` TEXT NULL;

-- AlterTable
ALTER TABLE `query_history` MODIFY `errorMessage` TEXT NULL,
    MODIFY `context` TEXT NULL;

-- CreateIndex
CREATE INDEX `analytics_events_eventType_timestamp_idx` ON `analytics_events`(`eventType`, `timestamp`);

-- CreateIndex
CREATE UNIQUE INDEX `Category_name_key` ON `Category`(`name`);

-- CreateIndex
CREATE INDEX `Category_name_idx` ON `Category`(`name`);

-- CreateIndex
CREATE UNIQUE INDEX `document_chunks_vectorId_key` ON `document_chunks`(`vectorId`);

-- CreateIndex
CREATE INDEX `document_chunks_documentId_chunkIndex_idx` ON `document_chunks`(`documentId`, `chunkIndex`);

-- CreateIndex
CREATE INDEX `document_messages_userId_idx` ON `document_messages`(`userId`);

-- CreateIndex
CREATE INDEX `documents_userId_status_idx` ON `documents`(`userId`, `status`);

-- CreateIndex
CREATE INDEX `documents_createdAt_idx` ON `documents`(`createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `knowledge_base_entries_vectorId_key` ON `knowledge_base_entries`(`vectorId`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_userId_isPublic_idx` ON `knowledge_base_entries`(`userId`, `isPublic`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_category_isPublic_idx` ON `knowledge_base_entries`(`category`, `isPublic`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_createdAt_idx` ON `knowledge_base_entries`(`createdAt`);

-- CreateIndex
CREATE FULLTEXT INDEX `knowledge_base_entries_title_content_idx` ON `knowledge_base_entries`(`title`, `content`);

-- CreateIndex
CREATE INDEX `query_history_userId_success_idx` ON `query_history`(`userId`, `success`);

-- CreateIndex
CREATE INDEX `user_settings_userId_idx` ON `user_settings`(`userId`);
