// types/common.ts
// Common types used throughout the application

// Generic API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

export interface ApiError {
  message: string;
  code?: string | number;
  details?: Record<string, unknown>;
  timestamp?: string;
}

export interface PaginatedResponse<T = unknown> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Request Headers and Context
export interface RequestHeaders {
  'Content-Type'?: string;
  'Authorization'?: string;
  'X-Session-ID'?: string;
  'X-User-ID'?: string;
  [key: string]: string | undefined;
}

export interface RequestContext {
  userId: string;
  sessionId?: string;
  requestId?: string;
  timestamp: string;
}

// Generic Data Structures
export interface KeyValuePair<T = unknown> {
  key: string;
  value: T;
}

export interface NameValuePair<T = unknown> {
  name: string;
  value: T;
}

export interface SelectableItem {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  selected?: boolean;
}

export interface TreeNode<T = unknown> {
  id: string;
  label: string;
  data?: T;
  children?: TreeNode<T>[];
  parent?: TreeNode<T>;
  expanded?: boolean;
}

// Database-like structures
export interface DatabaseRow {
  [column: string]: string | number | boolean | null | Date;
}

export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  rowCount?: number;
  indexCount?: number;
  lastUpdated?: Date;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey?: {
    table: string;
    column: string;
  };
  defaultValue?: string | number | boolean | null;
  maxLength?: number;
}

// File and Upload Types
export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

// Time-based data
export interface TimestampedData {
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export interface TimeRange {
  start: Date | string;
  end: Date | string;
}

// Configuration objects
export interface FeatureFlags {
  [featureName: string]: boolean;
}

export interface AppConfig {
  version: string;
  environment: 'development' | 'staging' | 'production';
  apiUrl: string;
  features: FeatureFlags;
  limits: {
    maxFileSize: number;
    maxRequestSize: number;
    rateLimit: number;
  };
}

// Event and callback types
export type EventCallback<T = unknown> = (data: T) => void;
export type AsyncEventCallback<T = unknown> = (data: T) => Promise<void>;
export type ErrorCallback = (error: Error) => void;

// Utility types for replacing any
export type UnknownRecord = Record<string, unknown>;
export type StringRecord = Record<string, string>;
export type NumberRecord = Record<string, number>;
export type BooleanRecord = Record<string, boolean>;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// Generic state types
export interface LoadingState<T = unknown> {
  isLoading: boolean;
  data?: T;
  error?: string | Error;
}

export interface AsyncState<T = unknown> extends LoadingState<T> {
  hasLoaded: boolean;
  lastUpdated?: Date;
}

// Search and filter types
export interface SearchFilter {
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan';
  value: string | number | boolean;
}

export interface SearchQuery {
  term?: string;
  filters?: SearchFilter[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SearchResult<T = unknown> {
  items: T[];
  total: number;
  query: SearchQuery;
  facets?: { [field: string]: { [value: string]: number } };
}

// Langchain document type representation
export interface LangchainDocument {
  pageContent: string;
  metadata: UnknownRecord;
}

// Component state types
export interface ComponentError {
  message: string;
  code?: string;
  recoverable: boolean;
  details?: UnknownRecord;
}
