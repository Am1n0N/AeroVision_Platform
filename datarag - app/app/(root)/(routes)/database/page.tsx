"use client";
import React, { useState, useEffect } from 'react';
import { Database, Search, Code, Table, AlertCircle, Clock, CheckCircle, Loader, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { BeatLoader } from 'react-spinners';

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

  // Markdown utilities
  const fixMarkdownLists = (markdown: string): string => {
    return markdown.replace(/([^\n])\n(-|\d+\.)/g, "$1\n\n$2");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // You can add a toast notification here if you have one
  };

  const markdownComponents = {
    p: ({ children }: { children: React.ReactNode }) => (
      <p className="mb-3">{children}</p>
    ),
    ul: ({ children }: { children: React.ReactNode }) => (
      <ul className="list-disc ml-5 mb-3">{children}</ul>
    ),
    ol: ({ children }: { children: React.ReactNode }) => (
      <ol className="list-decimal ml-5 mb-3">{children}</ol>
    ),
    li: ({ children }: { children: React.ReactNode }) => (
      <li className="mb-1">{children}</li>
    ),
    h1: ({ children }: { children: React.ReactNode }) => (
      <h1 className="text-2xl font-bold mb-4">{children}</h1>
    ),
    h2: ({ children }: { children: React.ReactNode }) => (
      <h2 className="text-xl font-semibold mb-3">{children}</h2>
    ),
    h3: ({ children }: { children: React.ReactNode }) => (
      <h3 className="text-lg font-medium mb-2">{children}</h3>
    ),
    code: ({ children }: { children: React.ReactNode }) => (
      <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">{children}</code>
    ),
    pre: ({ children }: { children: React.ReactNode }) => (
      <pre className="bg-gray-100 p-3 rounded-lg overflow-x-auto mb-3">{children}</pre>
    ),
    blockquote: ({ children }: { children: React.ReactNode }) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-700 mb-3">{children}</blockquote>
    ),
    table: ({ children }: { children: React.ReactNode }) => (
      <div className="overflow-x-auto mb-3">
        <table className="min-w-full divide-y divide-gray-200">{children}</table>
      </div>
    ),
    thead: ({ children }: { children: React.ReactNode }) => (
      <thead className="bg-gray-50">{children}</thead>
    ),
    tbody: ({ children }: { children: React.ReactNode }) => (
      <tbody className="bg-white divide-y divide-gray-200">{children}</tbody>
    ),
    th: ({ children }: { children: React.ReactNode }) => (
      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
        {children}
      </th>
    ),
    td: ({ children }: { children: React.ReactNode }) => (
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{children}</td>
    ),
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
          <Database className="w-8 h-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">Airport Database Query Agent</h1>
        </div>
        <p className="text-gray-600">Query the airport database using natural language or SQL</p>
      </div>

      {/* Mode Toggle */}
      <div className="flex justify-center mb-6">
        <div className="bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setMode('natural')}
            className={`px-4 py-2 rounded-md transition-colors ${
              mode === 'natural'
                ? 'bg-white shadow text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Search className="w-4 h-4 inline mr-2" />
            Natural Language
          </button>
          <button
            onClick={() => setMode('sql')}
            className={`px-4 py-2 rounded-md transition-colors ${
              mode === 'sql'
                ? 'bg-white shadow text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Code className="w-4 h-4 inline mr-2" />
            Direct SQL
          </button>
        </div>
      </div>

      {/* Query Input */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        {mode === 'natural' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ask a question about the airport data:
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., Show me all flights from New York to Los Angeles with delays over 30 minutes"
              className="w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={3}
            />

            {/* Example Queries */}
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">Example queries:</p>
              <div className="flex flex-wrap gap-2">
                {exampleQueries.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => setQuery(example)}
                    className="text-xs bg-blue-50 text-blue-700 px-3 py-1 rounded-full hover:bg-blue-100 transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SQL Query (SELECT only):
            </label>
            <textarea
              value={directSQL}
              onChange={(e) => setDirectSQL(e.target.value)}
              placeholder="SELECT * FROM fact_flights WHERE departure_delay_minutes > 30 LIMIT 10"
              className="w-full p-3 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm resize-none"
              rows={4}
            />
          </div>
        )}

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => setShowSchema(!showSchema)}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <Table className="w-4 h-4" />
            {showSchema ? 'Hide' : 'Show'} Database Schema
          </button>

          <button
            onClick={executeQuery}
            disabled={loading || (!query.trim() && !directSQL.trim())}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Executing...' : 'Execute Query'}
          </button>
        </div>
      </div>

      {/* Database Schema */}
      {showSchema && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Table className="w-5 h-5" />
            Database Tables
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(tableInfo).map(([tableName, columns]) => (
              <div key={tableName} className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-semibold text-gray-900">{tableName}</h4>
                  <button
                    onClick={() => getSampleData(tableName)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
                  >
                    Sample
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  {columns.slice(0, 5).map((col) => (
                    <div key={col.column} className="flex justify-between">
                      <span className={col.key === 'PRI' ? 'font-semibold text-blue-600' : 'text-gray-700'}>
                        {col.column}
                      </span>
                      <span className="text-gray-500 text-xs">{col.type}</span>
                    </div>
                  ))}
                  {columns.length > 5 && (
                    <div className="text-gray-400 text-xs">... and {columns.length - 5} more</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <h3 className="text-lg font-semibold">
              {result.success ? 'Query Results' : 'Query Error'}
            </h3>
            {result.executionTime && (
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {result.executionTime}ms
              </span>
            )}
          </div>

          {result.success ? (
            <div className="space-y-4">
              {/* SQL Query */}
              {result.sqlQuery && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-700">Generated SQL:</h4>
                    <button
                      onClick={() => copyToClipboard(result.sqlQuery!)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Copy SQL"
                    >
                      <Copy className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                  <code className="block bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
                    {result.sqlQuery}
                  </code>
                </div>
              )}

              {/* AI Response with Markdown */}
              {result.answer && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-700">Answer:</h4>
                    <button
                      onClick={() => copyToClipboard(result.answer!)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Copy answer"
                    >
                      <Copy className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">
                    <div className="prose prose-sm max-w-none text-gray-800">
                      <ReactMarkdown components={markdownComponents}>
                        {fixMarkdownLists(result.answer)}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Table */}
              {result.data && result.data.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">
                    Data ({result.rowCount} row{result.rowCount !== 1 ? 's' : ''}):
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {Object.keys(result.data[0]).map((key) => (
                            <th
                              key={key}
                              className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                            >
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {result.data.slice(0, 50).map((row, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            {Object.entries(row).map(([key, value], cellIndex) => (
                              <td
                                key={cellIndex}
                                className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                              >
                                {value === null ? (
                                  <span className="text-gray-400 italic">null</span>
                                ) : typeof value === 'boolean' ? (
                                  <span className={`px-2 py-1 rounded-full text-xs ${
                                    value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                  }`}>
                                    {value.toString()}
                                  </span>
                                ) : typeof value === 'object' ? (
                                  <span className="text-gray-600 text-xs">
                                    {JSON.stringify(value)}
                                  </span>
                                ) : (
                                  String(value)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.data.length > 50 && (
                      <div className="text-center py-4 text-gray-500 text-sm">
                        Showing first 50 rows of {result.rowCount} total results
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* No Data Message */}
              {(!result.data || result.data.length === 0) && !result.answer && (
                <div className="text-center py-8 text-gray-500">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-yellow-800">
                      Query executed successfully but returned no data.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Error Display */
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="prose prose-sm max-w-none text-red-800">
                <ReactMarkdown components={markdownComponents}>
                  {fixMarkdownLists(result.error || "An unknown error occurred")}
                </ReactMarkdown>
              </div>
              {result.sqlQuery && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-red-700">Attempted SQL:</h4>
                    <button
                      onClick={() => copyToClipboard(result.sqlQuery!)}
                      className="p-1 hover:bg-red-100 rounded transition-colors"
                      title="Copy SQL"
                    >
                      <Copy className="w-4 h-4 text-red-600" />
                    </button>
                  </div>
                  <code className="block bg-red-100 p-2 rounded text-sm font-mono">
                    {result.sqlQuery}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <BeatLoader size={8} color="#3B82F6" />
            <span className="text-gray-600">Processing your query...</span>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-blue-50 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">💡 Tips for better queries:</h4>
        <ul className="text-blue-800 text-sm space-y-1">
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
