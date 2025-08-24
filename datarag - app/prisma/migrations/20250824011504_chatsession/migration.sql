-- CreateTable
CREATE TABLE `ChatSession` (
    `id` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modelKey` VARCHAR(191) NOT NULL DEFAULT 'deepseek-r1:7b',
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `messageCount` INTEGER NOT NULL DEFAULT 0,
    `useDatabase` BOOLEAN NOT NULL DEFAULT true,
    `useKnowledgeBase` BOOLEAN NOT NULL DEFAULT true,
    `temperature` DOUBLE NOT NULL DEFAULT 0.2,
    `maxTokens` INTEGER NOT NULL DEFAULT 4000,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatSession_userId_idx`(`userId`),
    INDEX `ChatSession_lastMessageAt_idx`(`lastMessageAt`),
    INDEX `ChatSession_userId_lastMessageAt_idx`(`userId`, `lastMessageAt`),
    FULLTEXT INDEX `ChatSession_title_idx`(`title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `role` ENUM('USER', 'ASSISTANT', 'SYSTEM') NOT NULL,
    `modelUsed` VARCHAR(191) NULL,
    `executionTime` INTEGER NULL,
    `tokensUsed` INTEGER NULL,
    `dbQueryUsed` BOOLEAN NOT NULL DEFAULT false,
    `dbQuery` TEXT NULL,
    `dbResultCount` INTEGER NULL,
    `contextSources` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatMessage_sessionId_idx`(`sessionId`),
    INDEX `ChatMessage_userId_idx`(`userId`),
    INDEX `ChatMessage_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSettings` (
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
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserSettings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
