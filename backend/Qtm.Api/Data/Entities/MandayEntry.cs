namespace Qtm.Api.Data.Entities;

/// <summary>Manday row under a task. EntryType is one of Budget | Actual | Adjust. Maps to dbo.MandayEntry.</summary>
public class MandayEntry
{
    public int MandayEntryId { get; set; }
    public int TaskId { get; set; }
    public string EntryType { get; set; } = string.Empty;  // Budget | Actual | Adjust
    public int? ResourceId { get; set; }                   // nullable: Adjust rows may not map to a person
    public decimal Manday { get; set; }                    // supports half-days e.g. 1.5
    public DateOnly? EntryDate { get; set; }
    public DateOnly? StartDate { get; set; }               // planned/actual start
    public DateOnly? EndDate { get; set; }                 // defaults to StartDate, editable
    public string? Note { get; set; }
    public string? SourceSystemId { get; set; }            // D365 timesheet systemId when applied from Timesheet screen
    public DateTime? AppliedAt { get; set; }               // when applied from a timesheet
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public TaskItem? Task { get; set; }
    public ResourceItem? Resource { get; set; }
}
