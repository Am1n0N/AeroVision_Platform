-- CreateTable
CREATE TABLE "public"."chat_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL DEFAULT 'openai/gpt-oss-20b',
    "useDatabase" BOOLEAN NOT NULL DEFAULT true,
    "useKnowledgeBase" BOOLEAN NOT NULL DEFAULT true,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "evaluationRuns" TEXT,
    "contextSources" INTEGER DEFAULT 0,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelUsed" TEXT,
    "executionTime" INTEGER,
    "dbQueryUsed" BOOLEAN NOT NULL DEFAULT false,
    "contextSources" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "evaluationRunId" TEXT,
    "relevanceScore" DOUBLE PRECISION,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_sources" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "section" TEXT,
    "pageNumber" INTEGER,
    "snippet" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION,
    "url" TEXT,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCategory" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "message_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#3B82F6',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsed" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "language" TEXT DEFAULT 'en',
    "wordCount" INTEGER,
    "pageCount" INTEGER,
    "processingTime" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" TIMESTAMP(3),
    "categoryId" UUID NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relevanceScore" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "executionTime" INTEGER,

    CONSTRAINT "document_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER,
    "chunkType" TEXT DEFAULT 'text',
    "wordCount" INTEGER,
    "tokenEstimate" INTEGER,
    "vectorId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" TEXT,
    "language" TEXT DEFAULT 'en',
    "relevanceScores" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "avgRelevance" DOUBLE PRECISION,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_base_entries" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT NOT NULL,
    "category" VARCHAR(100),
    "userId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "vectorId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "language" TEXT DEFAULT 'en',
    "wordCount" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessed" TIMESTAMP(3),
    "avgRating" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_base_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_base_tags" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#10B981',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_base_ratings" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."query_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "query" TEXT NOT NULL,
    "sqlGenerated" TEXT,
    "success" BOOLEAN NOT NULL,
    "resultCount" INTEGER,
    "executionTime" INTEGER,
    "errorMessage" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelUsed" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "contextSources" TEXT,
    "evaluationRunId" TEXT,
    "queryType" TEXT,
    "responseQuality" DOUBLE PRECISION,
    "retrievalTime" INTEGER,
    "generationTime" INTEGER,
    "totalTokensUsed" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,

    CONSTRAINT "query_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL DEFAULT 'deepseek-r1:7b',
    "defaultTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "useDatabase" BOOLEAN NOT NULL DEFAULT true,
    "useKnowledgeBase" BOOLEAN NOT NULL DEFAULT true,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "sidebarCollapsed" BOOLEAN NOT NULL DEFAULT false,
    "showTokenCount" BOOLEAN NOT NULL DEFAULT false,
    "showExecutionTime" BOOLEAN NOT NULL DEFAULT false,
    "showSourceReferences" BOOLEAN NOT NULL DEFAULT true,
    "maxContextLength" INTEGER NOT NULL DEFAULT 6000,
    "rerankingThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "enableReranking" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "evaluationPreferences" TEXT,
    "autoEvaluate" BOOLEAN NOT NULL DEFAULT false,
    "evaluationFrequency" TEXT DEFAULT 'weekly',
    "notificationSettings" TEXT,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analytics_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "sessionId" TEXT,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "userAgent" VARCHAR(500),
    "ipAddress" VARCHAR(45),

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "results" TEXT NOT NULL,
    "totalTests" INTEGER NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "executionTime" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "avgRetrievalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgAugmentationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGenerationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRelevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgAccuracyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCompletenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCoherenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTokensUsed" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "datasetId" TEXT,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_datasets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dataset" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "difficulty" TEXT,
    "categories" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsed" TIMESTAMP(3),
    "avgPerformance" DOUBLE PRECISION,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "evaluation_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."model_performance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "testCount" INTEGER NOT NULL,
    "avgExecutionTime" DOUBLE PRECISION NOT NULL,
    "lastEvaluated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "retrievalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "augmentationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accuracyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coherenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreHistory" TEXT,
    "performanceTrend" TEXT DEFAULT 'stable',
    "totalTokensUsed" INTEGER,
    "estimatedCost" DOUBLE PRECISION,
    "costPerToken" DOUBLE PRECISION,
    "peakPerformanceScore" DOUBLE PRECISION,
    "worstPerformanceScore" DOUBLE PRECISION,
    "consistencyScore" DOUBLE PRECISION,
    "rankAmongModels" INTEGER,
    "industryPercentile" DOUBLE PRECISION,

    CONSTRAINT "model_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evaluation_metrics" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(64) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "metric" VARCHAR(64) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "testCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelId" VARCHAR(64),
    "categoryId" VARCHAR(36),
    "difficulty" VARCHAR(16),
    "confidence" DOUBLE PRECISION,
    "sampleSize" INTEGER,
    "percentileRank" DOUBLE PRECISION,
    "zScore" DOUBLE PRECISION,

    CONSTRAINT "evaluation_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_EntryTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EntryTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "chat_sessions_userId_isArchived_isPinned_idx" ON "public"."chat_sessions"("userId", "isArchived", "isPinned");

