namespace Qtm.Api.Dtos;

// ---- Auth ----
public record LoginRequest(string Email, string Password);
public record AuthResult(string Token, string Email, string DisplayName, string[] Roles, DateTime ExpiresAt);

// ---- Project ----
public record ProjectDto(int ProjectId, string Code, string Name, string? Description, string? Type, string Status,
    decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate,
    decimal TotalBudget, decimal TotalAdjust, decimal TotalActual, decimal Remaining);
public record ProjectUpsert(string Code, string Name, string? Description, string? Type, string Status,
    decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate);

// ---- Task ----
public record TaskDto(int TaskId, int ProjectId, string Name, string? Description, string Status, int SortOrder);
public record TaskUpsert(string Name, string? Description, string Status, int SortOrder);

// ---- Manday ----
public record MandayEntryDto(int MandayEntryId, int TaskId, string EntryType, int? ResourceId,
    string? ResourceName, string? ResourcePosition, decimal Manday, DateOnly? EntryDate, string? Note);
public record MandayUpsert(string EntryType, int? ResourceId, decimal Manday, DateOnly? EntryDate, string? Note);

// ---- Resource ----
public record ResourceDto(int ResourceId, string Code, string Name, string? Position, bool IsActive);
public record ResourceUpsert(string Code, string Name, string? Position, bool IsActive);

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

// ---- Manday Summary (pivot: project × resource position) ----
public record MandaySummaryCell(string Position, decimal BudgetAdjust, decimal Actual, decimal Remaining);
public record MandaySummaryRow(int ProjectId, string Code, string Name, string Status, MandaySummaryCell[] Cells);
public record ResourceMandaySummaryRow(int ResourceId, string Code, string Name, MandaySummaryCell[] Cells);
