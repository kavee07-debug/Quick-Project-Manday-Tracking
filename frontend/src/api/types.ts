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

export const PROJECT_TYPES = ['Implement', 'Customize', 'Training', 'Internal', 'MA', 'Other'] as const;
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
  timesheetMapping?: string | null; // D365 timesheet map key(s) "JobNo,TaskNo" (default = code)
  trainingDate?: string | null; // free text; appended to name (purple) when type = Training
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

// ---- Meeting Record (weekly project-status meeting) ----
export interface MeetingRecord {
  meetingId: number;
  meetingDate: string;   // yyyy-MM-dd
  topic: string;
  notes?: string | null;
  agenda?: string | null;              // one item per line
  attendees?: string | null;           // one per line, e.g. "ชื่อ (PM)"
  preparedBy?: string | null;          // ผู้บันทึกการประชุม
  certifiedBy?: string | null;         // ผู้รับรองการประชุม
  nextMeetingDate?: string | null;     // yyyy-MM-dd
  nextMeetingPreparedBy?: string | null;
  otherTopics?: string | null;         // "สรุปการประชุมอื่นๆ" — one topic per line
  isClosed: boolean;
  closedAt?: string | null;
  closedBy?: string | null;
  lineCount: number;     // read-only
  createdAt: string;
}
export type MeetingRecordUpsert = Pick<
  MeetingRecord,
  'meetingDate' | 'topic' | 'notes' | 'agenda' | 'attendees' | 'preparedBy' | 'certifiedBy'
  | 'nextMeetingDate' | 'nextMeetingPreparedBy' | 'otherTopics'
>;

export interface MeetingLine {
  meetingLineId: number;
  meetingId: number;
  projectId: number;
  projectCode: string;      // read-only (joined from Project)
  projectName: string;      // read-only (joined from Project)
  projectType?: string | null;
  customerCode?: string | null;   // read-only (joined from Project → Customer)
  customerName?: string | null;
  statusSnapshot?: string | null;
  progressSnapshot?: number | null;
  updateDetail?: string | null;
  nextAction?: string | null;
  sortOrder: number;
}
// Batch inline-save payload for a line's editable fields.
export type MeetingLineEdit = Pick<MeetingLine, 'meetingLineId' | 'updateDetail' | 'nextAction' | 'sortOrder'>;

// Defaults prefilled into a new meeting (managed on the list page's "ตั้งค่า Default").
export interface MeetingSetting {
  defaultAgenda?: string | null;
  defaultAttendees?: string | null;
  defaultPreparedBy?: string | null;
}

export const RESOURCE_POSITIONS = ['Dev', 'SA', 'PM'] as const;

export interface Resource {
  resourceId: number;
  code: string;
  name: string;
  position?: string | null;
  isActive: boolean;
  /** Counts toward the Billing KPI — a column of the Billing Manday Allocate matrix. */
  isBillingKpi: boolean;
}

// isBillingKpi has its own endpoint (PUT /resources/{id}/billing-kpi), so the edit form can't clear it.
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
  /** True when the host owns the connection (Azure App Service config) — the page is view-only. */
  isReadOnly: boolean;
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
  jobDescription?: string | null;
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