-- CreateIndex
CREATE INDEX "chat_sessions_userId_lastMessageAt_idx" ON "public"."chat_sessions"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_sessions_userId_modelKey_idx" ON "public"."chat_sessions"("userId", "modelKey");

-- CreateIndex
CREATE INDEX "chat_sessions_createdAt_idx" ON "public"."chat_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "public"."chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_userId_createdAt_idx" ON "public"."chat_messages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_evaluationRunId_idx" ON "public"."chat_messages"("evaluationRunId");

-- CreateIndex
CREATE INDEX "chat_messages_modelUsed_createdAt_idx" ON "public"."chat_messages"("modelUsed", "createdAt");

-- CreateIndex
CREATE INDEX "message_sources_messageId_idx" ON "public"."message_sources"("messageId");

-- CreateIndex
CREATE INDEX "message_sources_type_idx" ON "public"."message_sources"("type");

-- CreateIndex
CREATE INDEX "message_sources_sourceCategory_relevanceScore_idx" ON "public"."message_sources"("sourceCategory", "relevanceScore");

-- CreateIndex
CREATE INDEX "message_sources_usageCount_idx" ON "public"."message_sources"("usageCount");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "public"."Category"("name");

-- CreateIndex
CREATE INDEX "Category_name_idx" ON "public"."Category"("name");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "public"."Category"("isActive");

-- CreateIndex
CREATE INDEX "Category_documentCount_idx" ON "public"."Category"("documentCount");

-- CreateIndex
CREATE INDEX "documents_userId_idx" ON "public"."documents"("userId");

