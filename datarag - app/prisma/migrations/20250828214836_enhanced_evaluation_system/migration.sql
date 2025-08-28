/*
  Warnings:

  - You are about to alter the column `userId` on the `evaluation_metrics` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(64)`.
  - You are about to alter the column `metric` on the `evaluation_metrics` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(64)`.
  - A unique constraint covering the columns `[userId,date,metric,modelId,categoryId,difficulty]` on the table `evaluation_metrics` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `analytics_events` ADD COLUMN `duration` INTEGER NULL,
    ADD COLUMN `errorMessage` TEXT NULL,
    ADD COLUMN `ipAddress` VARCHAR(45) NULL,
    ADD COLUMN `success` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `userAgent` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `category` ADD COLUMN `color` VARCHAR(191) NULL DEFAULT '#3B82F6',
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `documentCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `lastUsed` DATETIME(3) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `chat_messages` ADD COLUMN `evaluationRunId` VARCHAR(191) NULL,
    ADD COLUMN `relevanceScore` DOUBLE NULL;

-- AlterTable
ALTER TABLE `chat_sessions` ADD COLUMN `contextSources` INTEGER NULL DEFAULT 0,
    ADD COLUMN `evaluationRuns` TEXT NULL;

-- AlterTable
ALTER TABLE `document_chunks` ADD COLUMN `avgRelevance` DOUBLE NULL,
    ADD COLUMN `embedding` LONGTEXT NULL,
    ADD COLUMN `language` VARCHAR(191) NULL DEFAULT 'en',
    ADD COLUMN `relevanceScores` TEXT NULL,
    ADD COLUMN `usageCount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `document_messages` ADD COLUMN `executionTime` INTEGER NULL,
    ADD COLUMN `modelUsed` VARCHAR(191) NULL,
    ADD COLUMN `relevanceScore` DOUBLE NULL;

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `fileSize` INTEGER NULL,
    ADD COLUMN `language` VARCHAR(191) NULL DEFAULT 'en',
    ADD COLUMN `lastAccessed` DATETIME(3) NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    ADD COLUMN `pageCount` INTEGER NULL,
    ADD COLUMN `processingTime` INTEGER NULL,
    ADD COLUMN `queryCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `viewCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `wordCount` INTEGER NULL;

-- AlterTable
ALTER TABLE `evaluation_datasets` ADD COLUMN `avgPerformance` DOUBLE NULL,
    ADD COLUMN `categories` TEXT NULL,
    ADD COLUMN `difficulty` VARCHAR(191) NULL,
    ADD COLUMN `isVerified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `language` VARCHAR(191) NOT NULL DEFAULT 'en',
    ADD COLUMN `lastUsed` DATETIME(3) NULL,
    ADD COLUMN `parentId` VARCHAR(191) NULL,
    ADD COLUMN `usageCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `verifiedAt` DATETIME(3) NULL,
    ADD COLUMN `verifiedBy` VARCHAR(191) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `evaluation_metrics` ADD COLUMN `categoryId` VARCHAR(36) NULL,
    ADD COLUMN `confidence` DOUBLE NULL,
    ADD COLUMN `difficulty` VARCHAR(16) NULL,
    ADD COLUMN `modelId` VARCHAR(64) NULL,
    ADD COLUMN `percentileRank` DOUBLE NULL,
    ADD COLUMN `sampleSize` INTEGER NULL,
    ADD COLUMN `zScore` DOUBLE NULL,
    MODIFY `userId` VARCHAR(64) NOT NULL,
    MODIFY `metric` VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE `evaluation_runs` ADD COLUMN `avgAccuracyScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgAugmentationScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgCoherenceScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgCompletenessScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgGenerationScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgRelevanceScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `avgRetrievalScore` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `datasetId` VARCHAR(191) NULL,
    ADD COLUMN `errorMessage` TEXT NULL,
    ADD COLUMN `estimatedCost` DOUBLE NULL,
    ADD COLUMN `progress` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `startedAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    ADD COLUMN `totalTokensUsed` INTEGER NULL;

-- AlterTable
ALTER TABLE `knowledge_base_entries` ADD COLUMN `avgRating` DOUBLE NULL,
    ADD COLUMN `isVerified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `language` VARCHAR(191) NULL DEFAULT 'en',
    ADD COLUMN `lastAccessed` DATETIME(3) NULL,
    ADD COLUMN `parentId` VARCHAR(191) NULL,
    ADD COLUMN `queryCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ratingCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `verifiedAt` DATETIME(3) NULL,
    ADD COLUMN `verifiedBy` VARCHAR(191) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `viewCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `wordCount` INTEGER NULL;

-- AlterTable
ALTER TABLE `knowledge_base_tags` ADD COLUMN `color` VARCHAR(191) NULL DEFAULT '#10B981',
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `usageCount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `message_sources` ADD COLUMN `sourceCategory` VARCHAR(191) NULL,
    ADD COLUMN `usageCount` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `model_performance` ADD COLUMN `consistencyScore` DOUBLE NULL,
    ADD COLUMN `costPerToken` DOUBLE NULL,
    ADD COLUMN `estimatedCost` DOUBLE NULL,
    ADD COLUMN `industryPercentile` DOUBLE NULL,
    ADD COLUMN `peakPerformanceScore` DOUBLE NULL,
    ADD COLUMN `performanceTrend` VARCHAR(191) NULL DEFAULT 'stable',
    ADD COLUMN `rankAmongModels` INTEGER NULL,
    ADD COLUMN `scoreHistory` TEXT NULL,
    ADD COLUMN `totalTokensUsed` INTEGER NULL,
    ADD COLUMN `worstPerformanceScore` DOUBLE NULL;

-- AlterTable
ALTER TABLE `query_history` ADD COLUMN `completionTokens` INTEGER NULL,
    ADD COLUMN `contextSources` TEXT NULL,
    ADD COLUMN `evaluationRunId` VARCHAR(191) NULL,
    ADD COLUMN `generationTime` INTEGER NULL,
    ADD COLUMN `maxTokens` INTEGER NULL,
    ADD COLUMN `modelUsed` VARCHAR(191) NULL,
    ADD COLUMN `promptTokens` INTEGER NULL,
    ADD COLUMN `queryType` VARCHAR(191) NULL,
    ADD COLUMN `responseQuality` DOUBLE NULL,
    ADD COLUMN `retrievalTime` INTEGER NULL,
    ADD COLUMN `temperature` DOUBLE NULL,
    ADD COLUMN `totalTokensUsed` INTEGER NULL;

-- AlterTable
ALTER TABLE `user_settings` ADD COLUMN `autoEvaluate` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `evaluationFrequency` VARCHAR(191) NULL DEFAULT 'weekly',
    ADD COLUMN `evaluationPreferences` TEXT NULL,
    ADD COLUMN `notificationSettings` TEXT NULL;

-- CreateTable
CREATE TABLE `knowledge_base_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `knowledge_base_ratings_entryId_rating_idx`(`entryId`, `rating`),
    INDEX `knowledge_base_ratings_userId_idx`(`userId`),
    UNIQUE INDEX `knowledge_base_ratings_entryId_userId_key`(`entryId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `analytics_events_sessionId_idx` ON `analytics_events`(`sessionId`);

-- CreateIndex
CREATE INDEX `analytics_events_success_eventType_idx` ON `analytics_events`(`success`, `eventType`);

-- CreateIndex
CREATE INDEX `Category_isActive_idx` ON `Category`(`isActive`);

-- CreateIndex
CREATE INDEX `Category_documentCount_idx` ON `Category`(`documentCount`);

-- CreateIndex
CREATE INDEX `chat_messages_evaluationRunId_idx` ON `chat_messages`(`evaluationRunId`);

-- CreateIndex
CREATE INDEX `chat_messages_modelUsed_createdAt_idx` ON `chat_messages`(`modelUsed`, `createdAt`);

-- CreateIndex
CREATE INDEX `chat_sessions_userId_modelKey_idx` ON `chat_sessions`(`userId`, `modelKey`);

-- CreateIndex
CREATE INDEX `chat_sessions_createdAt_idx` ON `chat_sessions`(`createdAt`);

-- CreateIndex
CREATE INDEX `document_chunks_usageCount_avgRelevance_idx` ON `document_chunks`(`usageCount`, `avgRelevance`);

-- CreateIndex
CREATE INDEX `document_chunks_tokenEstimate_idx` ON `document_chunks`(`tokenEstimate`);

-- CreateIndex
CREATE FULLTEXT INDEX `document_chunks_content_idx` ON `document_chunks`(`content`);

-- CreateIndex
CREATE INDEX `document_messages_modelUsed_idx` ON `document_messages`(`modelUsed`);

-- CreateIndex
CREATE INDEX `documents_queryCount_lastAccessed_idx` ON `documents`(`queryCount`, `lastAccessed`);

-- CreateIndex
CREATE INDEX `documents_wordCount_idx` ON `documents`(`wordCount`);

-- CreateIndex
CREATE FULLTEXT INDEX `documents_title_description_idx` ON `documents`(`title`, `description`);

-- CreateIndex
CREATE INDEX `evaluation_datasets_isActive_usageCount_idx` ON `evaluation_datasets`(`isActive`, `usageCount`);

-- CreateIndex
CREATE INDEX `evaluation_datasets_parentId_idx` ON `evaluation_datasets`(`parentId`);

-- CreateIndex
CREATE INDEX `evaluation_datasets_name_userId_idx` ON `evaluation_datasets`(`name`, `userId`);

-- CreateIndex
CREATE FULLTEXT INDEX `evaluation_datasets_name_description_idx` ON `evaluation_datasets`(`name`, `description`);

-- CreateIndex
CREATE INDEX `evaluation_metrics_modelId_date_idx` ON `evaluation_metrics`(`modelId`, `date`);

-- CreateIndex
CREATE INDEX `evaluation_metrics_date_value_idx` ON `evaluation_metrics`(`date`, `value`);

-- CreateIndex
CREATE UNIQUE INDEX `evaluation_metrics_userId_date_metric_modelId_categoryId_dif_key` ON `evaluation_metrics`(`userId`, `date`, `metric`, `modelId`, `categoryId`, `difficulty`);

-- CreateIndex
CREATE INDEX `evaluation_runs_status_createdAt_idx` ON `evaluation_runs`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `evaluation_runs_avgScore_createdAt_idx` ON `evaluation_runs`(`avgScore`, `createdAt`);

-- CreateIndex
CREATE INDEX `evaluation_runs_datasetId_idx` ON `evaluation_runs`(`datasetId`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_queryCount_lastAccessed_idx` ON `knowledge_base_entries`(`queryCount`, `lastAccessed`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_isVerified_avgRating_idx` ON `knowledge_base_entries`(`isVerified`, `avgRating`);

-- CreateIndex
CREATE INDEX `knowledge_base_entries_parentId_idx` ON `knowledge_base_entries`(`parentId`);

-- CreateIndex
CREATE INDEX `knowledge_base_tags_usageCount_idx` ON `knowledge_base_tags`(`usageCount`);

-- CreateIndex
CREATE INDEX `message_sources_sourceCategory_relevanceScore_idx` ON `message_sources`(`sourceCategory`, `relevanceScore`);

-- CreateIndex
CREATE INDEX `message_sources_usageCount_idx` ON `message_sources`(`usageCount`);

-- CreateIndex
CREATE INDEX `model_performance_avgScore_lastEvaluated_idx` ON `model_performance`(`avgScore`, `lastEvaluated`);

-- CreateIndex
CREATE INDEX `model_performance_userId_avgScore_idx` ON `model_performance`(`userId`, `avgScore`);

-- CreateIndex
CREATE INDEX `query_history_evaluationRunId_idx` ON `query_history`(`evaluationRunId`);

-- CreateIndex
CREATE INDEX `query_history_queryType_createdAt_idx` ON `query_history`(`queryType`, `createdAt`);

-- CreateIndex
CREATE INDEX `query_history_modelUsed_success_idx` ON `query_history`(`modelUsed`, `success`);

-- CreateIndex
CREATE FULLTEXT INDEX `query_history_query_idx` ON `query_history`(`query`);

-- AddForeignKey
ALTER TABLE `knowledge_base_entries` ADD CONSTRAINT `knowledge_base_entries_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `knowledge_base_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_base_ratings` ADD CONSTRAINT `knowledge_base_ratings_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `knowledge_base_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_runs` ADD CONSTRAINT `evaluation_runs_datasetId_fkey` FOREIGN KEY (`datasetId`) REFERENCES `evaluation_datasets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evaluation_datasets` ADD CONSTRAINT `evaluation_datasets_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `evaluation_datasets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
