
# AirportRAG – Advanced AI-Powered Airport Operations Platform

A comprehensive AI platform that combines:

1. **Advanced RAG System** with intelligent document processing and vector search
2. **AI Database Agent** with natural language to SQL conversion
3. **Multi-Model AI Integration** supporting Groq, Ollama, and OpenAI models
4. **Next.js 14** application with modern UI and real-time chat capabilities
5. **Comprehensive Analytics** and performance monitoring

---

## Table of Contents

1. [Features](#features)  
2. [Architecture Overview](#architecture-overview)  
3. [Tech Stack](#tech-stack)  
4. [Getting Started](#getting-started)  
   - [Prerequisites](#prerequisites)  
   - [Installation](#installation)  
   - [Environment Variables](#environment-variables)  
   - [Running the ELT Pipeline](#running-the-elt-pipeline)  
   - [Running the Web App](#running-the-web-app)  
5. [Project Structure](#project-structure)  
   - [ELT-Pipeline Package](#elt-pipeline-package)  
   - [Next.js App (datarag-app)](#nextjs-app-datarag-app)  
6. [API Reference](#api-reference)  
7. [Database Schema](#database-schema)  
8. [Evaluation Dataset](#evaluation-dataset)  
9. [Contributing](#contributing)  
10. [License](#license)

---

## Features

### 🤖 Advanced AI Capabilities
- **Multi-Model Support**: Groq, Ollama, OpenAI with 15+ available models including Llama 3.1 (405B/70B/8B), Gemma 2, DeepSeek-R1, and GPT-OSS
- **Smart Model Selection**: Automatic model routing for different tasks (chat, SQL, reranking)
- **Advanced RAG Pipeline**: Document processing, vector search, and intelligent reranking with Pinecone
- **Database AI Agent**: Natural language to SQL conversion with smart query generation and execution
- **Real-time Streaming**: Server-sent events for all AI interactions with streaming responses
- **Enhanced Message Rendering**: Rich message display with source citations, thinking process, and code highlighting

### 📊 Database & Analytics Integration
- **Natural Language Queries**: Ask questions in plain English, get SQL and results with execution metrics
- **Smart Database Detection**: Automatic detection of database-related queries with contextual responses
- **Query Performance Monitoring**: Execution time tracking, query complexity analysis, and optimization suggestions
- **Interactive Database Explorer**: Browse tables, view samples, understand schema with AI-powered insights
- **Query History & Analytics**: Comprehensive tracking of usage patterns and performance metrics
- **Direct SQL Support**: Execute raw SQL queries with safety validation and result formatting

### 📄 Document Intelligence
- **PDF Processing**: Advanced chunking with metadata extraction and thumbnail generation
- **Vector Knowledge Base**: Pinecone-powered semantic search with relevance scoring
- **Document Chat**: Context-aware conversations with uploaded documents and cross-document references
- **Enhanced Citation System**: Inline citations with hover previews and source validation
- **Multi-Document Support**: Category-based organization and cross-document search capabilities
- **Document Table View**: Interactive table with PDF thumbnails and metadata display

### 🎨 Modern User Experience
- **Responsive Design**: Mobile-first UI with advanced dark/light theme support and system detection
- **Enhanced Chat Interface**: Collapsible sidebar, message history, advanced source references, streaming indicators
- **Comprehensive Settings Panel**: Customizable model preferences, temperature, context length, reranking settings, display options
- **Progress Tracking**: Real-time feedback on document processing, query execution, and AI responses
- **Performance Insights**: Token usage, execution time, model performance metrics, and source relevance scores
- **Advanced Message Features**: Copy functionality, thinking process display, citation tooltips, and source expansion

### 🔧 Developer Features
- **Comprehensive API**: RESTful endpoints for all platform features with enhanced error handling
- **Rate Limiting**: Built-in Upstash-powered protection against abuse with user-specific limits
- **Enhanced Error Handling**: Detailed error reporting, recovery mechanisms, and user-friendly messages
- **Debug Mode**: Extensive logging, performance monitoring, and development tools
- **Health Checks**: System status monitoring, model availability checking, and diagnostics
- **Evaluation System**: Built-in LLM evaluation with custom datasets and performance benchmarking

---

## Architecture Overview

```mermaid
flowchart TD
  subgraph "Frontend Layer"
    UI["Next.js 14 UI"]
    Auth["Clerk Auth"]
    Chat["Chat Interface"]
    DB_UI["Database Explorer"]
  end

  subgraph "AI Layer"
    Agent["AI Agent"]
    Groq["Groq Models"]
    Ollama["Ollama Local"]
    Rerank["Reranking Engine"]
  end

  subgraph "Data Layer"
    MySQL["MySQL Database"]
    Pinecone["Vector Store"]
    Redis["Redis Cache"]
    EdgeStore["File Storage"]
  end

  subgraph "Processing"
    PDF["PDF Processor"]
    Embed["Embedding Service"]
    SQL_Gen["SQL Generator"]
  end

  UI --> Auth
  Chat --> Agent
  DB_UI --> SQL_Gen
  Agent --> Groq
  Agent --> Ollama
  Agent --> Rerank
  SQL_Gen --> MySQL
  PDF --> Embed
  Embed --> Pinecone
  Agent --> Redis
  UI --> EdgeStore
```

## Tech Stack

### 🚀 Core Infrastructure
| Layer             | Technologies              |
| ----------------- | ------------------------- |
| **Frontend**      | Next.js 14 (App Router), TypeScript, TailwindCSS |
| **Authentication**| Clerk (Sign-In/Up/Sessions) |
| **Database**      | MySQL with Prisma ORM    |
| **File Storage**  | EdgeStore (Upstash)       |
| **Vector DB**     | Pinecone                  |
| **Cache/Memory**  | Upstash Redis             |
| **Rate Limiting** | Upstash Rate Limit        |

### 🤖 AI & ML Stack
| Component         | Technologies              |
| ----------------- | ------------------------- |
| **LLM Providers** | Groq (primary), Ollama (local), OpenAI (optional) |
| **Models**        | Llama 3.1 (405B/70B/8B), DeepSeek-R1, Gemma 2, Qwen 3, GPT-OSS |
| **Embeddings**    | Ollama (nomic-embed-text, mxbai-embed-large) |
| **Framework**     | LangChain, @langchain/groq, @langchain/ollama |
| **Document Processing** | PDF-parse, RecursiveCharacterTextSplitter, @pinecone-database/doc-splitter |
| **Reranking**     | Custom Groq-powered reranking with relevance scoring |
| **Streaming**     | Server-sent events, real-time message rendering |
| **Evaluation**    | Custom LLM judge system with multiple metrics |

### 🎨 UI & Components
| Category          | Technologies              |
| ----------------- | ------------------------- |
| **UI Framework**  | Radix UI, Shadcn/ui       |
| **Styling**       | TailwindCSS, CVA          |
| **State Management** | React Hooks, Zustand   |
| **Forms**         | React Hook Form, Zod      |
| **Data Tables**   | TanStack Table            |
| **PDF Viewer**    | React-PDF                 |
| **Markdown**      | Streamdown                |
| **Icons**         | Lucide React              |

---

## Getting Started

### Prerequisites

* **Node.js 18+** with npm/yarn
* **MySQL 8.0+** database server
* **Ollama** (optional, for local embeddings)
* **Docker** (optional, for containerized services)

### Installation

1. **Clone and Setup**

   ```bash
   git clone https://github.com/Am1n0N/AirportRAG-ELT.git
   cd AirportRAG-ELT
   cd "datarag - app"
   npm install
   ```

2. **Database Setup**

   ```bash
   # Generate Prisma client
   npx prisma generate
   
   # Run database migrations
   npx prisma db push
   
   # (Optional) Seed database
   npx prisma db seed
   ```

3. **Install Ollama (Optional for local embeddings)**

   ```bash
   # Download and install Ollama
   curl https://ollama.ai/install.sh | sh
   
   # Pull required models
   ollama pull nomic-embed-text
   ollama pull deepseek-r1:7b
   ```

### Environment Variables

Create `.env.local` in `datarag - app/`:

```bash
# Database
DATABASE_URL="mysql://USER:PASS@HOST:3306/airport_rag"

# Authentication (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# AI Services
GROQ_API_KEY="gsk_..."
OLLAMA_BASE_URL="http://localhost:11434"
OPENAI_API_KEY="sk-..." # Optional

# Vector Database
PINECONE_API_KEY="your-pinecone-key"
PINECONE_INDEX="airport-rag"
PINECONE_ENVIRONMENT="us-east-1"

# Cache & Storage
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."
EDGE_STORE_ACCESS_KEY="..."
EDGE_STORE_SECRET_KEY="..."

# Optional: Debug
NODE_ENV="development"
AGENT_DEBUG="true"
SQL_TOOL_DEBUG="true"
```

### 📋 Environment Configuration Template

A comprehensive `.env.example` file is provided in both the root directory and the `datarag - app/` directory to help you set up your environment variables easily.

**Quick Setup:**

1. **Copy the template:**
   ```bash
   # In the datarag - app directory
   cp .env.example .env.local
   ```

2. **Fill in your actual values:**
   - Replace placeholder values with your actual API keys and configurations
   - Each section is clearly labeled with where to obtain the required keys
   - Optional variables are marked and can be omitted if not needed

3. **Verify configuration:**
   ```bash
   # Check if all required environment variables are set
   npm run dev
   ```

**Key sections in `.env.example`:**
- 🗄️ **Database Configuration** - MySQL connection settings with Prisma ORM
- 🔐 **Authentication** - Clerk authentication keys for secure user management
- 🤖 **AI Services** - Groq, Ollama, and OpenAI API keys with model configurations
- 📊 **Vector Database** - Pinecone configuration for semantic search
- ⚡ **Cache & Storage** - Upstash Redis for caching and EdgeStore for file management
- 🐛 **Development** - Debug flags, agent configuration, and development options

**Security Notes:**
- Never commit `.env.local` to version control
- Keep your API keys secure and rotate them regularly
- Use different keys for development and production environments
- Enable debug modes only in development

### Quick Start

```bash
# Start the development server
cd "datarag - app"
npm run dev

# App available at http://localhost:3000
# API available at http://localhost:3000/api
```

### Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm run start

# Or deploy to Vercel
npx vercel --prod
```

---

## Project Structure

### Core Application (datarag - app/)

```
datarag - app/
├─ app/
│  ├─ (auth)/              # Authentication routes
│  │  ├─ sign-in/[[...sign-in]]/ # Clerk sign-in with custom styling
│  │  └─ sign-up/[[...sign-up]]/ # Clerk sign-up with custom styling
│  ├─ (root)/              # Main application routes
│  │  └─ (routes)/
│  │     ├─ chat/          # General chat interface with AI agent
│  │     ├─ database/      # Database query interface with SQL tools
│  │     └─ test/          # Model evaluation UI with benchmarking
│  ├─ (chat)/             # Document chat layout with PDF viewer
│  └─ api/                # API endpoints with enhanced error handling
│     ├─ chat/            # Chat APIs with streaming support
│     ├─ database/        # Database query API with performance metrics
│     ├─ document/        # Document management with metadata
│     ├─ edgestore/       # File upload/storage with EdgeStore
│     ├─ evaluate/        # Model evaluation with LLM judge
│     ├─ knowledge/       # Knowledge base with vector search
│     └─ settings/        # User settings with preferences
├─ components/            # React UI components
│  ├─ ChatInterface.tsx   # Enhanced chat with sidebar, sources, streaming
│  ├─ MessageRenderer.tsx # Rich message display with citations
│  ├─ SettingsPanel.tsx   # Comprehensive user settings panel
│  ├─ documents-table.tsx # Interactive document table with thumbnails
│  ├─ pdfviewer.tsx      # PDF display with navigation
│  ├─ pdf-thumbnail.tsx  # PDF thumbnail generation
│  ├─ theme-provider.tsx  # Dark/light theme with system detection
│  ├─ file-upload.tsx    # Drag-and-drop file upload component
│  ├─ progress-bar.tsx   # Progress indicators for operations
│  └─ navbar.tsx         # Navigation bar with user menu
├─ lib/                   # Core business logic
│  ├─ agent.ts           # Enhanced AI agent with multi-model support
│  ├─ database-tools.ts  # Database query tools with validation
│  ├─ prismadb.ts        # Database client with connection pooling
│  └─ rate-limit.ts      # Upstash rate limiting with user tracking
├─ hooks/                 # React hooks
│  ├─ useChat.ts         # Chat management with state persistence
│  ├─ useModalState.ts   # Modal state management
│  └─ useUserSettings.ts # User settings management
├─ config/
│  └─ models.ts          # AI model definitions and configurations
├─ prisma/               # Database schema and migrations
│  ├─ schema.prisma      # Enhanced Prisma schema with relationships
│  └─ migrations/        # Database migration history
├─ scripts/
│  └─ LLMJudgeEval.js   # LLM evaluation script with custom judges
└─ data/
   └─ airport_eval_dataset.json # Comprehensive evaluation dataset
```

---

## API Reference

### 👤 Chat & AI Endpoints

#### `/api/chat`
- **POST**: General chat with AI agent (supports streaming)
- **GET**: List available models and stats
- **DELETE**: Clear chat history

#### `/api/chat/[chatId]`
- **POST**: Document-specific chat (streaming supported)

### 📊 Database Integration

#### `/api/database`
- **POST**: Execute natural language or SQL queries
- **GET**: Retrieve database schema and table information
  - `?action=tables` - Get all table schemas
  - `?action=sample&table=<name>` - Get sample data

### 📄 Document Management

#### `/api/document`
- **POST**: Upload document metadata and trigger embedding
- **GET**: List user documents

#### `/api/document/[documentId]`
- **GET**: Get document details
- **PATCH**: Update document metadata
- **DELETE**: Remove document and embeddings

### ⚙️ User & Settings

#### `/api/settings`
- **GET**: Get user settings and preferences
- **PATCH**: Update user settings
  - Model preferences, temperature, context length
  - UI preferences, theme, sidebar state
  - Feature toggles (database, knowledge base, reranking)

### 📋 File & Storage

#### `/api/edgestore`
- **POST**: Upload files to EdgeStore
- **GET**: Retrieve file URLs and metadata

### 🧪 Knowledge Base

#### `/api/knowledge`
- **POST**: Add content to knowledge base
- **GET**: Search knowledge base
- **DELETE**: Remove knowledge base entries

### 📊 Evaluation & Testing

#### `/api/evaluate`
- **POST**: Run model evaluation against dataset
- Supports streaming JSON results with metrics
- Compares pure LLM vs RAG performance

---

## Database Schema

### 💬 Chat & Sessions

| Model | Description | Key Fields |
|-------|-------------|------------|
| **ChatSession** | User chat sessions | `id`, `title`, `userId`, `modelKey`, `useDatabase`, `useKnowledgeBase` |
| **ChatMessage** | Chat messages with metadata | `id`, `content`, `role`, `sessionId`, `userId`, `executionTime` |
| **MessageSource** | Source references for messages | `id`, `messageId`, `type`, `title`, `snippet`, `relevanceScore` |

### 📄 Document Management

| Model | Description | Key Fields |
|-------|-------------|------------|
| **Category** | Document categories | `id`, `name`, `documents → Document[]` |
| **Document** | PDF documents | `id`, `title`, `description`, `fileUrl`, `status`, `categoryId` |
| **DocumentMessage** | Document-specific chat | `id`, `content`, `role`, `documentId`, `userId` |
| **DocumentChunk** | Document chunks for RAG | `id`, `content`, `chunkIndex`, `pageNumber`, `vectorId` |

### 🧠 Knowledge Base

| Model | Description | Key Fields |
|-------|-------------|------------|
| **KnowledgeBaseEntry** | KB entries with full-text search | `id`, `title`, `content`, `category`, `vectorId`, `isPublic` |
| **KnowledgeBaseTag** | Tags for KB organization | `id`, `name`, `entries → KnowledgeBaseEntry[]` |

### 👤 User & Analytics

| Model | Description | Key Fields |
|-------|-------------|------------|
| **UserSettings** | User preferences | `userId`, `defaultModel`, `theme`, `sidebarCollapsed`, `enableReranking` |
| **QueryHistory** | Database query tracking | `id`, `userId`, `query`, `sqlGenerated`, `success`, `executionTime` |
| **AnalyticsEvent** | Usage analytics | `id`, `userId`, `eventType`, `sessionId`, `metadata` |

### 🔍 Key Features
- **Full-text search** on documents and knowledge base
- **Vector search** integration with Pinecone
- **Performance tracking** for queries and responses
- **User customization** with persistent settings
- **Citation system** with source validation

---

## Available AI Models

### 🚀 Groq Models (Primary)
| Model | Parameters | Context Window | Best For |
|-------|------------|----------------|----------|
| **Llama 3.1 405B** | 405B | 131K tokens | Complex reasoning, analysis, database queries |
| **Llama 3.1 70B** | 70B | 131K tokens | Versatile, balanced performance, general chat |
| **Llama 3.1 8B** | 8B | 131K tokens | Fast responses, simple queries, document chat |
| **Gemma 2 9B** | 9B | 8K tokens | Instruction following, task completion |
| **DeepSeek-R1 7B** | 7B | 131K tokens | Code generation, reasoning with thinking process |
| **Qwen 3** | Various | 131K tokens | Multilingual support, general purpose |
| **GPT-OSS** | 20B/120B | 131K tokens | Open-source GPT alternative |

### 🏠 Ollama Models (Local)
| Model | Purpose | Notes |
|-------|---------|-------|
| **nomic-embed-text** | Embeddings | RAG-optimized, 768 dimensions, document processing |
| **deepseek-r1:7b** | Chat/Reasoning | Local reasoning with thinking display |
| **mxbai-embed-large** | Embeddings | High-quality semantic search, 1024 dimensions |
| **Custom Models** | Various | Support for any Ollama-compatible model |

### 🎯 Model Selection Strategy
- **Database Queries**: Llama 3.1 405B for complex analysis, 70B for general queries
- **Document Chat**: Llama 3.1 8B for fast responses with context
- **Code Generation**: DeepSeek-R1 for reasoning with thinking process
- **Embeddings**: nomic-embed-text for documents, mxbai-embed-large for semantic search
- **Reranking**: Dedicated reranking models for relevance scoring

## Usage Examples

### Enhanced Database Queries
```bash
# Natural language queries with context
"Show me flights from JFK to LAX with delays over 30 minutes in the last week"
"What are the top 10 busiest airports by passenger count this year?"
"Which airlines have the best on-time performance for international flights?"
"Compare average delay times between Delta and United for domestic routes"

# Direct SQL with validation
SELECT * FROM flights WHERE departure_delay > 30 AND departure_date >= CURDATE() - INTERVAL 7 DAY LIMIT 10;
```

### Advanced Document Chat
```bash
# Upload a PDF and engage in contextual conversations:
"What are the main safety procedures mentioned in this ICAO document?"
"Summarize the key findings from section 3 and compare with section 5"
"What standards are referenced and how do they relate to current practices?"
"Generate a compliance checklist based on this document"
```

### Comprehensive Model Evaluation
```bash
# Run evaluation script with custom parameters
npm run eval -- --model deepseek-r1:7b --judge llama-3.1-70b-versatile --dataset data/airport_eval_dataset.json

# Via API with streaming results
POST /api/evaluate
{
  "model": "llama-3.1-70b-versatile",
  "dataset": "airport_eval_dataset",
  "useRAG": true,
  "metrics": ["relevance", "accuracy", "completeness", "clarity"],
  "stream": true
}
```

### Settings Configuration Examples
```javascript
// User settings via API
PATCH /api/settings
{
  "defaultModel": "llama-3.1-70b-versatile",
  "defaultTemperature": 0.7,
  "useDatabase": true,
  "useKnowledgeBase": true,
  "enableReranking": true,
  "rerankingThreshold": 0.6,
  "maxContextLength": 8000,
  "showSourceReferences": true,
  "showExecutionTime": true
}
```

---

## Evaluation Dataset

* **File**: `datarag - app/data/airport_eval_dataset.json`
* **Items**: Q&A pairs about Tunisian airport operations and ICAO standards
* **Metrics**: Relevance, clarity, coherence, completeness, response time
* Used by `/api/evaluate` to benchmark LLMs with and without RAG

---

## Performance & Monitoring

### 📈 Built-in Analytics
- **Response Time Tracking**: Monitor AI model performance
- **Query Success Rates**: Database query success/failure tracking
- **User Engagement**: Track document uploads, chat sessions
- **Model Usage**: Monitor which models are used most
- **Citation Validation**: Track source reference accuracy

### 🔧 Debug Features
- **Detailed Logging**: Comprehensive request/response logging
- **Performance Headers**: Request timing in HTTP headers
- **Health Checks**: `/api/health` endpoint for system status
- **Model Status**: Real-time model availability checking

---

## Contributing

1. **Fork & Clone**
   ```bash
   git fork https://github.com/Am1n0N/AirportRAG-ELT.git
   git clone https://github.com/YOUR_USERNAME/AirportRAG-ELT.git
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

3. **Install & Test Locally**
   ```bash
   cd "datarag - app"
   npm install
   npm run dev
   ```

4. **Submit PR**
   - Clear description of changes
   - Screenshots for UI changes
   - Test results if applicable

### Development Guidelines
- Follow TypeScript best practices
- Use existing UI components from `/components`
- Add proper error handling
- Include JSDoc comments for new functions
- Test API endpoints with different scenarios

---

## License

MIT License - see LICENSE file for details
