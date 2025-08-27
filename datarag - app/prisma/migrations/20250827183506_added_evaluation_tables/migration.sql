-- DropIndex
DROP INDEX `document_chunks_vectorId_idx` ON `document_chunks`;

-- AlterTable
ALTER TABLE `chat_sessions` MODIFY `modelKey` VARCHAR(191) NOT NULL DEFAULT 'openai/gpt-oss-20b';

-- CreateTable
CREATE TABLE `evaluation_runs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `config` TEXT NOT NULL,
    `results` LONGTEXT NOT NULL,
    `totalTests` INTEGER NOT NULL,
    `avgScore` DOUBLE NOT NULL,
    `executionTime` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `evaluation_runs_userId_idx`(`userId`),
    INDEX `evaluation_runs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_datasets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL DEFAULT '',
    `dataset` LONGTEXT NOT NULL,
    `itemCount` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `evaluation_datasets_userId_idx`(`userId`),
    INDEX `evaluation_datasets_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_performance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `modelId` VARCHAR(191) NOT NULL,
    `modelName` VARCHAR(191) NOT NULL,
    `avgScore` DOUBLE NOT NULL,
    `testCount` INTEGER NOT NULL,
    `avgExecutionTime` DOUBLE NOT NULL,
    `lastEvaluated` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `retrievalScore` DOUBLE NOT NULL DEFAULT 0,
    `augmentationScore` DOUBLE NOT NULL DEFAULT 0,
    `generationScore` DOUBLE NOT NULL DEFAULT 0,
    `relevanceScore` DOUBLE NOT NULL DEFAULT 0,
    `accuracyScore` DOUBLE NOT NULL DEFAULT 0,
    `completenessScore` DOUBLE NOT NULL DEFAULT 0,
    `coherenceScore` DOUBLE NOT NULL DEFAULT 0,

    INDEX `model_performance_userId_idx`(`userId`),
    INDEX `model_performance_modelId_idx`(`modelId`),
    UNIQUE INDEX `model_performance_userId_modelId_key`(`userId`, `modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evaluation_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `metric` VARCHAR(191) NOT NULL,
    `value` DOUBLE NOT NULL,
    `testCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `evaluation_metrics_userId_date_idx`(`userId`, `date`),
    INDEX `evaluation_metrics_metric_idx`(`metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
