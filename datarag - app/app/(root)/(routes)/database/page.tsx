"use client";
import React, { useState, useEffect } from 'react';
import { Database, Search, Code, Table, AlertCircle, Clock, CheckCircle, Loader, Copy } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { BeatLoader } from 'react-spinners';
import { toast, Toaster } from 'react-hot-toast';
interface QueryResult {
  success: boolean;
  question?: string;
  sqlQuery?: string;
  executionTime?: number;
  rowCount?: number;
  data?: any[];
  answer?: string;
  error?: string;
}

interface TableInfo {
  [tableName: string]: {
    column: string;
    type: string;
    nullable: boolean;
    key: string;
    default: any;
    extra: string;
  }[];
}

const DatabaseQueryInterface = () => {
  const [query, setQuery] = useState('');
  const [directSQL, setDirectSQL] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'natural' | 'sql'>('natural');
  const [tableInfo, setTableInfo] = useState<TableInfo>({});
  const [showSchema, setShowSchema] = useState(false);



  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  // Example queries
  const exampleQueries = [
    "Show me all flights from JFK to LAX today",
    "What are the top 10 airlines by number of flights?",
    "Which airports have the highest average delays?",
    "Show me flight statistics for American Airlines",
    "What are the most popular routes?",
    "Show me aircraft utilization statistics"
  ];

  // Load table information on mount
  useEffect(() => {
    fetchTableInfo();
  }, []);

  const fetchTableInfo = async () => {
    try {
      const response = await fetch('/api/database?action=tables');
      const data = await response.json();
      if (data.tables) {
        setTableInfo(data.tables);
      }
    } catch (error) {
      console.error('Failed to load table info:', error);
    }
  };

  const executeQuery = async () => {
    if (!query.trim() && !directSQL.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: mode === 'natural' ? query : undefined,
          directQuery: mode === 'sql' ? directSQL : undefined,
          model: "qwen2.5-coder:7b-instruct",
          returnRawData: mode === 'sql',
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: 'Failed to execute query. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const getSampleData = async (tableName: string) => {
    try {
      const res = await fetch(
        `/api/database?action=sample&table=${encodeURIComponent(tableName)}`,
        { credentials: "same-origin" } // keep cookies if Clerk protects the route
      );

      if (!res.ok) {
        console.error("Sample fetch failed:", res.status, await res.text());
        return;
      }

      const json = await res.json();
      const rows = Array.isArray(json.rows) ? json.rows
        : Array.isArray(json.data) ? json.data
          : [];

      if (json.success && rows.length >= 0) {
        setResult({
          success: true,
          question: `Sample data from ${tableName}`,
          sqlQuery: `SELECT * FROM ${tableName} LIMIT 5`,
          data: rows,
          rowCount: rows.length,
        });
      } else {
        console.error("Unexpected sample payload:", json);
      }
    } catch (error) {
      console.error("Failed to get sample data:", error);
    }
  };


  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-3 mb-4">
          <Database className="w-8 h-8 text-gray-900 dark:text-gray-100" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Airport Database Query Agent
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Query the airport database using natural language or SQL
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex justify-center mb-6">
        <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setMode("natural")}
            className={`px-4 py-2 rounded-md transition-colors ${mode === "natural"
              ? "bg-white dark:bg-gray-900 shadow text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
          >
            <Search className="w-4 h-4 inline mr-2" />
            Natural Language
          </button>
          <button
            onClick={() => setMode("sql")}
            className={`px-4 py-2 rounded-md transition-colors ${mode === "sql"
              ? "bg-white dark:bg-gray-900 shadow text-gray-900 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
          >
            <Code className="w-4 h-4 inline mr-2" />
            Direct SQL
          </button>
        </div>
      </div>

      {/* Query Input */}
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        {mode === "natural" ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Ask a question about the airport data:
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., Show me all flights from New York to Los Angeles with delays over 30 minutes"
              className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-gray-500 focus:border-gray-500 resize-none"
              rows={3}
            />

            {/* Example Queries */}
            <div className="mt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                Example queries:
              </p>
              <div className="flex flex-wrap gap-2">
                {exampleQueries.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => setQuery(example)}
                    className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-3 py-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              SQL Query (SELECT only):
            </label>
            <textarea
              value={directSQL}
              onChange={(e) => setDirectSQL(e.target.value)}
              placeholder="SELECT * FROM fact_flights WHERE departure_delay_minutes > 30 LIMIT 10"
              className="w-full p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm resize-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
              rows={4}
            />
          </div>
        )}

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => setShowSchema(!showSchema)}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 flex items-center gap-1"
          >
            <Table className="w-4 h-4" />
            {showSchema ? "Hide" : "Show"} Database Schema
          </button>

          <button
            onClick={executeQuery}
            disabled={loading || (!query.trim() && !directSQL.trim())}
            className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-6 py-2 rounded-md hover:bg-gray-700 dark:hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {loading ? "Executing..." : "Execute Query"}
          </button>
        </div>
      </div>

      {/* Database Schema */}
      {showSchema && (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <Table className="w-5 h-5" />
            Database Tables
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(tableInfo).map(([tableName, columns]) => (
              <div
                key={tableName}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                    {tableName}
                  </h4>
                  <button
                    onClick={() => getSampleData(tableName)}
                    className="text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-2 py-1 rounded"
                  >
                    Sample
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  {columns.slice(0, 5).map((col) => (
                    <div
                      key={col.column}
                      className="flex justify-between"
                    >
                      <span
                        className={
                          col.key === "PRI"
                            ? "font-semibold text-gray-900 dark:text-gray-100"
                            : "text-gray-700 dark:text-gray-300"
                        }
                      >
                        {col.column}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">
                        {col.type}
                      </span>
                    </div>
                  ))}
                  {columns.length > 5 && (
                    <div className="text-gray-400 dark:text-gray-500 text-xs">
                      ... and {columns.length - 5} more
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-4">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            ) : (
              <AlertCircle className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            )}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {result.success ? "Query Results" : "Query Error"}
            </h3>
            {typeof result.executionTime === "number" && (
              <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {result.executionTime}ms
              </span>
            )}
          </div>

          {/* Error state */}
          {!result.success && result.error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {result.error}
            </div>
          )}

          {/* SQL used */}
          {result.sqlQuery && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">SQL</div>
                <button
                  onClick={() => copyToClipboard(result.sqlQuery!)}
                  className="text-xs text-gray-600 dark:text-gray-300 hover:underline"
                >
                  Copy
                </button>
              </div>
              <pre className="text-xs p-3 rounded-md bg-gray-50 dark:bg-gray-800 overflow-auto border border-gray-200 dark:border-gray-700">
                {result.sqlQuery}
              </pre>
            </div>
          )}

          {/* Markdown answer/summary */}
          {result.answer && (
            <div className="prose prose-sm dark:prose-invert max-w-none mb-4">
              <Streamdown markdown={result.answer} />
            </div>
          )}

          {/* Data table */}
          {Array.isArray(result.data) && result.data.length > 0 && (
            <div className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-md">
              {(() => {
                const cols = Object.keys(result.data[0]).slice(0, 50);
                return (
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-gray-800">
                      <tr>
                        {cols.map((c) => (
                          <th key={c} className="text-left px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.slice(0, 100).map((row, i) => (
                        <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                          {cols.map((c) => (
                            <td key={c} className="px-3 py-2 text-gray-800 dark:text-gray-200 whitespace-nowrap">
                              {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          )}

          {/* Note about truncated results */}
          {"note" in result && result.note && (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {result.note}
            </div>
          )}

          {/* Empty state */}
          {result.success && (!result.data || result.data.length === 0) && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              No rows returned. Try adjusting your filters or date range.
            </div>
          )}
        </div>
      )}


      {/* Loading State */}
      {loading && (
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <BeatLoader size={8} color="#555" />
            <span className="text-gray-600 dark:text-gray-400">
              Processing your query...
            </span>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          💡 Tips for better queries:
        </h4>
        <ul className="text-gray-700 dark:text-gray-300 text-sm space-y-1">
          <li>• Use specific airport codes (JFK, LAX) or airline names</li>
          <li>• Ask for specific date ranges when querying flight data</li>
          <li>• Use terms like "delays", "on-time", "statistics", "top airports"</li>
          <li>• For SQL mode, remember to use proper table joins and LIMIT clauses</li>
          <li>• Check the database schema to understand table relationships</li>
        </ul>
      </div>
    </div>
  );
};

export default DatabaseQueryInterface;
