/*
  Warnings:

  - You are about to drop the `chatmessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `chatsession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `document` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `message` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `usersettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE `chatmessage`;

-- DropTable
DROP TABLE `chatsession`;

-- DropTable
DROP TABLE `document`;

-- DropTable
DROP TABLE `message`;

-- DropTable
DROP TABLE `usersettings`;

-- CreateTable
CREATE TABLE `chat_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modelKey` VARCHAR(191) NOT NULL DEFAULT 'deepseek-r1:7b',
    `useDatabase` BOOLEAN NOT NULL DEFAULT true,
    `useKnowledgeBase` BOOLEAN NOT NULL DEFAULT true,
    `temperature` DOUBLE NOT NULL DEFAULT 0.2,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastMessageAt` DATETIME(3) NULL,

    INDEX `chat_sessions_userId_isArchived_isPinned_idx`(`userId`, `isArchived`, `isPinned`),
    INDEX `chat_sessions_userId_lastMessageAt_idx`(`userId`, `lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modelUsed` VARCHAR(191) NULL,
    `executionTime` INTEGER NULL,
    `dbQueryUsed` BOOLEAN NOT NULL DEFAULT false,
    `contextSources` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `chat_messages_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `chat_messages_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_sources` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `section` VARCHAR(191) NULL,
    `pageNumber` INTEGER NULL,
    `snippet` TEXT NOT NULL,
    `relevanceScore` DOUBLE NULL,
    `url` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_sources_messageId_idx`(`messageId`),
    INDEX `message_sources_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `fileUrl` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PROCESSING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,

    INDEX `documents_userId_idx`(`userId`),
    INDEX `documents_categoryId_idx`(`categoryId`),
    INDEX `documents_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_messages` (
    `id` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_messages_documentId_createdAt_idx`(`documentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_chunks` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `chunkIndex` INTEGER NOT NULL,
    `pageNumber` INTEGER NULL,
    `chunkType` VARCHAR(191) NULL,
    `wordCount` INTEGER NULL,
    `tokenEstimate` INTEGER NULL,
    `vectorId` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_chunks_documentId_idx`(`documentId`),
    INDEX `document_chunks_chunkIndex_idx`(`chunkIndex`),
    INDEX `document_chunks_vectorId_idx`(`vectorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_base_entries` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `vectorId` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `knowledge_base_entries_category_idx`(`category`),
    INDEX `knowledge_base_entries_userId_idx`(`userId`),
    INDEX `knowledge_base_entries_isPublic_idx`(`isPublic`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_base_tags` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `knowledge_base_tags_name_key`(`name`),
    INDEX `knowledge_base_tags_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `query_history` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `query` TEXT NOT NULL,
    `sqlGenerated` TEXT NULL,
    `success` BOOLEAN NOT NULL,
    `resultCount` INTEGER NULL,
    `executionTime` INTEGER NULL,
    `errorMessage` VARCHAR(191) NULL,
    `context` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `query_history_userId_idx`(`userId`),
    INDEX `query_history_sessionId_idx`(`sessionId`),
    INDEX `query_history_success_idx`(`success`),
    INDEX `query_history_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_settings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `defaultModel` VARCHAR(191) NOT NULL DEFAULT 'deepseek-r1:7b',
    `defaultTemperature` DOUBLE NOT NULL DEFAULT 0.2,
    `useDatabase` BOOLEAN NOT NULL DEFAULT true,
    `useKnowledgeBase` BOOLEAN NOT NULL DEFAULT true,
    `theme` VARCHAR(191) NOT NULL DEFAULT 'system',
    `sidebarCollapsed` BOOLEAN NOT NULL DEFAULT false,
    `showTokenCount` BOOLEAN NOT NULL DEFAULT false,
    `showExecutionTime` BOOLEAN NOT NULL DEFAULT false,
    `showSourceReferences` BOOLEAN NOT NULL DEFAULT true,
    `maxContextLength` INTEGER NOT NULL DEFAULT 6000,
    `rerankingThreshold` DOUBLE NOT NULL DEFAULT 0.5,
    `enableReranking` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_settings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analytics_events` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `metadata` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `analytics_events_userId_eventType_idx`(`userId`, `eventType`),
    INDEX `analytics_events_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_EntryTags` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_EntryTags_AB_unique`(`A`, `B`),
    INDEX `_EntryTags_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_sources` ADD CONSTRAINT `message_sources_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `chat_messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_messages` ADD CONSTRAINT `document_messages_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_EntryTags` ADD CONSTRAINT `_EntryTags_A_fkey` FOREIGN KEY (`A`) REFERENCES `knowledge_base_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_EntryTags` ADD CONSTRAINT `_EntryTags_B_fkey` FOREIGN KEY (`B`) REFERENCES `knowledge_base_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
