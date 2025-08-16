// lib/database-tools.ts
// Enhanced MySQL-only LangChain-style SQL tools with improved validation,
// cleaner query generation, and robust error handling.
// Dependencies: mysql2, zod, @langchain/core

import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader, FieldPacket } from "mysql2/promise";
import { z } from "zod";
import { DynamicStructuredTool, Tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";

// -----------------------------
// Enhanced Database Configuration
// -----------------------------
const dbConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "root",
  database: process.env.MYSQL_DATABASE || "airportdata",
  ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 20),
  acquireTimeout: Number(process.env.MYSQL_ACQUIRE_TIMEOUT_MS || 60_000),
  timeout: Number(process.env.MYSQL_TIMEOUT_MS || 60_000),
  reconnect: true,
  idleTimeout: 300_000, // 5 minutes
  maxReconnects: 3,
  waitForConnections: true,
  queueLimit: 0,
} as const;

// Singleton pool with enhanced error handling
let pool: Pool | null = null;

const getPool = (): Pool => {
  if (!pool) {
    pool = mysql.createPool(dbConfig);

    pool.on('connection', (connection: any) => {
      log(`New connection established ${connection.threadId}`);
    });

    pool.on('error', (err: any) => {
      log('Database pool error:', err.message);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        pool = null; // Force recreation on next call
      }
    });
  }
  return pool;
};

// -----------------------------
// Logging helpers
// -----------------------------
const logPanel = (opts: { title: string; content: string; level?: 'info' | 'error' | 'debug' }) => {
  if (process.env.SQL_TOOL_DEBUG === "true") {
    const timestamp = new Date().toISOString();
    const level = opts.level || 'info';
    console.log(`[${timestamp}] [${level.toUpperCase()}] === ${opts.title} ===\n${opts.content}\n`);
  }
};

const log = (...args: any[]) => {
  if (process.env.SQL_TOOL_DEBUG === "true") {
    console.error(`[${new Date().toISOString()}] [SQL-TOOLS]`, ...args);
  }
};

// -----------------------------
// Connection wrapper with retry & transactions
// -----------------------------
const withSqlConnection = async <T>(
  fn: (conn: PoolConnection) => Promise<T>,
  options: { readonly?: boolean; retries?: number } = {}
): Promise<T> => {
  const { readonly = true, retries = 3 } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let conn: PoolConnection | null = null;

    try {
      conn = await getPool().getConnection();

      // Set connection timeout and charset
      await conn.execute('SET SESSION wait_timeout = 300');
      await conn.execute('SET NAMES utf8mb4');

      if (!readonly) {
        await conn.beginTransaction();
      }

      const result = await fn(conn);

      if (!readonly) {
        await conn.commit();
      }

      return result;

    } catch (err: any) {
      if (conn && !readonly) {
        try {
          await conn.rollback();
        } catch (rollbackErr) {
          log('Rollback error:', rollbackErr);
        }
      }

      const isRetriableError = [
        'ECONNRESET',
        'PROTOCOL_CONNECTION_LOST',
        'ECONNREFUSED',
        'ETIMEDOUT'
      ].includes(err?.code);

      if (attempt < retries && isRetriableError) {
        log(`Retrying connection (attempt ${attempt + 1}/${retries}):`, err.message);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000)); // exponential backoff
        continue;
      }

      logPanel({
        title: 'Database Error',
        content: `Attempt ${attempt}/${retries}: ${err?.message}`,
        level: 'error'
      });
      throw err;

    } finally {
      if (conn) conn.release();
    }
  }

  throw new Error(`Failed after ${retries} attempts`);
};

