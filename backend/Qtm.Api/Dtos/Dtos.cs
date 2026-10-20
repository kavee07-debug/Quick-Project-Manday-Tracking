namespace Qtm.Api.Dtos;

// ---- Auth ----
public record LoginRequest(string Email, string Password);
public record AuthResult(string Token, string Email, string DisplayName, string[] Roles, DateTime ExpiresAt);

// ---- Customer ----
public record CustomerDto(int CustomerId, string Code, string Name, bool IsActive);
public record CustomerUpsert(string Code, string Name, bool IsActive);

// ---- Project ----
public record ProjectDto(int ProjectId, string Code, string Name, string? Description,
    int? CustomerId, string? CustomerCode, string? CustomerName,
    string? Type, string Status, decimal? Progress,
    decimal? Revenue, string? TimesheetMapping, string? TrainingDate, DateOnly? StartDate, DateOnly? EndDate,
    decimal TotalBudget, decimal TotalAdjust, decimal TotalActual, decimal Remaining,
    decimal TotalBilling = 0);   // sum of the Billing estimate on the project's Budget rows
public record ProjectUpsert(string Code, string Name, string? Description, int? CustomerId,
    string? Type, string Status, decimal? Progress,
    decimal? Revenue, string? TimesheetMapping, string? TrainingDate, DateOnly? StartDate, DateOnly? EndDate);

// ---- Task ----
public record TaskDto(int TaskId, int ProjectId, string Name, string? Description, string? ItemCategoryCode, decimal? Revenue, string Status, int SortOrder);
public record TaskUpsert(string Name, string? Description, string Status, int SortOrder);

// ---- Manday ----
public record MandayEntryDto(int MandayEntryId, int TaskId, string EntryType, int? ResourceId,
    string? ResourceName, string? ResourcePosition, decimal Manday, DateOnly? EntryDate,
    DateOnly? StartDate, DateOnly? EndDate, string? Note, decimal? BillingManday);
// BillingManday: Budget rows only (estimated manday to be billed, up to 3 decimals); ignored otherwise.
public record MandayUpsert(string EntryType, int? ResourceId, decimal Manday, DateOnly? EntryDate,
    DateOnly? StartDate, DateOnly? EndDate, string? Note, decimal? BillingManday = null);

// ---- Meeting Record (weekly project-status meeting) ----
public record MeetingRecordDto(int MeetingId, DateOnly MeetingDate, string Topic, string? Notes,
    string? Agenda, string? Attendees, string? PreparedBy, string? CertifiedBy,
    DateOnly? NextMeetingDate, string? NextMeetingPreparedBy, string? OtherTopics,
    bool IsClosed, DateTime? ClosedAt, string? ClosedBy,
    int LineCount, DateTime CreatedAt);
public record MeetingRecordUpsert(DateOnly MeetingDate, string Topic, string? Notes,
    string? Agenda, string? Attendees, string? PreparedBy, string? CertifiedBy,
    DateOnly? NextMeetingDate, string? NextMeetingPreparedBy, string? OtherTopics);
public record MeetingLineDto(int MeetingLineId, int MeetingId, int ProjectId,
    string ProjectCode, string ProjectName, string? ProjectType, string? CustomerCode, string? CustomerName,
    string? StatusSnapshot, decimal? ProgressSnapshot, string? UpdateDetail, string? NextAction, int SortOrder);
public record MeetingLineAdd(int ProjectId);
public record MeetingLoadProjects(string[]? Statuses);
public record MeetingLineEdit(int MeetingLineId, string? UpdateDetail, string? NextAction, int SortOrder);
public record MeetingSettingDto(string? DefaultAgenda, string? DefaultAttendees, string? DefaultPreparedBy);

// ---- Summary breakdown (explain: which Job + Task rows make up a pivot number) ----
public record MandayBreakdownRow(int ProjectId, string Position, string ProjectCode, string ProjectName,
    string TaskName, string? TaskDescription, string EntryType, decimal Manday, string? ResourceName, string? Note);
public record ResourceBreakdownRow(int ResourceId, string Position, string ProjectCode, string ProjectName,
    string TaskName, string? TaskDescription, string EntryType, decimal Manday, string? Note);

// ---- Resource Timeline (predictive per-resource schedule of remaining budgeted work) ----
public record ResourceTimelineBlock(string ProjectCode, string ProjectName, bool IsZ, string TaskName,
    string? TaskDescription, decimal RemainingManday, int WorkingDays, DateOnly StartDate, DateOnly EndDate);
public record ResourceTimelineRow(int ResourceId, string Code, string Name, string Position,
    decimal TotalRemaining, DateOnly? FirstStart, DateOnly? LastEnd, ResourceTimelineBlock[] Blocks);

