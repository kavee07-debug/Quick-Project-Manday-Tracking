namespace Qtm.Api.Data.Entities;

/// <summary>Top-level project. Maps to dbo.Project.</summary>
public class Project
{
    public int ProjectId { get; set; }
    public string Code { get; set; } = string.Empty;       // business key e.g. SOJ0001
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Type { get; set; }                      // Implement | Customize | Training | Other
    public string Status { get; set; } = "Open";           // Open | Hold | Completed | Cancel
    public decimal? Revenue { get; set; }                  // project value / revenue
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<TaskItem> Tasks { get; set; } = new List<TaskItem>();
}