// -----------------------------
// Database schema (shown to the LLM)
// -----------------------------
export const DATABASE_SCHEMA = `
Airport Database Schema (Optimized for Analytics):

DIMENSION TABLES:
1. dim_airports (Airport Master Data)
   - airport_iata (PK, CHAR(3)) - 3-letter IATA code
   - airport_icao (CHAR(4)) - 4-letter ICAO code
   - airport_name (VARCHAR(255)) - Full airport name
   - city (VARCHAR(100)) - City location
   - country (VARCHAR(100)) - Country name
   - country_code (CHAR(2)) - ISO country code
   - latitude (DECIMAL(10,8)) - GPS latitude
   - longitude (DECIMAL(11,8)) - GPS longitude
   - timezone (VARCHAR(50)) - Timezone identifier
   - timezone_offset (INT) - UTC offset in hours
   - evaluation_score (DECIMAL(3,2)) - Quality rating
   - reviews (INT) - Number of reviews
   - total_ratings (INT) - Total rating count
   - created_date, updated_date (DATETIME)

2. dim_aircraft (Aircraft Master Data)
   - aircraft_key (PK, VARCHAR(50)) - Unique aircraft identifier
   - aircraft_code (VARCHAR(10)) - Aircraft type code
   - aircraft_registration (VARCHAR(10)) - Registration number
   - aircraft_text (VARCHAR(255)) - Aircraft description
   - aircraft_hex (VARCHAR(6)) - Hex identifier
   - created_date, updated_date (DATETIME)

3. dim_airlines (Airline Master Data)
   - airline_iata (PK, CHAR(2)) - 2-letter IATA code
   - airline_icao (CHAR(3)) - 3-letter ICAO code
   - airline_name (VARCHAR(255)) - Full airline name
   - airline_short (VARCHAR(50)) - Short name
   - created_date, updated_date (DATETIME)

4. dim_dates (Date Dimension for Analytics)
   - date_key (PK, INT) - YYYYMMDD format
   - full_date (DATE) - Actual date
   - year (INT), quarter (INT), month (INT), week (INT)
   - day_of_month (INT), day_of_week (INT)
   - day_name (VARCHAR(10)), month_name (VARCHAR(10))
   - is_weekend (BOOLEAN), is_holiday (BOOLEAN)
   - date_name (VARCHAR(50)) - Formatted date string

5. dim_status (Flight Status Codes)
   - status_key (PK, INT) - Status identifier
   - status_code (VARCHAR(20)) - Status code
   - created_at, updated_at (DATETIME)

FACT TABLE:
6. fact_flights (Flight Operations - Main Analytics Table)
   - flight_number (PK, VARCHAR(20)) - Flight identifier
   - airline_iata (FK), airline_icao - Airline references
   - origin_airport_iata (FK), origin_airport_icao - Departure airport
   - destination_airport_iata (FK), destination_airport_icao - Arrival airport
   - aircraft_key (FK) - Aircraft reference
   - departure_date_key (FK), arrival_date_key (FK) - Date references
   - status_key (FK) - Status reference

   TIMING FIELDS:
   - scheduled_departure, scheduled_arrival (DATETIME)
   - estimated_departure, estimated_arrival (DATETIME)
   - real_departure (DATETIME) - Actual departure

   PERFORMANCE METRICS:
   - departure_delay_minutes (INT) - Delay in minutes (-1 = unknown)
   - arrival_delay_minutes (INT) - Arrival delay (-1 = unknown)
   - scheduled_flight_duration_minutes (INT) - Planned duration
   - actual_flight_duration_minutes (INT) - Actual duration (-1 = unknown)

   METADATA:
   - flight_type (VARCHAR(20)) - Flight category
   - flight_alternative (VARCHAR(50)) - Alternative info
   - load_date (DATETIME) - Data load timestamp

KEY OPTIMIZATION NOTES:
- Use NULLIF(column, -1) for unknown values in calculations
- Prefer country_code over country for filtering (indexed)
- All foreign keys are indexed for optimal JOIN performance
- Date keys enable efficient time-based analytics
`;

// -----------------------------
// Enhanced Query Generation
// -----------------------------
interface QueryGenerationOptions {
  enforceLimit?: boolean;
  maxLimit?: number;
  includeBestPractices?: boolean;
}

export const generateQueryPrompt = (
  userQuestion: string,
  options: QueryGenerationOptions = {}
): string => {
  const {
    enforceLimit = true,
    maxLimit = 100,
    includeBestPractices = true
  } = options;

  const bestPracticesSection = includeBestPractices ? `
MYSQL BEST PRACTICES:
- Use appropriate indexes for JOIN conditions and WHERE clauses
- Consider using NULLIF() for handling -1 sentinel values in calculations
- Use EXPLAIN to analyze query performance when needed
- Prefer specific column names over SELECT *
- Use appropriate data types in comparisons
- Consider using subqueries or CTEs for complex logic
` : '';

  const limitSection = enforceLimit ? `
PAGINATION REQUIREMENT: Always add LIMIT ${maxLimit} (or LIMIT offset, count with count ≤ ${maxLimit}).
` : '';

  return `
You are an expert **MySQL 8.0** analyst. Generate ONE optimized **MySQL-only** SELECT query for the airport database.

Return **JSON only** in this exact format:
{"query":"SELECT ..."}

Do not include code fences, explanations, or any text outside the JSON—JSON only.

DATABASE SCHEMA:
${DATABASE_SCHEMA}

ABSOLUTE MYSQL DIALECT RULES:
❌ NEVER use PostgreSQL features:
- ::casts → use CAST(value AS type)
- ILIKE → use UPPER(col) LIKE UPPER('%pattern%')
- STRING_AGG → use GROUP_CONCAT
- DISTINCT ON() → use window functions or subqueries
- DATE_PART() → use EXTRACT(unit FROM date)
- TO_CHAR()/TO_DATE() → use DATE_FORMAT()/STR_TO_DATE()
- EXTRACT(EPOCH FROM ...) → use UNIX_TIMESTAMP()
- GENERATE_SERIES → use recursive CTE or numbers table
- JSON operators (->>, ->) → use JSON_EXTRACT()/JSON_UNQUOTE()
- $1 placeholders → use ? placeholders
- "||" concatenation → use CONCAT()
- LIMIT ... OFFSET ... → use LIMIT offset, count
- Double quotes for identifiers → use backticks or plain names

✅ MySQL equivalents:
- CAST(value AS type) or conversion functions
- UPPER(column) LIKE UPPER('%pattern%') for case-insensitive
- GROUP_CONCAT(expr SEPARATOR 'sep')
- Window functions: ROW_NUMBER() OVER()
- EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date)
- DATE_FORMAT(date, '%Y-%m-%d'), STR_TO_DATE(str, '%Y-%m-%d')
- UNIX_TIMESTAMP(date)
- Recursive Common Table Expressions
- JSON_EXTRACT(json, '$.path'), JSON_UNQUOTE()
- Prepared statement placeholders: ?
- CONCAT(str1, str2, ...)
- LIMIT count or LIMIT offset, count

${limitSection}
${bestPracticesSection}

SPECIAL HANDLING:
- For delay calculations: use AVG(NULLIF(delay_column, -1)) to ignore unknown values
- For Tunisia filtering: use country_code = 'TN' (more efficient than country name)
- JOIN using exact FK column names from schema (airport_iata, airline_iata, etc.)
- Date filtering: use appropriate date functions and indexes

User question: "${userQuestion}"

Return ONLY: {"query":"..."}
`;
};