// ---- Revenue Monthly (recognise revenue from the month-over-month progress delta) ----
public record RevenueMonthDto(int RevenueMonthId, int PeriodYear, int PeriodMonth, string? Note,
    string? PrevFileName, string? PrevReportInfo, DateTime? PrevImportedAt, int PrevJobCount,
    string? CurrFileName, string? CurrReportInfo, DateTime? CurrImportedAt, int CurrJobCount,
    bool IsConfirmed, DateTime? ConfirmedAt, string? ConfirmedBy, decimal? TargetAmount,
    int JobCount, decimal TotalAmountStd, decimal TotalAmountAct);
public record RevenueMonthCreate(int PeriodYear, int PeriodMonth, string? Note, decimal? TargetAmount);
// Single-row defaults applied when creating a period.
public record RevenueMonthSettingDto(decimal? DefaultTargetAmount);
public record RevenueMonthLineDto(string JobNo, string? JobName, string? Customer, string? Pm,
    string? StdGroup, string? Stage, decimal? Revenue, decimal? PrevRevenue, bool RevenueChanged,
    decimal PrevStd, decimal CurrStd, decimal DeltaStd, decimal AmountStd,
    decimal PrevAct, decimal CurrAct, decimal DeltaAct, decimal AmountAct,
    string Status, int MergedRowCount,
    // Manual correction of this month's %: flags plus the imported value it replaced.
    bool EditedStd, bool EditedAct, decimal? ImportedStd, decimal? ImportedAct,
    DateTime? OverrideAt, string? OverrideBy,
    // Typed in by hand rather than imported (Status = "Manual").
    bool IsManual, int? ManualLineId, string? Note);
// Add/edit a hand-keyed job. Amount, when given, wins over the figure derived from the two %.
public record RevenueMonthManualUpsert(string JobNo, string? JobName, string? Customer,
    decimal? Revenue, decimal? PrevProgress, decimal? CurrProgress, decimal? Amount, string? Note);
// Revenue the month is aiming at; null clears it.
public record RevenueMonthTargetRequest(decimal? Amount);
// Sets (or with a null Value clears) the manual override of this month's % for one job.
public record RevenueMonthOverrideRequest(string JobNo, string Basis, decimal? Value);
public record RevenueMonthDetailDto(RevenueMonthDto Month, RevenueMonthLineDto[] Lines);
// One completed period feeding the estimate, with the weight it carried.
public record RevenueMonthEstimateSource(int PeriodYear, int PeriodMonth, decimal AmountStd, decimal AmountAct, int Weight);
// Forecast for a period whose current-month snapshot has not been imported yet.
public record RevenueMonthEstimateDto(
    decimal RawStd, decimal RawAct,                 // weighted average of the past months
    decimal? RemainingStd, decimal? RemainingAct,   // ceiling: revenue still unrecognised at the start of the month
    decimal EstimateStd, decimal EstimateAct,       // Raw, capped by the ceiling when one is known
    bool CappedStd, bool CappedAct,
    RevenueMonthEstimateSource[] Sources);

// One kept version of a period. Totals are denormalised so the list renders without
// deserialising the frozen payload.
public record RevenueMonthArchiveDto(int VersionNo, DateTime ArchivedAt, string? ArchivedBy,
    string? Reason, bool IsAuto, int JobCount, decimal? TotalStd, decimal? TotalAct,
    decimal? TargetAmount, bool WasConfirmed);
// A kept version plus the period exactly as it read when it was kept. Read-only by design:
// Data is replayed from storage, never recomputed.
public record RevenueMonthArchiveDetailDto(RevenueMonthArchiveDto Version, RevenueMonthDetailDto Data);
public record RevenueMonthArchiveCreate(string? Reason);

// ---- Billing KPI ----
// One imported Posted Sales Invoice line. JobName / ProjectManager are resolved at read time from
// the Project master and the D365 job staging (the BC export itself only carries Project No.).
public record BillingLineDto(int Id, string DocumentNo, int LineSeq, DateOnly? PostingDate,
    string? CustomerNo, string? CustomerName, string? CustomerSearchName,
    string LineType, string? ItemNo, string? ItemCategoryCode, string? Description,
    decimal? Quantity, string? UnitOfMeasure, decimal? UnitPrice, decimal? LineAmount,
    string? ProjectNo, string? ProjectTaskNo, string? JobName, string? ProjectManager,
    bool IsConfirmed, DateTime? ConfirmedAt, string? ConfirmedBy,
    Dictionary<int, decimal>? Allocations,    // ResourceId -> Quantity; only on the Allocate screen
    bool IsAllocLocked, DateTime? AllocLockedAt, string? AllocLockedBy,
    decimal? MandayRate,                      // rate of the posting year; null = not set up yet
    decimal? BillingManday,                   // ROUND(LineAmount / MandayRate, 3) — what allocation must add up to
    decimal? OtherQuantity, string? OtherNote);   // allocated outside the resource master
