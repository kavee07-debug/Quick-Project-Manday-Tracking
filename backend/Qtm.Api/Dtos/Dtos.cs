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
    decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate,
    decimal TotalBudget, decimal TotalAdjust, decimal TotalActual, decimal Remaining);
public record ProjectUpsert(string Code, string Name, string? Description, int? CustomerId,
    string? Type, string Status, decimal? Progress,
    decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate);

// ---- Task ----
public record TaskDto(int TaskId, int ProjectId, string Name, string? Description, string? ItemCategoryCode, decimal? Revenue, string Status, int SortOrder);
public record TaskUpsert(string Name, string? Description, string Status, int SortOrder);

// ---- Manday ----
public record MandayEntryDto(int MandayEntryId, int TaskId, string EntryType, int? ResourceId,
    string? ResourceName, string? ResourcePosition, decimal Manday, DateOnly? EntryDate,
    DateOnly? StartDate, DateOnly? EndDate, string? Note);
public record MandayUpsert(string EntryType, int? ResourceId, decimal Manday, DateOnly? EntryDate,
    DateOnly? StartDate, DateOnly? EndDate, string? Note);

// ---- User management (Admin) ----
public record UserDto(int UserId, string Email, string DisplayName, bool IsActive, string[] Roles);
public record UserUpsert(string Email, string DisplayName, bool IsActive, string[] Roles);

// ---- Resource ----
public record ResourceDto(int ResourceId, string Code, string Name, string? Position, bool IsActive);
public record ResourceUpsert(string Code, string Name, string? Position, bool IsActive);

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
public record DbConfigDto(string Server, string Database, bool IntegratedSecurity, string? Username,
    bool HasPassword, bool TrustServerCertificate, bool Encrypt);
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
public record D365TimesheetRow(int Id, string SystemId, string? JobNo, string? JobTaskNo,
    DateOnly? TimesheetDate, string? ResourceNo, string? ResourceName, decimal? QuantityHour, decimal? QuantityMD,
    string? Comment, string? ProjectManager, string? TimesheetStatus,
    string? NewJobNo, string? NewTaskNo, string ValidateStatus, string ValidateNewStatus, bool AlreadyInActual);
public record D365TimesheetUpsert(string? NewJobNo, string? NewTaskNo);
public record D365TimesheetFetchRequest(DateOnly StartDate, DateOnly EndDate);
public record D365TimesheetFetchResult(int Fetched, int Inserted, int Updated, string Year, List<string> Errors);
public record D365ApplyResult(int Applied, int Skipped, List<string> Errors);

// ---- Manday Summary (pivot: project × resource position) ----
public record MandaySummaryCell(string Position, decimal BudgetAdjust, decimal Actual, decimal Remaining);
public record MandaySummaryRow(int ProjectId, string Code, string Name, string Status, MandaySummaryCell[] Cells);
public record ResourceMandaySummaryRow(int ResourceId, string Code, string Name, MandaySummaryCell[] Cells);