// -----------------------------
// Enhanced Validation System
// -----------------------------
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  type: 'syntax' | 'dialect' | 'security' | 'performance';
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  suggestion?: string;
}

interface ValidationWarning {
  type: 'performance' | 'style' | 'compatibility';
  message: string;
  suggestion?: string;
}

const POSTGRESQL_PATTERNS = [
  {
    pattern: /::/g,
    message: "PostgreSQL '::' cast syntax detected",
    suggestion: "Use CAST(value AS type) instead"
  },
  {
    pattern: /\bILIKE\b/gi,
    message: "PostgreSQL ILIKE operator detected",
    suggestion: "Use UPPER(column) LIKE UPPER('%pattern%') for case-insensitive matching"
  },
  {
    pattern: /\|\|(?!\s*')/g,
    message: "PostgreSQL '||' concatenation operator detected",
    suggestion: "Use CONCAT(str1, str2, ...) function"
  },
  {
    pattern: /\$\d+/g,
    message: "PostgreSQL numbered parameters detected",
    suggestion: "Use '?' placeholders for prepared statements"
  },
  {
    pattern: /\bSTRING_AGG\s*\(/gi,
    message: "PostgreSQL STRING_AGG function detected",
    suggestion: "Use GROUP_CONCAT(expr SEPARATOR 'delimiter')"
  },
  {
    pattern: /\bDISTINCT\s+ON\s*\(/gi,
    message: "PostgreSQL DISTINCT ON clause detected",
    suggestion: "Use window functions like ROW_NUMBER() OVER() instead"
  },
  {
    pattern: /\bDATE_PART\s*\(/gi,
    message: "PostgreSQL DATE_PART function detected",
    suggestion: "Use EXTRACT(unit FROM date)"
  },
  {
    pattern: /\bTO_CHAR\s*\(/gi,
    message: "PostgreSQL TO_CHAR function detected",
    suggestion: "Use DATE_FORMAT(date, format)"
  },
  {
    pattern: /\bTO_DATE\s*\(/gi,
    message: "PostgreSQL TO_DATE function detected",
    suggestion: "Use STR_TO_DATE(str, format)"
  },
  {
    pattern: /\bEXTRACT\s*\(\s*EPOCH\s+FROM/gi,
    message: "PostgreSQL EXTRACT(EPOCH FROM ...) detected",
    suggestion: "Use UNIX_TIMESTAMP(date)"
  },
  {
    pattern: /\bGENERATE_SERIES\s*\(/gi,
    message: "PostgreSQL GENERATE_SERIES function detected",
    suggestion: "Use recursive CTE or numbers table approach"
  },
  {
    pattern: /(->>|->|#>>|#>)/g,
    message: "PostgreSQL JSON operators detected",
    suggestion: "Use JSON_EXTRACT() and JSON_UNQUOTE() functions"
  },
  {
    pattern: /\bLIMIT\s+\d+\s+OFFSET\s+\d+/gi,
    message: "PostgreSQL LIMIT ... OFFSET ... syntax detected",
    suggestion: "Use MySQL LIMIT offset, count syntax"
  }
];

const MYSQL_WARNINGS = [
  {
    pattern: /SELECT\s+\*/gi,
    message: "SELECT * may impact performance",
    suggestion: "Consider selecting only needed columns"
  },
  {
    pattern: /(?<!WHERE\s.{0,100})\bLIKE\s+'%[^%]/gi,
    message: "Leading wildcard in LIKE may prevent index usage",
    suggestion: "Consider full-text search or different indexing strategy"
  },
  {
    pattern: /\bORDER\s+BY\s+RAND\(\)/gi,
    message: "ORDER BY RAND() can be slow on large tables",
    suggestion: "Consider alternative random sampling methods"
  }
];

export const validateMySQLSyntax = (sql: string): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!sql || !sql.trim()) {
    errors.push({
      type: 'syntax',
      message: 'Empty SQL query',
      severity: 'critical',
      suggestion: 'Provide a valid SQL SELECT statement'
    });
    return { isValid: false, errors, warnings };
  }

  const cleanSql = sql.trim();

  // Check for PostgreSQL patterns
  for (const pattern of POSTGRESQL_PATTERNS) {
    if (pattern.pattern.test(cleanSql)) {
      errors.push({
        type: 'dialect',
        message: pattern.message,
        severity: 'high',
        suggestion: pattern.suggestion
      });
    }
  }

  // Check for MySQL warnings
  for (const warning of MYSQL_WARNINGS) {
    if (warning.pattern.test(cleanSql)) {
      warnings.push({
        type: 'performance',
        message: warning.message,
        suggestion: warning.suggestion
      });
    }
  }

  // Additional validations
  if (!/^\s*(SELECT|WITH|EXPLAIN|DESCRIBE|SHOW)/i.test(cleanSql)) {
    errors.push({
      type: 'security',
      message: 'Only SELECT, WITH, EXPLAIN, DESCRIBE, and SHOW statements are allowed',
      severity: 'critical',
      suggestion: 'Use read-only operations only'
    });
  }

  // Check for LIMIT clause
  if (!/\bLIMIT\s+\d+/i.test(cleanSql) && /^\s*SELECT/i.test(cleanSql)) {
    warnings.push({
      type: 'performance',
      message: 'No LIMIT clause found',
      suggestion: 'Add LIMIT clause to prevent large result sets'
    });
  }

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)/gi,
    /\/\*[\s\S]*?\*\//g, // SQL comments that might hide malicious code
    /--[^\r\n]*/g // Single line comments
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cleanSql)) {
      errors.push({
        type: 'security',
        message: 'Potentially dangerous SQL pattern detected',
        severity: 'critical',
        suggestion: 'Remove any write operations or suspicious comments'
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

// -----------------------------
// Enhanced Auto-Repair System
// -----------------------------
interface RepairResult {
  repairedSql: string;
  repairs: RepairAction[];
  success: boolean;
}

interface RepairAction {
  type: string;
  original: string;
  replacement: string;
  confidence: 'high' | 'medium' | 'low';
}

export const repairToMySQL = (sql: string): RepairResult => {
  let repairedSql = String(sql || '');
  const repairs: RepairAction[] = [];

  const applyRepair = (
    pattern: RegExp,
    replacement: string | ((match: string, ...args: any[]) => string),
    type: string,
    confidence: 'high' | 'medium' | 'low' = 'high'
  ) => {
    const matches = repairedSql.match(pattern);
    if (matches) {
      matches.forEach(match => {
        repairs.push({
          type,
          original: match,
          replacement: typeof replacement === 'string' ? replacement : replacement(match),
          confidence
        });
      });
      repairedSql = repairedSql.replace(pattern, replacement);
    }
  };

  // Apply repairs in order of confidence
  applyRepair(/\bILIKE\b/gi, 'LIKE', 'case_insensitive_operator');

  applyRepair(
    /([A-Za-z0-9_\.\)]+)\s*::\s*([A-Za-z0-9_\(\)]+)/g,
    'CAST($1 AS $2)',
    'type_cast_syntax'
  );

  applyRepair(/\$([0-9]+)/g, '?', 'parameter_placeholder');

  applyRepair(
    /\bSTRING_AGG\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/gi,
    'GROUP_CONCAT($1 SEPARATOR $2)',
    'aggregation_function'
  );

  applyRepair(
    /\bDATE_PART\s*\(\s*'(\w+)'\s*,\s*([^\)]+)\)/gi,
    'EXTRACT($1 FROM $2)',
    'date_extraction'
  );

  applyRepair(
    /\bTO_CHAR\s*\(\s*([^,]+)\s*,\s*'([^']*)'\s*\)/gi,
    "DATE_FORMAT($1, '$2')",
    'date_formatting'
  );

  applyRepair(
    /\bTO_DATE\s*\(\s*([^,]+)\s*,\s*'([^']*)'\s*\)/gi,
    "STR_TO_DATE($1, '$2')",
    'date_parsing'
  );

  applyRepair(
    /\bEXTRACT\s*\(\s*EPOCH\s+FROM\s+([^\)]+)\)/gi,
    'UNIX_TIMESTAMP($1)',
    'epoch_extraction'
  );

  applyRepair(
    /\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/gi,
    'LIMIT $2, $1',
    'pagination_syntax'
  );

  applyRepair(
    /"([A-Za-z_][A-Za-z0-9_]*)"/g,
    '`$1`',
    'identifier_quoting',
    'medium'
  );

  // Handle concatenation (more complex pattern)
  const concatPattern = /(\w+|\([^)]+\))\s*\|\|\s*(\w+|\([^)]+\)|'[^']*')/g;
  if (concatPattern.test(repairedSql)) {
    const parts: string[] = [];
    let remaining = repairedSql;
    let match;

    while ((match = concatPattern.exec(remaining)) !== null) {
      parts.push(match[1], match[2]);
      repairs.push({
        type: 'concatenation_operator',
        original: match[0],
        replacement: `CONCAT(${match[1]}, ${match[2]})`,
        confidence: 'high'
      });
    }

    if (parts.length > 0) {
      repairedSql = repairedSql.replace(concatPattern, (match, p1, p2) => `CONCAT(${p1}, ${p2})`);
    }
  }

  // Ensure LIMIT exists for SELECT statements
  if (/^\s*SELECT/i.test(repairedSql) && !/\bLIMIT\s+\d+/i.test(repairedSql)) {
    repairedSql = repairedSql.replace(/;?\s*$/, ' LIMIT 100');
    repairs.push({
      type: 'add_limit_clause',
      original: 'No LIMIT clause',
      replacement: 'LIMIT 100',
      confidence: 'high'
    });
  }

  return {
    repairedSql: repairedSql.trim(),
    repairs,
    success: repairs.length > 0
  };
};

// -----------------------------
// Enhanced Query Extraction
// -----------------------------
export const extractQuery = (raw: string): string => {
  const txt = String(raw || '').trim();

  // Try JSON extraction first
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed.query === 'string') {
      return parsed.query.trim();
    }
  } catch (e) {
    // Not JSON, continue with other extraction methods
  }

  // Try code fence extraction
  const sqlFence = txt.match(/```sql\s*([\s\S]*?)\s*```/i);
  if (sqlFence) return sqlFence[1].trim();

  const genericFence = txt.match(/```\s*([\s\S]*?)\s*```/);
  if (genericFence) return genericFence[1].trim();

  // Try to find SQL statement
  const sqlMatch = txt.match(/(SELECT|WITH|EXPLAIN|DESCRIBE|SHOW)[\s\S]*$/i);
  if (sqlMatch) return sqlMatch[0].trim();

  // Return original if no patterns match
  return txt;
};