public record BillingOtherRequest(decimal? Quantity, string? Note);
// Auto Allocate: write one target (a resource's cell, or "Other") on many lines in one go.
// The screen works out each line's figure (formula / fixed / remaining); null or 0 clears the cell.
public record BillingBulkAllocateItem(int LineId, decimal? Quantity);
public record BillingBulkAllocateRequest(int? ResourceId, bool Other, BillingBulkAllocateItem[] Items);
public record BillingBulkAllocateResult(int Updated, int Skipped);
// Excel export of the Allocate screen: the filtered lines' ids in screen order, plus a short
// description of the filters for the sheet's header note.
public record BillingExportRequest(int[] Ids, string? FilterSummary);
// One year's billing manday rate (baht per manday).
public record BillingRateDto(int Year, decimal Rate, DateTime UpdatedAt, string? UpdatedBy, int Lines, int LockedLines);
public record BillingRateUpsert(decimal Rate);
// Saving a rate also rescales the allocations of that year's locked lines.
public record BillingRateSaveResult(BillingRateDto Rate, int RescaledLines);
// Lock/unlock: Skipped = selected lines that didn't qualify (not fully allocated / not confirmed).
public record BillingLockResult(int Updated, int Skipped);
// A Billing-KPI resource = one column of the allocation matrix.
public record BillingResourceDto(int ResourceId, string Code, string Name, string? Position);
public record BillingAllocationRequest(decimal? Quantity);   // null / 0 clears the cell
// Billing KPI Manday: allocated manday per resource per posting year (confirmed, live lines only).
// IsBillingKpi=false rows only appear when someone was un-ticked after work was allocated to them,
// so their manday never silently drops out of the totals.
public record BillingKpiRow(int ResourceId, string Code, string Name, string? Position, bool IsBillingKpi,
    Dictionary<int, decimal> ByYear, decimal Total,
    string? LevelCode, string? LevelName,
    Dictionary<int, decimal> TargetByYear);   // the level's target per year (years without one are absent)
// MandayByYear = sum of Billing Manday (Line Amount / rate) of confirmed lines — what allocation
// should add up to. MissingRateYears = years with confirmed lines but no rate set up yet.
// OtherByYear = manday allocated outside the resource master; already included in AllocatedByYear.
// RateByYear = the year's standard manday rate, shown under each year header (the rate list itself
// is Admin only, so the KPI carries what every role needs to see).
public record BillingKpiDto(int[] Years, BillingKpiRow[] Rows,
    Dictionary<int, decimal> AllocatedByYear, Dictionary<int, decimal> MandayByYear, int[] MissingRateYears,
    Dictionary<int, decimal> OtherByYear, Dictionary<int, decimal> RateByYear,
    Dictionary<int, decimal> AmountByYear);   // confirmed lines' Line Amount (Total Amount)
public record BillingAllocationResult(int LineId, int ResourceId, decimal? Quantity);
public record BillingYearDto(int Year, int Lines);
// SkippedExistingDocuments: documents already in the system (pending, confirmed or deleted) —
// posted invoices never change in BC, so they are not imported again.
public record BillingImportResult(int Imported, int Documents, int SkippedExistingDocuments,
    int SkippedBlankType);
public record BillingConfirmRequest(int[] Ids);
public record BillingDeleteResult(int Deleted, int SkippedConfirmed);
public record BillingConfirmResult(int Updated);
// Result of refreshing the local BC job cache (names + PMs) used to label invoice lines.
public record BillingJobSyncResult(int Jobs, int WithName, int WithPm, DateTime FetchedAt);
public record BillingJobCacheDto(int Jobs, DateTime? FetchedAt);

// ---- User management (Admin) ----
public record UserDto(int UserId, string Email, string DisplayName, bool IsActive, string[] Roles);
public record UserUpsert(string Email, string DisplayName, bool IsActive, string[] Roles);

// ---- Resource ----
public record ResourceDto(int ResourceId, string Code, string Name, string? Position, bool IsActive,
    bool IsBillingKpi, string? PositionLevelCode, string? PositionLevelName);
public record ResourceBillingKpiRequest(bool IsBillingKpi);
public record ResourceUpsert(string Code, string Name, string? Position, bool IsActive,
    string? PositionLevelCode = null);   // must be a level of Position; null = no level

// ---- Position Level master + Manday Target per level per year ----
// Targets: year -> target manday per person at this level. Resources: how many use the level.
public record PositionLevelDto(string Position, string Code, string Name, int Resources,
    Dictionary<int, decimal> Targets);
