namespace Qtm.Api.Data.Entities;

/// <summary>Top-level project. Maps to dbo.Project.</summary>
public class Project
{
    public int ProjectId { get; set; }
    public string Code { get; set; } = string.Empty;       // business key e.g. SOJ0001
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int? CustomerId { get; set; }                   // owning customer (nullable)
    public string? Type { get; set; }                      // Implement | Customize | Training | Other
    public string Status { get; set; } = "Open";           // Open | Hold | Completed | Cancel
    public decimal? Progress { get; set; }                 // completion %, e.g. 70.01 (0..100)
    public decimal? Revenue { get; set; }                  // project value / revenue
    // D365 timesheet mapping key(s): "JobNo,TaskNo" (default = Code). Used to auto-map timesheet
    // lines to this project. Multiple keys may be separated by ';' or newline.
    public string? TimesheetMapping { get; set; }
    // Free text; when Type = Training it is appended to the project name in the UI.
    public string? TrainingDate { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Customer? Customer { get; set; }
    public ICollection<TaskItem> Tasks { get; set; } = new List<TaskItem>();
}