// -----------------------------
// Enhanced Regeneration System
// -----------------------------
export type SqlRegenerator = (args: {
  prompt: string;
  userQuestion?: string;
  previousAttempts?: string[];
  validationErrors?: ValidationError[];
}) => Promise<string | null | undefined>;

let _sqlRegenerator: SqlRegenerator | null = null;

export const registerSqlRegenerator = (fn: SqlRegenerator) => {
  _sqlRegenerator = fn;
};

export const buildRegenerationPrompt = (
  userQuestion: string,
  attemptedQuery: string,
  validationResult: ValidationResult,
  attemptNumber: number = 1
): string => {
  const basePrompt = generateQueryPrompt(userQuestion);

  const errorsSummary = validationResult.errors
    .map(err => `- ${err.message}${err.suggestion ? ` (Fix: ${err.suggestion})` : ''}`)
    .join('\n');

  const warningsSummary = validationResult.warnings.length > 0
    ? `\nWarnings to address:\n${validationResult.warnings
        .map(warn => `- ${warn.message}${warn.suggestion ? ` (Consider: ${warn.suggestion})` : ''}`)
        .join('\n')}`
    : '';

  const feedback = `

REGENERATION ATTEMPT ${attemptNumber}:
The previous SQL query failed MySQL validation. Fix these issues:

CRITICAL ERRORS:
${errorsSummary}
${warningsSummary}

FAILED QUERY (do not copy, reference only):
${attemptedQuery}

Generate a NEW MySQL-compatible query that addresses all the above issues.
Return **JSON only**: {"query":"..."}
`;

  return basePrompt + feedback;
};

