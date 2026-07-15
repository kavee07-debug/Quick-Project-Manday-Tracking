namespace Qtm.Api.Data.Entities;

/// <summary>A weekly project-status meeting header. Maps to dbo.MeetingRecord.</summary>
public class MeetingRecord
{
    public int MeetingId { get; set; }
    public DateOnly MeetingDate { get; set; }
    public string Topic { get; set; } = string.Empty;
    public string? Notes { get; set; }                     // free notes for the meeting overall

    // Report header fields (mirror the "Minute of Meeting" document format).
    public string? Agenda { get; set; }                    // one item per line
    public string? Attendees { get; set; }                 // one per line, e.g. "ชื่อ (PM)"
    public string? PreparedBy { get; set; }                // ผู้บันทึกการประชุม
    public string? CertifiedBy { get; set; }               // ผู้รับรองการประชุม (signature block)
    public DateOnly? NextMeetingDate { get; set; }
    public string? NextMeetingPreparedBy { get; set; }
    public string? OtherTopics { get; set; }               // "สรุปการประชุมอื่นๆ" — one topic per line

    // Close/lock: once closed the record cannot be edited (until reopened).
    public bool IsClosed { get; set; }
    public DateTime? ClosedAt { get; set; }
    public string? ClosedBy { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<MeetingLine> Lines { get; set; } = new List<MeetingLine>();
}
