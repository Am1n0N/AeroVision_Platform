// types/ui.ts
// UI component and form-related type definitions

import * as React from "react";

// Toast-related types
export interface ToastProps {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "default" | "destructive";
}

export type ToastActionElement = React.ReactElement<import('./common').UnknownRecord>;

export interface ToasterToast extends ToastProps {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
}

export interface ToastState {
  toasts: ToasterToast[];
}

// Form and input types
export interface FormFieldProps {
  name: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Hook-related types
export interface UseChatOptions {
  onError?: (error: Error) => void;
  onSessionCreated?: (sessionId: string) => void;
}

export interface UseModalStateResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

// Component prop types
export interface ChatInterfaceProps {
  chat: import('./chat').SessionDetail;
  settings: import('./chat').UserSettings;
}

export interface SettingsPanelProps {
  settings: import('./chat').UserSettings;
}

// Model and configuration types for UI
export interface ModelOption {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  contextWindow?: number;
}

// Button variant types
export type ButtonVariant = 
  | "default" 
  | "destructive" 
  | "outline" 
  | "secondary" 
  | "ghost" 
  | "link";

export type ButtonSize = "default" | "sm" | "lg" | "icon";

// Component state types
export interface ComponentState<T = unknown> {
  isLoading: boolean;
  error: string | null;
  data: T;
}

// Utility types for forms and validation
export interface ValidationState {
  isValid: boolean;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
}

// File upload types
export interface FileUploadState {
  file: File | null;
  progress: number;
  isUploading: boolean;
  error: string | null;
  url: string | null;
}

// Theme types
export type Theme = "light" | "dark" | "system";

// Modal and dialog types
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export interface DialogProps extends ModalProps {
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
}