-- CreateIndex
CREATE INDEX "documents_categoryId_idx" ON "public"."documents"("categoryId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "public"."documents"("status");

-- CreateIndex
CREATE INDEX "documents_userId_status_idx" ON "public"."documents"("userId", "status");

-- CreateIndex
CREATE INDEX "documents_createdAt_idx" ON "public"."documents"("createdAt");

-- CreateIndex
CREATE INDEX "documents_queryCount_lastAccessed_idx" ON "public"."documents"("queryCount", "lastAccessed");

-- CreateIndex
CREATE INDEX "documents_wordCount_idx" ON "public"."documents"("wordCount");

-- CreateIndex
CREATE INDEX "document_messages_documentId_createdAt_idx" ON "public"."document_messages"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "document_messages_userId_idx" ON "public"."document_messages"("userId");

-- CreateIndex
CREATE INDEX "document_messages_modelUsed_idx" ON "public"."document_messages"("modelUsed");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_vectorId_key" ON "public"."document_chunks"("vectorId");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_idx" ON "public"."document_chunks"("documentId");

-- CreateIndex
CREATE INDEX "document_chunks_chunkIndex_idx" ON "public"."document_chunks"("chunkIndex");

-- CreateIndex
CREATE INDEX "document_chunks_documentId_chunkIndex_idx" ON "public"."document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "document_chunks_usageCount_avgRelevance_idx" ON "public"."document_chunks"("usageCount", "avgRelevance");

-- CreateIndex
CREATE INDEX "document_chunks_tokenEstimate_idx" ON "public"."document_chunks"("tokenEstimate");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_entries_vectorId_key" ON "public"."knowledge_base_entries"("vectorId");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_category_idx" ON "public"."knowledge_base_entries"("category");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_userId_idx" ON "public"."knowledge_base_entries"("userId");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_isPublic_idx" ON "public"."knowledge_base_entries"("isPublic");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_userId_isPublic_idx" ON "public"."knowledge_base_entries"("userId", "isPublic");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_category_isPublic_idx" ON "public"."knowledge_base_entries"("category", "isPublic");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_createdAt_idx" ON "public"."knowledge_base_entries"("createdAt");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_queryCount_lastAccessed_idx" ON "public"."knowledge_base_entries"("queryCount", "lastAccessed");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_isVerified_avgRating_idx" ON "public"."knowledge_base_entries"("isVerified", "avgRating");

-- CreateIndex
CREATE INDEX "knowledge_base_entries_parentId_idx" ON "public"."knowledge_base_entries"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_tags_name_key" ON "public"."knowledge_base_tags"("name");

-- CreateIndex
CREATE INDEX "knowledge_base_tags_name_idx" ON "public"."knowledge_base_tags"("name");

-- CreateIndex
CREATE INDEX "knowledge_base_tags_usageCount_idx" ON "public"."knowledge_base_tags"("usageCount");

-- CreateIndex
CREATE INDEX "knowledge_base_ratings_entryId_rating_idx" ON "public"."knowledge_base_ratings"("entryId", "rating");

-- CreateIndex
CREATE INDEX "knowledge_base_ratings_userId_idx" ON "public"."knowledge_base_ratings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_base_ratings_entryId_userId_key" ON "public"."knowledge_base_ratings"("entryId", "userId");

-- CreateIndex
CREATE INDEX "query_history_userId_idx" ON "public"."query_history"("userId");

-- CreateIndex
CREATE INDEX "query_history_sessionId_idx" ON "public"."query_history"("sessionId");

-- CreateIndex
CREATE INDEX "query_history_success_idx" ON "public"."query_history"("success");

-- CreateIndex
CREATE INDEX "query_history_createdAt_idx" ON "public"."query_history"("createdAt");

-- CreateIndex
CREATE INDEX "query_history_userId_success_idx" ON "public"."query_history"("userId", "success");

-- CreateIndex
CREATE INDEX "query_history_evaluationRunId_idx" ON "public"."query_history"("evaluationRunId");

-- CreateIndex
CREATE INDEX "query_history_queryType_createdAt_idx" ON "public"."query_history"("queryType", "createdAt");

-- CreateIndex
CREATE INDEX "query_history_modelUsed_success_idx" ON "public"."query_history"("modelUsed", "success");

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "public"."user_settings"("userId");

-- CreateIndex
CREATE INDEX "user_settings_userId_idx" ON "public"."user_settings"("userId");

-- CreateIndex
CREATE INDEX "analytics_events_userId_eventType_idx" ON "public"."analytics_events"("userId", "eventType");

-- CreateIndex
CREATE INDEX "analytics_events_timestamp_idx" ON "public"."analytics_events"("timestamp");

-- CreateIndex
CREATE INDEX "analytics_events_eventType_timestamp_idx" ON "public"."analytics_events"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_idx" ON "public"."analytics_events"("sessionId");

-- CreateIndex
CREATE INDEX "analytics_events_success_eventType_idx" ON "public"."analytics_events"("success", "eventType");

-- CreateIndex
CREATE INDEX "evaluation_runs_userId_idx" ON "public"."evaluation_runs"("userId");

-- CreateIndex
CREATE INDEX "evaluation_runs_createdAt_idx" ON "public"."evaluation_runs"("createdAt");

-- CreateIndex
CREATE INDEX "evaluation_runs_status_createdAt_idx" ON "public"."evaluation_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "evaluation_runs_avgScore_createdAt_idx" ON "public"."evaluation_runs"("avgScore", "createdAt");

-- CreateIndex
CREATE INDEX "evaluation_runs_datasetId_idx" ON "public"."evaluation_runs"("datasetId");

-- CreateIndex
CREATE INDEX "evaluation_datasets_userId_idx" ON "public"."evaluation_datasets"("userId");

-- CreateIndex
CREATE INDEX "evaluation_datasets_createdAt_idx" ON "public"."evaluation_datasets"("createdAt");

-- CreateIndex
CREATE INDEX "evaluation_datasets_isActive_usageCount_idx" ON "public"."evaluation_datasets"("isActive", "usageCount");

-- CreateIndex
CREATE INDEX "evaluation_datasets_parentId_idx" ON "public"."evaluation_datasets"("parentId");

-- CreateIndex
CREATE INDEX "evaluation_datasets_name_userId_idx" ON "public"."evaluation_datasets"("name", "userId");

-- CreateIndex
CREATE INDEX "model_performance_userId_idx" ON "public"."model_performance"("userId");

-- CreateIndex
CREATE INDEX "model_performance_modelId_idx" ON "public"."model_performance"("modelId");

-- CreateIndex
CREATE INDEX "model_performance_avgScore_lastEvaluated_idx" ON "public"."model_performance"("avgScore", "lastEvaluated");

-- CreateIndex
CREATE INDEX "model_performance_userId_avgScore_idx" ON "public"."model_performance"("userId", "avgScore");

-- CreateIndex
CREATE UNIQUE INDEX "model_performance_userId_modelId_key" ON "public"."model_performance"("userId", "modelId");

-- CreateIndex
CREATE INDEX "evaluation_metrics_userId_date_idx" ON "public"."evaluation_metrics"("userId", "date");

-- CreateIndex
CREATE INDEX "evaluation_metrics_metric_idx" ON "public"."evaluation_metrics"("metric");

-- CreateIndex
CREATE INDEX "evaluation_metrics_modelId_date_idx" ON "public"."evaluation_metrics"("modelId", "date");

-- CreateIndex
CREATE INDEX "evaluation_metrics_date_value_idx" ON "public"."evaluation_metrics"("date", "value");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_metrics_userId_date_metric_modelId_categoryId_di_key" ON "public"."evaluation_metrics"("userId", "date", "metric", "modelId", "categoryId", "difficulty");

-- CreateIndex
CREATE INDEX "_EntryTags_B_index" ON "public"."_EntryTags"("B");

-- AddForeignKey
ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_sources" ADD CONSTRAINT "message_sources_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_messages" ADD CONSTRAINT "document_messages_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_base_entries" ADD CONSTRAINT "knowledge_base_entries_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."knowledge_base_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_base_ratings" ADD CONSTRAINT "knowledge_base_ratings_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "public"."knowledge_base_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evaluation_runs" ADD CONSTRAINT "evaluation_runs_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "public"."evaluation_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evaluation_datasets" ADD CONSTRAINT "evaluation_datasets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."evaluation_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_EntryTags" ADD CONSTRAINT "_EntryTags_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."knowledge_base_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_EntryTags" ADD CONSTRAINT "_EntryTags_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."knowledge_base_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
