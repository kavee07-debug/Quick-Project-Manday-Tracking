namespace Qtm.Api.Data.Entities;

/// <summary>Single-row (Id = 1) defaults applied when creating a new meeting. Maps to dbo.MeetingSetting.</summary>
public class MeetingSetting
{
    public int Id { get; set; }                            // fixed = 1
    public string? DefaultAgenda { get; set; }             // one item per line
    public string? DefaultAttendees { get; set; }          // one per line, e.g. "ชื่อ (PM)"
    public string? DefaultPreparedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