// -----------------------------
// Main Tools (unchanged structure, enhanced validation)
// -----------------------------
const tablesCache = new Map<string, { tables: string[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const listTables = new DynamicStructuredTool({
  name: "list_tables",
  description: "List all user tables in the database with caching for performance. Provide reasoning for the request.",
  schema: z.object({
    reasoning: z.string().min(10).describe("Detailed explanation of why you need to list tables"),
  }),
  func: async ({ reasoning }) => {
    logPanel({ title: "List Tables Tool", content: `Reasoning: ${reasoning}` });

    const cacheKey = dbConfig.database || 'default';
    const cached = tablesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log('Using cached tables list');
      return JSON.stringify(cached.tables);
    }

    try {
      const tables = await withSqlConnection(async (conn) => {
        const [rows] = await conn.execute<RowDataPacket[]>(
          `SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS
           FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
           ORDER BY TABLE_NAME`,
          [dbConfig.database]
        );
        return rows.map((r: any) => ({
          name: r.TABLE_NAME,
          comment: r.TABLE_COMMENT || '',
          estimated_rows: r.TABLE_ROWS || 0,
        }));
      });

      tablesCache.set(cacheKey, { tables: tables.map((t: any) => t.name), timestamp: Date.now() });
      return JSON.stringify(tables);

    } catch (error: any) {
      log("Error listing tables:", error.message);
      return `Error listing tables: ${error.message}. Please check database connectivity.`;
    }
  },
});

export const sampleTable = new DynamicStructuredTool({
  name: "sample_table",
  description: "Retrieve an intelligent sample of rows from a table with column statistics.",
  schema: z.object({
    reasoning: z.string().min(10).describe("Why you need this sample"),
    table_name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).describe("Valid table name (letters, numbers, underscore only)"),
    row_sample_size: z.number().int().min(1).max(50).default(10).describe("Number of sample rows (1-50)"),
    include_stats: z.boolean().default(true).describe("Include basic column statistics"),
  }),
  func: async ({ reasoning, table_name, row_sample_size, include_stats }) => {
    logPanel({
      title: "Sample Table Tool",
      content: `Table: ${table_name}, Rows: ${row_sample_size}, Stats: ${include_stats}, Reasoning: ${reasoning}`
    });

    try {
      const result = await withSqlConnection(async (conn) => {
        const [rows, fields] = await conn.execute<RowDataPacket[]>(
          `SELECT * FROM ?? ORDER BY RAND() LIMIT ?`,
          [table_name, row_sample_size]
        );

        const columns = (fields || []).map((f: FieldPacket) => ({
          name: (f as any).name,
          type: (f as any).type,
          length: (f as any).length,
        }));

        let stats: Record<string, any> = {};
        if (include_stats) {
          const [statsRows] = await conn.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as total_rows FROM ??`,
            [table_name]
          );
          stats = { total_rows: (statsRows as any)[0]?.total_rows || 0 };
        }

        return { columns, sample: rows as RowDataPacket[], stats };
      });

      const sampleData = (result.sample as any[]).map((row) => {
        const obj: Record<string, any> = {};
        for (const key of Object.keys(row)) obj[key] = (row as any)[key];
        return obj;
      });

      return JSON.stringify({
        table: table_name,
        columns: result.columns,
        statistics: result.stats,
        sample_data: sampleData,
        sample_size: sampleData.length,
      }, null, 2);

    } catch (error: any) {
      log(`Error sampling table '${table_name}':`, error.message);
      return `Error sampling table '${table_name}': ${error.message}. Verify table name and permissions.`;
    }
  },
});

export const describeTable = new DynamicStructuredTool({
  name: "describe_table",
  description: "Get comprehensive table structure including indexes, constraints, and relationships.",
  schema: z.object({
    reasoning: z.string().min(10).describe("Why you need the table structure"),
    table_name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).describe("Valid table name"),
    include_indexes: z.boolean().default(true).describe("Include index information"),
  }),
  func: async ({ reasoning, table_name, include_indexes }) => {
    logPanel({
      title: "Describe Table Tool",
      content: `Table: ${table_name}, Indexes: ${include_indexes}, Reasoning: ${reasoning}`
    });

    try {
      const result = await withSqlConnection(async (conn) => {
        const [columns] = await conn.execute<RowDataPacket[]>(
          `SELECT
             COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY,
             COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH,
             NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_COMMENT
           FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [dbConfig.database, table_name]
        );

        let indexes: RowDataPacket[] = [] as any;
        if (include_indexes) {
          const [idxRows] = await conn.execute<RowDataPacket[]>(
            `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
             FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
            [dbConfig.database, table_name]
          );
          indexes = idxRows;
        }

        return { columns, indexes };
      });

      const columnDetails = (result.columns as any[]).map((col) => ({
        name: col.COLUMN_NAME,
        type: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        key: col.COLUMN_KEY,
        default: col.COLUMN_DEFAULT,
        extra: col.EXTRA,
        max_length: col.CHARACTER_MAXIMUM_LENGTH,
        precision: col.NUMERIC_PRECISION,
        scale: col.NUMERIC_SCALE,
        comment: col.COLUMN_COMMENT,
      }));

      return JSON.stringify({
        table: table_name,
        columns: columnDetails,
        indexes: result.indexes,
        total_columns: columnDetails.length,
      }, null, 2);

    } catch (error: any) {
      log(`Error describing table '${table_name}':`, error.message);
      return `Error describing table '${table_name}': ${error.message}. Verify table exists and you have access.`;
    }
  },
});

// -----------------------------
// Enhanced Execute SQL with Multi-Stage Validation
// -----------------------------
interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  validationResult?: ValidationResult;
  repairResult?: RepairResult;
  regenerationAttempts?: number;
  finalQuery?: string;
  executionTime?: number;
}

const ExecuteSqlArgs = z.object({
  reasoning: z.string().min(15).describe("Detailed explanation of why you need to run this SQL"),
  sql_query: z.string().min(10).max(5000).describe("The SQL SELECT query to execute (max 5000 chars) or JSON response from LLM"),
  explain_plan: z.boolean().default(false).describe("Include query execution plan analysis"),
  user_question: z.string().optional().describe("Original natural-language question for regeneration"),
  attempt_regeneration: z.boolean().default(true).describe("Attempt auto-regeneration on validation failure"),
  max_regeneration_attempts: z.number().int().min(0).max(3).default(2).describe("Maximum regeneration attempts"),
});

const isSelectOnly = (sql: string): boolean => {
  const normalized = (sql || '').trim().toUpperCase();
  const allowedStarters = ['SELECT', 'WITH', 'EXPLAIN', 'DESCRIBE', 'SHOW'];
  return allowedStarters.some(starter => normalized.startsWith(starter));
};

export const executeSql = new DynamicStructuredTool({
  name: "execute_sql",
  description: "Execute optimized SQL SELECT queries with comprehensive validation and auto-repair.",
  schema: ExecuteSqlArgs,
  func: async ({
    reasoning,
    sql_query,
    explain_plan,
    user_question,
    attempt_regeneration,
    max_regeneration_attempts
  }): Promise<string> => {
    logPanel({
      title: "Execute SQL Tool",
      content: `Reasoning: ${reasoning}\nSQL(raw): ${sql_query.substring(0, 200)}...\nExplain: ${explain_plan}`
    });

    const result: ExecutionResult = {
      success: false,
      regenerationAttempts: 0
    };

    // Extract and normalize query
    let currentQuery = extractQuery(sql_query);
    let validationResult = validateMySQLSyntax(currentQuery);

    // Stage 1: Initial validation
    if (!validationResult.isValid) {
      log('Initial validation failed, attempting repair...');

      // Stage 2: Auto-repair attempt
      const repairResult = repairToMySQL(currentQuery);
      result.repairResult = repairResult;

      if (repairResult.success) {
        currentQuery = repairResult.repairedSql;
        validationResult = validateMySQLSyntax(currentQuery);

        if (validationResult.isValid) {
          log('Successfully repaired query to valid MySQL');
        }
      }

      // Stage 3: Regeneration attempts (if still invalid and regenerator available)
      if (!validationResult.isValid && _sqlRegenerator && attempt_regeneration) {
        const allowRegen = process.env.SQL_TOOL_AUTOREGEN !== 'false';

        if (allowRegen) {
          for (let attempt = 1; attempt <= max_regeneration_attempts; attempt++) {
            try {
              log(`Attempting regeneration ${attempt}/${max_regeneration_attempts}...`);

              const regenPrompt = buildRegenerationPrompt(
                user_question || reasoning,
                currentQuery,
                validationResult,
                attempt
              );

              const regenRaw = await _sqlRegenerator({
                prompt: regenPrompt,
                userQuestion: user_question,
                previousAttempts: [currentQuery],
                validationErrors: validationResult.errors
              });

              if (regenRaw) {
                const regenQuery = extractQuery(String(regenRaw));
                const regenValidation = validateMySQLSyntax(regenQuery);

                if (regenValidation.isValid) {
                  log(`Regeneration attempt ${attempt} successful`);
                  currentQuery = regenQuery;
                  validationResult = regenValidation;
                  result.regenerationAttempts = attempt;
                  break;
                } else {
                  // Try repairing the regenerated query
                  const regenRepair = repairToMySQL(regenQuery);
                  if (regenRepair.success) {
                    const repairedValidation = validateMySQLSyntax(regenRepair.repairedSql);
                    if (repairedValidation.isValid) {
                      log(`Regeneration attempt ${attempt} successful after repair`);
                      currentQuery = regenRepair.repairedSql;
                      validationResult = repairedValidation;
                      result.regenerationAttempts = attempt;
                      break;
                    }
                  }

                  if (attempt === max_regeneration_attempts) {
                    log(`All regeneration attempts failed`);
                  }
                }
              }
            } catch (error) {
              log(`Regeneration attempt ${attempt} failed:`, error);
            }
          }
        }
      }
    }

    result.validationResult = validationResult;
    result.finalQuery = currentQuery;

    // Final validation check
    if (!validationResult.isValid) {
      const errorDetails = {
        success: false,
        error: "MySQL syntax validation failed after all attempts",
        original_query: extractQuery(sql_query),
        final_query: currentQuery,
        validation_errors: validationResult.errors.map(err => ({
          type: err.type,
          message: err.message,
          severity: err.severity,
          suggestion: err.suggestion
        })),
        validation_warnings: validationResult.warnings,
        repairs_attempted: result.repairResult?.repairs || [],
        regeneration_attempts: result.regenerationAttempts,
        suggestions: [
          "Ensure the query uses MySQL 8.0 syntax only",
          "Avoid PostgreSQL-specific features",
          "Check table and column names against the schema",
          "Consider simplifying complex queries"
        ]
      };

      return JSON.stringify(errorDetails, null, 2);
    }

    // Security check: prevent writes unless explicitly enabled
    const allowWrites = process.env.SQL_TOOL_ALLOW_WRITES === "true";
    if (!allowWrites && !isSelectOnly(currentQuery)) {
      return JSON.stringify({
        success: false,
        error: "Write operations are disabled",
        hint: "Only SELECT, WITH, EXPLAIN, DESCRIBE, and SHOW statements are allowed",
        query_type_detected: currentQuery.trim().split(/\s+/)[0].toUpperCase()
      }, null, 2);
    }

    // Stage 4: Execute the validated query
    try {
      const executionResult = await withSqlConnection(async (conn) => {
        let explainResult: any = null;

        // Get execution plan if requested
        if (explain_plan && currentQuery.trim().toUpperCase().startsWith('SELECT')) {
          try {
            const [explainRows] = await conn.execute(`EXPLAIN FORMAT=JSON ${currentQuery}`);
            explainResult = explainRows;
          } catch (explainError) {
            log('Explain plan failed:', explainError);
            // Fallback to simple EXPLAIN
            try {
              const [simpleExplain] = await conn.execute(`EXPLAIN ${currentQuery}`);
              explainResult = simpleExplain;
            } catch (fallbackError) {
              log('Simple explain also failed:', fallbackError);
            }
          }
        }

        const startTime = Date.now();
        const [rowsOrHeader, fields] = await conn.execute(currentQuery);
        const executionTime = Date.now() - startTime;

        return { rowsOrHeader, fields, explainResult, executionTime };
      }, { readonly: !allowWrites });

      const fields = executionResult.fields as FieldPacket[] | undefined;
      result.executionTime = executionResult.executionTime;

      // Handle SELECT results
      if (Array.isArray(fields) && fields.length > 0) {
        const columns = fields.map((f: any) => f.name);
        const rows = Array.isArray(executionResult.rowsOrHeader)
          ? (executionResult.rowsOrHeader as RowDataPacket[])
          : [];

        const responseData = {
          success: true,
          execution_time_ms: executionResult.executionTime,
          query_used: currentQuery,
          columns,
          row_count: rows.length,
          data: rows.slice(0, 100), // Always limit returned data
          truncated: rows.length > 100,
          validation_warnings: validationResult.warnings,
          repairs_applied: result.repairResult?.repairs || [],
          regeneration_attempts: result.regenerationAttempts || 0,
          explain_plan: executionResult.explainResult
        };

        result.success = true;
        result.data = responseData;
        return JSON.stringify(responseData, null, 2);
      }

      // Handle non-SELECT results (shouldn't happen in read-only mode)
      const header = executionResult.rowsOrHeader as ResultSetHeader;
      const nonSelectResponse = {
        success: true,
        execution_time_ms: executionResult.executionTime,
        query_used: currentQuery,
        affected_rows: header?.affectedRows ?? 0,
        insert_id: header?.insertId ?? null,
        validation_warnings: validationResult.warnings,
        repairs_applied: result.repairResult?.repairs || [],
        regeneration_attempts: result.regenerationAttempts || 0
      };

      result.success = true;
      result.data = nonSelectResponse;
      return JSON.stringify(nonSelectResponse, null, 2);

    } catch (executionError: any) {
      log("SQL execution error:", executionError?.message);

      const errorResponse = {
        success: false,
        error: executionError?.message || "Unknown execution error",
        sql_state: executionError?.sqlState,
        error_code: executionError?.code,
        query_used: currentQuery,
        execution_time_ms: result.executionTime,
        validation_warnings: validationResult.warnings,
        repairs_applied: result.repairResult?.repairs || [],
        regeneration_attempts: result.regenerationAttempts || 0,
        troubleshooting_hints: [
          "Verify table and column names exist in the database",
          "Check that all JOIN conditions reference valid foreign keys",
          "Ensure date formats and data types are compatible",
          "Consider simplifying complex subqueries or CTEs"
        ]
      };

      return JSON.stringify(errorResponse, null, 2);
    }
  },
});

// -----------------------------
// Tool registry & dispatcher
// -----------------------------
export const getAvailableTools = () => [listTables, sampleTable, describeTable, executeSql];

export type ToolCall = { name: string; args: unknown; id: string };

export const callTool = async (toolCall: ToolCall): Promise<ToolMessage> => {
  const toolsByName = Object.fromEntries(getAvailableTools().map(t => [t.name, t]));
  const tool = toolsByName[toolCall.name as keyof typeof toolsByName] as any;

  if (!tool) {
    throw new Error(`Unknown tool: ${toolCall.name}. Available tools: ${Object.keys(toolsByName).join(', ')}`);
  }

  try {
    const content = await tool.invoke(toolCall.args as any);
    return new ToolMessage({
      content: String(content),
      tool_call_id: (toolCall as any).id,
      name: tool.name
    });
  } catch (error: any) {
    return new ToolMessage({
      content: `Tool execution failed: ${error?.message}`,
      tool_call_id: (toolCall as any).id,
      name: tool.name
    });
  }
};

// -----------------------------
// Enhanced Cleanup & Utilities
// -----------------------------
export const closePool = async (): Promise<void> => {
  if (pool) {
    try {
      await pool.end();
      log('Database pool closed successfully');
    } catch (error) {
      log('Error closing pool:', error);
    } finally {
      pool = null;
    }
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', closePool);
process.on('SIGINT', closePool);
process.on('SIGQUIT', closePool);

// -----------------------------
// Additional Utility Functions
// -----------------------------

/**
 * Test database connectivity
 */
export const testConnection = async (): Promise<{ success: boolean; message: string; details?: any }> => {
  try {
    const result = await withSqlConnection(async (conn) => {
      const [rows] = await conn.execute('SELECT 1 as test, CONNECTION_ID() as connection_id, VERSION() as version');
      return rows;
    });

    return {
      success: true,
      message: 'Database connection successful',
      details: result
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Database connection failed: ${error.message}`,
      details: { error: error.message, code: error.code }
    };
  }
};

/**
 * Get database statistics and health info
 */
export const getDatabaseHealth = async (): Promise<string> => {
  try {
    const health = await withSqlConnection(async (conn) => {
      const [variables] = await conn.execute(
        "SHOW GLOBAL STATUS WHERE Variable_name IN ('Connections', 'Threads_connected', 'Threads_running', 'Uptime')"
      ) as [RowDataPacket[], any];

      const [processlist] = await conn.execute(
        "SELECT COUNT(*) as active_connections FROM INFORMATION_SCHEMA.PROCESSLIST"
      ) as [RowDataPacket[], any];

      return {
        global_status: variables,
        active_connections: processlist[0]?.active_connections || 0,
        pool_config: {
          connection_limit: dbConfig.connectionLimit,
          database: dbConfig.database,
          host: dbConfig.host,
          port: dbConfig.port
        }
      };
    });

    return JSON.stringify(health, null, 2);
  } catch (error: any) {
    return JSON.stringify({
      success: false,
      error: `Failed to get database health: ${error.message}`
    }, null, 2);
  }
};

// Export configuration for external access
export const getDbConfig = () => ({
  ...dbConfig,
  password: '***' // Hide password in exports
});

export default {
  getAvailableTools,
  callTool,
  executeSql,
  listTables,
  sampleTable,
  describeTable,
  validateMySQLSyntax,
  repairToMySQL,
  extractQuery,
  generateQueryPrompt,
  registerSqlRegenerator,
  buildRegenerationPrompt,
  testConnection,
  getDatabaseHealth,
  closePool
};
