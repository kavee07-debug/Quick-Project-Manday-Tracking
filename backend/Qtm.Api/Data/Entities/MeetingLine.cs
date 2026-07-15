namespace Qtm.Api.Data.Entities;

/// <summary>One project line under a meeting, with a status snapshot + free-text notes. Maps to dbo.MeetingLine.</summary>
public class MeetingLine
{
    public int MeetingLineId { get; set; }
    public int MeetingId { get; set; }                     // FK -> MeetingRecord
    public int ProjectId { get; set; }                     // lookup FK -> Project
    public string? StatusSnapshot { get; set; }            // project Status frozen at load time
    public decimal? ProgressSnapshot { get; set; }         // project Progress frozen at load time
    public string? UpdateDetail { get; set; }              // what was discussed this week
    public string? NextAction { get; set; }                // follow-up
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public MeetingRecord? Meeting { get; set; }
    public Project? Project { get; set; }
}