/** Same New Job / New Task applied to several staged timesheet rows at once. */
export interface D365TimesheetBulkUpsert {
  ids: number[];
  newJobNo?: string | null;
  newTaskNo?: string | null;
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

export interface D365TimesheetAutoMapResult {
  mapped: number;
  unmatched: number;
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

// Un-aggregated manday rows behind a pivot number (the "explain" drill-down).
export interface BreakdownRow {
  position: string;
  projectCode: string;
  projectName: string;
  taskName: string;
  taskDescription?: string | null;
  entryType: string;
  manday: number;
  resourceName?: string | null;
  note?: string | null;
}
export interface MandayBreakdownRow extends BreakdownRow { projectId: number; }
export interface ResourceBreakdownRow extends BreakdownRow { resourceId: number; }

// ---- Resource Timeline (predictive per-resource schedule) ----
export interface ResourceTimelineBlock {
  projectCode: string;
  projectName: string;
  isZ: boolean;
  taskName: string;
  taskDescription?: string | null;
  remainingManday: number;
  workingDays: number;
  startDate: string;   // yyyy-MM-dd
  endDate: string;     // yyyy-MM-dd
}
export interface ResourceTimelineRow {
  resourceId: number;
  code: string;
  name: string;
  position: string;
  totalRemaining: number;
  firstStart?: string | null;
  lastEnd?: string | null;
  blocks: ResourceTimelineBlock[];
}

// ---- Revenue Monthly ----
export interface RevenueMonth {
  revenueMonthId: number;
  periodYear: number;
  periodMonth: number;
  note?: string | null;
  prevFileName?: string | null;
  prevReportInfo?: string | null;
  prevImportedAt?: string | null;
  prevJobCount: number;
  currFileName?: string | null;
  currReportInfo?: string | null;
  currImportedAt?: string | null;
  currJobCount: number;
  // Confirmed = the month is closed: figures final, period read-only. Until then it is "Est Revenue".
  isConfirmed: boolean;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  targetAmount?: number | null;   // revenue the month is aiming at
  jobCount: number;
  totalAmountStd: number;
  totalAmountAct: number;
}
export interface RevenueMonthCreate {
  periodYear: number;
  periodMonth: number;
  note?: string | null;
  targetAmount?: number | null;
}
/** Single-row defaults applied when creating a period. */
export interface RevenueMonthSetting {
  defaultTargetAmount?: number | null;
}
/** Status of a job across the two snapshots. */
export type RevenueLineStatus = 'New' | 'Gone' | 'Normal' | 'Manual';
export interface RevenueMonthLine {
  jobNo: string;
  jobName?: string | null;
  customer?: string | null;
  pm?: string | null;
  stdGroup?: string | null;
  stage?: string | null;
  revenue?: number | null;      // project value used as the base (current month wins)
  prevRevenue?: number | null;
  revenueChanged: boolean;
  prevStd: number; currStd: number; deltaStd: number; amountStd: number;
  prevAct: number; currAct: number; deltaAct: number; amountAct: number;
  status: RevenueLineStatus;
  mergedRowCount: number;
  // Manual correction of this month's %: flags plus the imported value it replaced.
  editedStd: boolean;
  editedAct: boolean;
  importedStd?: number | null;
  importedAct?: number | null;
  overrideAt?: string | null;
  overrideBy?: string | null;
  // Typed in by hand rather than imported (status = 'Manual').
  isManual: boolean;
  manualLineId?: number | null;
  note?: string | null;
}
/** Add/edit a hand-keyed job. `amount`, when given, wins over the figure derived from the two %. */
export interface RevenueMonthManualUpsert {
  jobNo: string;
  jobName?: string | null;
  customer?: string | null;
  revenue?: number | null;
  prevProgress?: number | null;
  currProgress?: number | null;
  amount?: number | null;
  note?: string | null;
}
/** Sets (or with value = null clears) the manual override of this month's % for one job. */
export interface RevenueMonthOverrideRequest {
  jobNo: string;
  basis: 'std' | 'act';
  value: number | null;
}
export interface RevenueMonthDetail {
  month: RevenueMonth;
  lines: RevenueMonthLine[];
}
/** One closed period feeding the estimate, with the weight it carried. */
export interface RevenueMonthEstimateSource {
  periodYear: number;
  periodMonth: number;
  amountStd: number;
  amountAct: number;
  weight: number;
}
/** Forecast for a period whose current-month snapshot has not been imported yet. */
export interface RevenueMonthEstimate {
  rawStd: number; rawAct: number;                       // weighted average of the past months
  remainingStd?: number | null;                         // ceiling from the previous-month snapshot
  remainingAct?: number | null;
  estimateStd: number; estimateAct: number;             // raw, capped by the ceiling
  cappedStd: boolean; cappedAct: boolean;
  sources: RevenueMonthEstimateSource[];
}
/** One kept version of a period. Immutable once written. */
export interface RevenueMonthArchive {
  versionNo: number;
  archivedAt: string;
  archivedBy?: string | null;
  reason?: string | null;
  isAuto: boolean;                                      // taken automatically on Confirm
  jobCount: number;
  totalStd?: number | null;
  totalAct?: number | null;
  targetAmount?: number | null;
  wasConfirmed: boolean;
}
/** A kept version plus the period exactly as it read when it was kept. */
export interface RevenueMonthArchiveDetail {
  version: RevenueMonthArchive;
  data: RevenueMonthDetail;
}

/** One imported BC Posted Sales Invoice line (Billing Manday Allocate). */
export interface BillingLine {
  id: number;
  documentNo: string;
  lineSeq: number;
  postingDate?: string | null;                          // yyyy-MM-dd
  customerNo?: string | null;
  customerName?: string | null;
  customerSearchName?: string | null;
  lineType: string;                                     // Item | Resource
  itemNo?: string | null;
  itemCategoryCode?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitOfMeasure?: string | null;
  unitPrice?: number | null;
  lineAmount?: number | null;
  projectNo?: string | null;
  projectTaskNo?: string | null;
  jobName?: string | null;                              // from Project master / D365 job staging
  projectManager?: string | null;                       // BC qerpProjectManager (D365 job staging)
  isConfirmed: boolean;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  /** ResourceId -> Quantity for the allocation matrix; only on the Allocate screen. */
  allocations?: Record<string, number> | null;
  /** Allocation finished and locked — cells read-only, can't be un-confirmed until unlocked. */
  isAllocLocked: boolean;
  allocLockedAt?: string | null;
  allocLockedBy?: string | null;
  /** Baht per manday for the posting year; null = that year has no rate yet. */
  mandayRate?: number | null;
  /** ROUND(lineAmount / mandayRate, 3) — what the allocation has to add up to. */
  billingManday?: number | null;
  /** Manday allocated outside the resource master (another department…), and who it is for. */
  otherQuantity?: number | null;
  otherNote?: string | null;
}
export interface BillingOtherResult { quantity?: number | null; note?: string | null; }
export interface BillingBulkAllocateResult { updated: number; skipped: number; }
export interface BillingLockResult { updated: number; skipped: number; }
/** One year's billing manday rate (baht per manday). */
export interface BillingRate {
  year: number; rate: number; updatedAt: string; updatedBy?: string | null;
  lines: number; lockedLines: number;
}
export interface BillingRateSaveResult { rate: BillingRate; rescaledLines: number; }
/** A Billing-KPI resource = one column of the allocation matrix (ordered SA, Dev, PM). */
export interface BillingResource { resourceId: number; code: string; name: string; position?: string | null; }
export interface BillingAllocationResult { lineId: number; resourceId: number; quantity?: number | null; }
/** Billing KPI Manday — allocated manday per resource per posting year (keys are years). */
export interface BillingKpiRow {
  resourceId: number; code: string; name: string; position?: string | null;
  isBillingKpi: boolean;                                // false = un-ticked but still has allocations
  byYear: Record<string, number>;
  total: number;
}
export interface BillingKpi {
  years: number[];
  rows: BillingKpiRow[];
  allocatedByYear: Record<string, number>;
  mandayByYear: Record<string, number>;                 // confirmed lines' Billing Manday, for cross-check
  missingRateYears: number[];                           // confirmed lines but no rate set up
  otherByYear: Record<string, number>;                  // outside the resource master; inside allocatedByYear
  rateByYear: Record<string, number>;                   // standard manday rate, shown under each year header
  amountByYear: Record<string, number>;                 // Total Amount: confirmed lines' Line Amount
}
export interface BillingYear { year: number; lines: number; }
export interface BillingImportResult {
  imported: number;
  documents: number;
  /** Already in the system (pending, confirmed or deleted) — posted invoices are never re-imported. */
  skippedExistingDocuments: number;
  skippedBlankType: number;
}
export interface BillingDeleteResult { deleted: number; skippedConfirmed: number; }
export interface BillingConfirmResult { updated: number; }
/** The local copy of BC job names / PMs used to label invoice lines. */
export interface BillingJobCache { jobs: number; fetchedAt?: string | null; }
export interface BillingJobSyncResult { jobs: number; withName: number; withPm: number; fetchedAt: string; }

export interface TaskSummary {
  taskId: number;
  taskName: string;
  totalBudget: number;
  totalActual: number;
  totalAdjust: number;
  remaining: number; // (Budget + Adjust) - Actual
}
