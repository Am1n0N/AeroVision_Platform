// types/database.ts
// Database and SQL query-related type definitions

export interface QueryGenerationOptions {
  enforceLimit?: boolean;
  maxLimit?: number;
  includeBestPractices?: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  type: "syntax" | "dialect" | "security" | "performance";
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  suggestion?: string;
}

export interface ValidationWarning {
  type: "performance" | "style" | "compatibility";
  message: string;
  suggestion?: string;
}

export interface RepairResult {
  repairedSql: string;
  repairs: RepairAction[];
  success: boolean;
}

export interface RepairAction {
  type: string;
  original: string;
  replacement: string;
  confidence: "high" | "medium" | "low";
}

export interface ExecutionResult {
  success: boolean;
  data?: import('./common').UnknownRecord;
  error?: string;
  validationResult?: ValidationResult;
  repairResult?: RepairResult;
  regenerationAttempts?: number;
  finalQuery?: string;
  executionTime?: number;
}

export type SqlRegenerator = (args: {
  prompt: string;
  userQuestion?: string;
  previousAttempts?: string[];
  validationErrors?: ValidationError[];
}) => Promise<string | null | undefined>;

export interface ToolCall {
  name: string;
  args: import('./common').UnknownRecord;
  id: string;
}
