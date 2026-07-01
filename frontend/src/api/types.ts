export interface AuthResult {
  token: string;
  email: string;
  displayName: string;
  roles: string[];
  expiresAt: string;
}

// RBAC roles (must match backend Roles.All / dbo.[Role].Name).
export const ROLES = ['Admin', 'ProjectManager', 'User'] as const;
export type RoleName = (typeof ROLES)[number];

export interface User {
  userId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: string[];
}
export type UserUpsert = Pick<User, 'email' | 'displayName' | 'isActive' | 'roles'>;

export const PROJECT_TYPES = ['Implement', 'Customize', 'Training', 'Other'] as const;
export const PROJECT_STATUSES = ['Open', 'Hold', 'Completed', 'Cancel'] as const;

export interface Project {
  projectId: number;
  code: string;
  name: string;
  description?: string | null;
  type?: string | null;
  status: string;
  revenue?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  // Manday rollups (read-only): Remaining = (totalBudget + totalAdjust) - totalActual
  totalBudget: number;
  totalAdjust: number;
  totalActual: number;
  remaining: number;
}

// Upsert excludes id and the read-only rollups.
export type ProjectUpsert = Omit<
  Project,
  'projectId' | 'totalBudget' | 'totalAdjust' | 'totalActual' | 'remaining'
>;

export interface TaskItem {
  taskId: number;
  projectId: number;
  name: string;
  description?: string | null;
  status: string;
  sortOrder: number;
}

export type TaskUpsert = Pick<TaskItem, 'name' | 'description' | 'status' | 'sortOrder'>;

export type EntryType = 'Budget' | 'Actual' | 'Adjust';

export interface MandayEntry {
  mandayEntryId: number;
  taskId: number;
  entryType: EntryType;
  resourceId?: number | null;
  resourceName?: string | null;
  resourcePosition?: string | null;
  manday: number;
  entryDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
}

export type MandayUpsert = Pick<
  MandayEntry,
  'entryType' | 'resourceId' | 'manday' | 'entryDate' | 'startDate' | 'endDate' | 'note'
>;

export const RESOURCE_POSITIONS = ['Dev', 'SA', 'PM'] as const;

export interface Resource {
  resourceId: number;
  code: string;
  name: string;
  position?: string | null;
  isActive: boolean;
}

export type ResourceUpsert = Pick<Resource, 'code' | 'name' | 'position' | 'isActive'>;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface DbConfig {
  server: string;
  database: string;
  integratedSecurity: boolean;
  username?: string | null;
  hasPassword: boolean;
  trustServerCertificate: boolean;
  encrypt: boolean;
}

export interface DbConfigUpsert {
  server: string;
  database: string;
  integratedSecurity: boolean;
  username?: string | null;
  password?: string | null;
  trustServerCertificate: boolean;
  encrypt: boolean;
}

export interface DbTestResult {
  success: boolean;
  message?: string | null;
}

export interface MandaySummaryCell {
  position: string;
  budgetAdjust: number;
  actual: number;
  remaining: number;
}

export interface MandaySummaryRow {
  projectId: number;
  code: string;
  name: string;
  status: string;
  cells: MandaySummaryCell[];
}

export interface ResourceMandaySummaryRow {
  resourceId: number;
  code: string;
  name: string;
  cells: MandaySummaryCell[];
}

export interface TaskSummary {
  taskId: number;
  taskName: string;
  totalBudget: number;
  totalActual: number;
  totalAdjust: number;
  remaining: number; // (Budget + Adjust) - Actual
}
