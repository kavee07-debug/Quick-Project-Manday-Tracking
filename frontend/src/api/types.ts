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

export interface Customer {
  customerId: number;
  code: string;
  name: string;
  isActive: boolean;
}
export type CustomerUpsert = Pick<Customer, 'code' | 'name' | 'isActive'>;

export interface Project {
  projectId: number;
  code: string;
  name: string;
  description?: string | null;
  customerId?: number | null;
  customerCode?: string | null; // read-only (joined from Customer)
  customerName?: string | null; // read-only (joined from Customer)
  type?: string | null;
  status: string;
  progress?: number | null; // completion %, e.g. 70.01 (0..100)
  revenue?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  // Manday rollups (read-only): Remaining = (totalBudget + totalAdjust) - totalActual
  totalBudget: number;
  totalAdjust: number;
  totalActual: number;
  remaining: number;
}

// Upsert excludes id, joined customer fields, and the read-only rollups.
export type ProjectUpsert = Omit<
  Project,
  | 'projectId'
  | 'customerCode'
  | 'customerName'
  | 'totalBudget'
  | 'totalAdjust'
  | 'totalActual'
  | 'remaining'
>;

export interface TaskItem {
  taskId: number;
  projectId: number;
  name: string;
  description?: string | null;
  itemCategoryCode?: string | null;
  revenue?: number | null;
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

// ---- Master Item (synced from D365BC) ----
export interface MasterItem {
  itemId: number;
  number: string;
  displayName: string;
  itemCategoryCode?: string | null;
  updatedAt?: string | null;
}

export interface MasterItemFetchResult {
  fetched: number;
  inserted: number;
  updated: number;
  errors: string[];
}

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

// ---- D365BC integration ----
export interface D365Setting {
  tenantId: string;
  environmentId: string;
  companyId: string;
  clientId: string;
  hasClientSecret: boolean;
  apiPublisher: string;
  apiGroup: string;
  apiVersion: string;
  projectManagerCodes: string;
}

export interface D365SettingUpsert {
  tenantId: string;
  environmentId: string;
  companyId: string;
  clientId: string;
  clientSecret?: string | null; // blank keeps the stored secret
  apiPublisher: string;
  apiGroup: string;
  apiVersion: string;
  projectManagerCodes: string;
}

export interface D365TestResult {
  success: boolean;
  message: string;
}

export interface D365TaskStagingRow {
  taskStagingId: number;
  taskNo: string;
  taskDescription?: string | null;
  itemCategoryCode?: string | null;
  revenue?: number | null;
}

export interface D365StagingRow {
  stagingId: number;
  jobNo: string;
  projectName?: string | null;
  projectManagerCode?: string | null;
  customerNo?: string | null;
  customerName?: string | null;
  type?: string | null;
  revenue?: number | null;
  fetchedAt: string;
  alreadyExists: boolean;
  existingProjectId?: number | null;
  tasks: D365TaskStagingRow[];
}

export interface D365FetchResult {
  fetched: number;
  inserted: number;
  updated: number;
  maxCodeUsed: string;
  errors: string[];
}

export interface CreateProjectsResult {
  created: number;
  skipped: number;
  errors: string[];
}

// ---- D365BC Timesheet staging ----
export type TimesheetValidateStatus = 'OK' | 'NoJob' | 'NoTask';

export interface D365TimesheetRow {
  id: number;
  systemId: string;
  jobNo?: string | null;
  jobTaskNo?: string | null;
  timesheetDate?: string | null;
  resourceNo?: string | null;
  resourceName?: string | null;
  quantityHour?: number | null;
  quantityMD?: number | null;
  comment?: string | null;
  projectManager?: string | null;
  timesheetStatus?: string | null;
  newJobNo?: string | null;
  newTaskNo?: string | null;
  validateStatus: TimesheetValidateStatus;
  validateNewStatus: TimesheetValidateStatus;
  alreadyInActual: boolean;
}

export interface D365TimesheetFetchResult {
  fetched: number;
  inserted: number;
  updated: number;
  year: string;
  errors: string[];
}

export interface D365ApplyResult {
  applied: number;
  skipped: number;
  errors: string[];
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
