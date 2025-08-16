
# AirportRAG – ELT & Retrieval-Augmented Web App

An end-to-end pipeline combining:

1. **ELT** (Extract → Load → Transform) for airport safety & operations data  
2. A **Next.js 14** RAG-powered frontend to upload PDFs, build a vector knowledge base, chat with documents, and benchmark LLMs

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

- **ELT Pipeline**  
  - Ingests CSV/JSON from airport sources  
  - Transforms via **dbt** (Data Build Tool)  
  - Orchestration with **Luigi**  
  - Loads cleansed tables into MySQL

- **Web App**  
  - **Authentication** via Clerk (Sign-In/Up)  
  - **Document Management**:  
    - Upload PDFs to EdgeStore  
    - Auto-split & embed into Pinecone  
  - **RAG Chat**:  
    - Vector search + local LLM (Ollama)  
    - Streaming chat UI  
  - **LLM Evaluation**:  
    - Pure LLM vs. RAG-enhanced comparison  
    - Metrics: relevance, clarity, coherence, completeness, response time, memory  
    - JSON-streaming results

---

## Architecture Overview

```mermaid
flowchart LR
  subgraph ELT
    A[Extract Airport Data] --> B[Load into Staging DB]
    B --> C[Transform with dbt]
    C --> D[Warehouse MySQL]
  end

  subgraph WebApp
    U[User] -->|Upload PDF| ES[EdgeStore]
    ES --> Pinecone
    Pinecone -->|Vector Search| RAG[RAG Chat API]
    RAG --> Ollama
    Ollama --> ChatClient
  end

  ELT --> WebApp
  WebApp -->|Use Data| BI[BI / Reporting]
```

## Tech Stack

| Layer             | Technologies              |
| ----------------- | ------------------------- |
| ELT Orchestration | Luigi                     |
| Transform (T)     | dbt                       |
| Data Warehouse    | MySQL                     |
| Web Framework     | Next.js 14 (App Router)   |
| Authentication    | Clerk                     |
| File Storage      | EdgeStore (Upstash)       |
| Vector Search     | Pinecone                  |
| Embeddings        | HuggingFace via LangChain |
| LLM Inference     | Ollama / LangChain        |
| Rate Limiting     | Upstash Rate Limit        |
| Data Modeling     | Prisma Client (MySQL)     |
| Evaluation Judge  | Ollama (judge model)      |

---

## Getting Started

### Prerequisites

* Node.js >= 18
* Python 3.11 (for ELT scripts)
* MySQL server
* Docker & Docker-Compose (optional for Ollama)
* CLI access: `luigi`, `dbt`

### Installation

1. **Clone repository**

   ```bash
   git clone https://github.com/Am1n0N/AirportRAG-ELT.git
   cd AirportRAG-ELT
   ```

2. **Install ELT dependencies**

   ```bash
   cd ELT-Pipeline
   pip install -r requirements.txt
   ```

3. **Install Web App**

   ```bash
   cd "../datarag - app"
   npm install
   ```

### Environment Variables

Copy and edit `.env.example` in `datarag - app/`:

```ini
DATABASE_URL="mysql://USER:PASS@HOST:3306/airport_rag"
CLERK_FRONTEND_API="your-clerk-frontend"
OLLAMA_BASE_URL="http://localhost:11434"
PINECONE_API_KEY="your-pinecone-key"
UPSTASH_REDIS_REST_URL="..."
UPSTASH_REDIS_REST_TOKEN="..."
```

### Running the ELT Pipeline

```bash
# Launch Luigi scheduler
luigid

# In new shell:
cd ELT-Pipeline
python run_pipeline.py
```

### Running the Web App

```bash
# Start Next.js development server
cd "datarag - app"
npm run dev
# App available at http://localhost:3000
```

---

## Project Structure

### ELT-Pipeline Package

```
ELT-Pipeline/
├─ extract/         # Data extraction scripts
├─ load/            # Staging & loading logic
├─ transform/       # dbt project
├─ luigi_tasks.py   # Luigi DAG definitions
└─ run_pipeline.py  # Entry point
```

### Next.js App (datarag-app)

```
datarag - app/
├─ app/
│  ├─ (auth)/      # Clerk sign-in & sign-up layouts & pages
│  ├─ (root)/      # Main site: document list, categories, upload
│  │  └─ (routes)/
│  │     ├─ documents/[documentId]/  # Document view & edit
│  │     └─ test/                    # Evaluation UI
│  ├─ (chat)/      # PDF + chat UI
│  │  └─ (routes)/chat/[chatId]/
│  ├─ api/         # Endpoints: chat, document, edgestore, evaluate, knowledge
│  └─ globals.css
├─ components/     # Reusable React components
│  ├─ categories.tsx
│  ├─ documents.tsx
│  ├─ file-upload.tsx
│  ├─ pdfviewer.tsx
│  ├─ chat-*.tsx
│  └─ ...
├─ lib/            # Core helpers: prisma, pinecone, memory, rate-limit, utils
├─ hooks/          # React hooks (e.g. useDebounce)
├─ data/           # `airport_eval_dataset.json`
├─ prisma/         # Prisma schema & migrations
├─ scripts/        # LLM evaluation helper scripts
└─ middleware.ts   # Clerk auth middleware
```

---

## API Reference

### `/api/chat`

* **POST**: general RAG-enabled chat (streaming)
* **GET**: list available models & stats
* **DELETE**: clear chat history

### `/api/chat/[chatId]`

* **POST**: chat within a specific document (streaming)

### `/api/document`

* **POST**: upload metadata + trigger Pinecone embedding
* `/api/document/[documentId]`

  * **PATCH**: update document
  * **DELETE**: remove document

### `/api/edgestore`

* **GET/POST**: file upload & retrieval (EdgeStore)

### `/api/evaluate`

* **POST**: run batch evaluation of dataset against pure LLM & RAG; streams JSON metrics

### `/api/knowledge`

* **POST**: add content to KB
* **GET**: search KB

---

## Database Schema

| Model    | Key Fields                                                                    |
| -------- | ----------------------------------------------------------------------------- |
| Category | `id`, `name`, `documents → Document[]`                                        |
| Document | `id`, `title`, `description`, `fileurl`, `categoryId`, `messages → Message[]` |
| Message  | `id`, `role` (USER / SYSTEM), `content`, `documentId`                         |

Full-text index on `Document.title` for search.

---

## Evaluation Dataset

* **File**: `datarag - app/data/airport_eval_dataset.json`
* **Items**: Q\&A pairs about Tunisian airport operations and ICAO standards
* Used by `/api/evaluate` to benchmark LLMs with and without RAG.

---

## Contributing

1. Fork & clone
2. Create branch (`feat/…` or `fix/…`)
3. Install & test locally
4. Submit PR with clear description

```
