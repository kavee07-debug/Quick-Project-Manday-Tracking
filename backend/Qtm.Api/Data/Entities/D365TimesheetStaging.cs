namespace Qtm.Api.Data.Entities;

/// <summary>
/// A timesheet line pulled from D365BC for review before being applied as an Actual manday.
/// SystemId (BC systemId) is the upsert/dedup key. Maps to dbo.D365TimesheetStaging.
/// </summary>
public class D365TimesheetStaging
{
    public int TimesheetStagingId { get; set; }
    public string SystemId { get; set; } = string.Empty;   // BC systemId (upsert key)
    public string? JobNo { get; set; }
    public string? JobTaskNo { get; set; }
    public DateOnly? TimesheetDate { get; set; }            // API startDate
    public string? ResourceNo { get; set; }                // API "no" (resource code)
    public decimal? QuantityHour { get; set; }             // API quantity
    public decimal? QuantityMD { get; set; }               // API quantityMD
    public string? Comment { get; set; }
    public string? ProjectManager { get; set; }
    public string? TimesheetStatus { get; set; }
    public string? NewJobNo { get; set; }                  // default = JobNo, editable (→ Project.Code)
    public string? NewTaskNo { get; set; }                 // default = JobTaskNo, editable (→ Task.Name)
    public string? RawJson { get; set; }
    public DateTime FetchedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
