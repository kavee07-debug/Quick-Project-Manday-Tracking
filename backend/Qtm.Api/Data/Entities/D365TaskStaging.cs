namespace Qtm.Api.Data.Entities;

/// <summary>
/// A job task (Task No + Description) pulled from D365BC for a staged project. Removed with its
/// parent <see cref="D365ProjectStaging"/> (on promote or delete). Maps to dbo.D365TaskStaging.
/// </summary>
public class D365TaskStaging
{
    public int TaskStagingId { get; set; }
    public int StagingId { get; set; }                     // parent D365ProjectStaging
    public string JobNo { get; set; } = string.Empty;
    public string TaskNo { get; set; } = string.Empty;     // BC jobTaskNo -> Task.Name
    public string? TaskDescription { get; set; }           // BC description -> Task.Description
    public string? ItemCategoryCode { get; set; }          // derived from the task's planning-line item
    public decimal? Revenue { get; set; }                  // Σ Billable revenue-category lineAmountLCY for this task
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }

    public D365ProjectStaging? Staging { get; set; }
}
