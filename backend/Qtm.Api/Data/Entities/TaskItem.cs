namespace Qtm.Api.Data.Entities;

/// <summary>A task under a project. Maps to dbo.Task (named TaskItem to avoid clashing with System.Threading.Tasks.Task).</summary>
public class TaskItem
{
    public int TaskId { get; set; }
    public int ProjectId { get; set; }
    public string Name { get; set; } = string.Empty;       // e.g. Planning
    public string? Description { get; set; }
    public string? ItemCategoryCode { get; set; }          // from D365 (IMPLEMENT/CUSTOMIZE/…)
    public decimal? Revenue { get; set; }                  // from D365 (per-task revenue)
    public string Status { get; set; } = "Open";
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public Project? Project { get; set; }
    public ICollection<MandayEntry> MandayEntries { get; set; } = new List<MandayEntry>();
}