public record PositionLevelUpsert(string Position, string Code, string Name);
public record PositionLevelTargetRequest(decimal? TargetManday);   // null = clear the year's target

// ---- Master Item (synced from D365BC) ----
public record MasterItemDto(int ItemId, string Number, string DisplayName, string? ItemCategoryCode, DateTime? UpdatedAt);
public record MasterItemFetchResult(int Fetched, int Inserted, int Updated, List<string> Errors);

// ---- Summary ----
public record TaskSummaryDto(int TaskId, string TaskName, decimal TotalBudget, decimal TotalActual,
    decimal TotalAdjust, decimal Remaining);

// ---- Excel import ----
public record ImportResult(int Created, int Updated, int Skipped, List<string> Errors);

// ---- DB Config ----
// Password is never returned; HasPassword tells the UI whether one is already stored.
// IsReadOnly is true when the host owns the connection (Azure App Service configuration) —
// the UI then hides Save, and PUT is refused.
public record DbConfigDto(string Server, string Database, bool IntegratedSecurity, string? Username,
    bool HasPassword, bool TrustServerCertificate, bool Encrypt, bool IsReadOnly);
// On save/test: leave Password empty to keep the currently-stored one.
public record DbConfigUpsert(string Server, string Database, bool IntegratedSecurity, string? Username,
    string? Password, bool TrustServerCertificate, bool Encrypt);
public record DbTestResult(bool Success, string? Message);

// ---- D365BC integration ----
// ClientSecret is never returned; HasClientSecret tells the UI whether one is already stored.
public record D365SettingDto(string TenantId, string EnvironmentId, string CompanyId, string ClientId,
    bool HasClientSecret, string ApiPublisher, string ApiGroup, string ApiVersion, string ProjectManagerCodes);
// On save/test: leave ClientSecret empty to keep the currently-stored one.
public record D365SettingUpsert(string TenantId, string EnvironmentId, string CompanyId, string ClientId,
    string? ClientSecret, string ApiPublisher, string ApiGroup, string ApiVersion, string ProjectManagerCodes);
public record D365TestResult(bool Success, string Message);
public record D365StagingDto(int StagingId, string JobNo, string? ProjectName, string? ProjectManagerCode,
    string? CustomerNo, string? CustomerName, string? Type, decimal? Revenue,
    DateTime FetchedAt, bool AlreadyExists, int? ExistingProjectId, List<D365TaskStagingDto> Tasks);
public record D365TaskStagingDto(int TaskStagingId, string TaskNo, string? TaskDescription, string? ItemCategoryCode, decimal? Revenue);
public record D365StagingUpsert(string JobNo, string? ProjectName, string? CustomerNo, string? CustomerName,
    string? Type, decimal? Revenue);
public record D365FetchResult(int Fetched, int Inserted, int Updated, string MaxCodeUsed, List<string> Errors);
public record CreateProjectsResult(int Created, int Skipped, List<string> Errors);
public record StagingIdsRequest(int[] Ids);
public record FetchByJobRequest(string JobNo);

// ---- D365BC Timesheet staging ----
public record D365TimesheetRow(int Id, string SystemId, string? JobNo, string? JobDescription, string? JobTaskNo,
    DateOnly? TimesheetDate, string? ResourceNo, string? ResourceName, decimal? QuantityHour, decimal? QuantityMD,
    string? Comment, string? ProjectManager, string? TimesheetStatus,
    string? NewJobNo, string? NewTaskNo, string ValidateStatus, string ValidateNewStatus, bool AlreadyInActual);
public record D365TimesheetUpsert(string? NewJobNo, string? NewTaskNo);
// Same edit applied to several staged rows at once.
public record D365TimesheetBulkUpsert(int[] Ids, string? NewJobNo, string? NewTaskNo);
public record D365TimesheetFetchRequest(DateOnly StartDate, DateOnly EndDate);
public record D365TimesheetFetchResult(int Fetched, int Inserted, int Updated, string Year, List<string> Errors);
public record D365ApplyResult(int Applied, int Skipped, List<string> Errors);
// Auto-map result: how many staged rows got a New Job/Task from a project's TimesheetMapping.
public record D365TimesheetAutoMapResult(int Mapped, int Unmatched);

// ---- Manday Summary (pivot: project × resource position) ----
public record MandaySummaryCell(string Position, decimal BudgetAdjust, decimal Actual, decimal Remaining);
public record MandaySummaryRow(int ProjectId, string Code, string Name, string Status, MandaySummaryCell[] Cells);
public record ResourceMandaySummaryRow(int ResourceId, string Code, string Name, MandaySummaryCell[] Cells);
