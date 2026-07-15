using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// Meeting Record — weekly project-status meetings. A meeting header (date + topic) with
/// one line per project, capturing an Update Detail / Next Action and a status snapshot.
/// Accessible to Admin + ProjectManager. A closed meeting is locked from edits until reopened.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize(Roles = Roles.Managers)]
public class MeetingsController(QtmDbContext db) : ControllerBase
{
    private static readonly string[] DefaultLoadStatuses = ["Open", "Hold"];

    private static MeetingRecordDto ToDto(MeetingRecord m, int lineCount) =>
        new(m.MeetingId, m.MeetingDate, m.Topic, m.Notes,
            m.Agenda, m.Attendees, m.PreparedBy, m.CertifiedBy, m.NextMeetingDate, m.NextMeetingPreparedBy, m.OtherTopics,
            m.IsClosed, m.ClosedAt, m.ClosedBy,
            lineCount, m.CreatedAt);

    private string CurrentUser() =>
        User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue(ClaimTypes.Email) ?? "unknown";

    // 409 message used when an edit is attempted on a closed meeting.
    private static readonly object LockedError = new { message = "การประชุมถูกปิดแล้ว ไม่สามารถแก้ไขได้ (กด Reopen ก่อน)" };

    private static MeetingLineDto ToLineDto(MeetingLine l) =>
        new(l.MeetingLineId, l.MeetingId, l.ProjectId,
            l.Project?.Code ?? "—", l.Project?.Name ?? "—", l.Project?.Type,
            l.Project?.Customer?.Code, l.Project?.Customer?.Name,
            l.StatusSnapshot, l.ProgressSnapshot, l.UpdateDetail, l.NextAction, l.SortOrder);

    // ---- Header ----

    [HttpGet("meetings")]
    public async Task<ActionResult<IEnumerable<MeetingRecordDto>>> List()
    {
        var items = await db.Meetings
            .OrderByDescending(m => m.MeetingDate).ThenByDescending(m => m.MeetingId)
            .Select(m => new MeetingRecordDto(m.MeetingId, m.MeetingDate, m.Topic, m.Notes,
                m.Agenda, m.Attendees, m.PreparedBy, m.CertifiedBy, m.NextMeetingDate, m.NextMeetingPreparedBy, m.OtherTopics,
                m.IsClosed, m.ClosedAt, m.ClosedBy,
                m.Lines.Count, m.CreatedAt))
            .ToListAsync();
        return Ok(items);
    }

    [HttpGet("meetings/{id:int}")]
    public async Task<ActionResult<MeetingRecordDto>> Get(int id)
    {
        var m = await db.Meetings.FindAsync(id);
        if (m is null) return NotFound();
        var count = await db.MeetingLines.CountAsync(l => l.MeetingId == id);
        return Ok(ToDto(m, count));
    }

    [HttpPost("meetings")]
    public async Task<ActionResult<MeetingRecordDto>> Create(MeetingRecordUpsert req)
    {
        if (string.IsNullOrWhiteSpace(req.Topic))
            return BadRequest(new { message = "กรุณาระบุหัวข้อการประชุม" });

        var m = new MeetingRecord
        {
            MeetingDate = req.MeetingDate,
            Topic = req.Topic.Trim(),
            Notes = req.Notes,
            Agenda = req.Agenda,
            Attendees = req.Attendees,
            PreparedBy = req.PreparedBy,
            // CertifiedBy is stamped on Close (not user-set)
            NextMeetingDate = req.NextMeetingDate,
            NextMeetingPreparedBy = req.NextMeetingPreparedBy,
            OtherTopics = req.OtherTopics,
            CreatedAt = DateTime.UtcNow,
        };
        db.Meetings.Add(m);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = m.MeetingId }, ToDto(m, 0));
    }

    [HttpPut("meetings/{id:int}")]
    public async Task<ActionResult<MeetingRecordDto>> Update(int id, MeetingRecordUpsert req)
    {
        var m = await db.Meetings.FindAsync(id);
        if (m is null) return NotFound();
        if (m.IsClosed) return Conflict(LockedError);
        if (string.IsNullOrWhiteSpace(req.Topic))
            return BadRequest(new { message = "กรุณาระบุหัวข้อการประชุม" });

        m.MeetingDate = req.MeetingDate;
        m.Topic = req.Topic.Trim();
        m.Notes = req.Notes;
        m.Agenda = req.Agenda;
        m.Attendees = req.Attendees;
        m.PreparedBy = req.PreparedBy;
        // CertifiedBy is stamped on Close (not user-editable)
        m.NextMeetingDate = req.NextMeetingDate;
        m.NextMeetingPreparedBy = req.NextMeetingPreparedBy;
        m.OtherTopics = req.OtherTopics;
        m.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var count = await db.MeetingLines.CountAsync(l => l.MeetingId == id);
        return Ok(ToDto(m, count));
    }

    [HttpDelete("meetings/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var m = await db.Meetings.FindAsync(id);
        if (m is null) return NotFound();
        if (m.IsClosed) return Conflict(LockedError);
        db.Meetings.Remove(m);   // cascades to MeetingLine per schema FK
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Lock the meeting from further edits (Admin + PM).</summary>
    [HttpPost("meetings/{id:int}/close")]
    public async Task<ActionResult<MeetingRecordDto>> Close(int id)
    {
        var m = await db.Meetings.FindAsync(id);
        if (m is null) return NotFound();
        if (!m.IsClosed)
        {
            m.IsClosed = true;
            m.ClosedAt = DateTime.UtcNow;
            m.ClosedBy = CurrentUser();
            m.CertifiedBy = m.ClosedBy;   // ผู้รับรองการประชุม = คนที่กด Close
            m.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        var count = await db.MeetingLines.CountAsync(l => l.MeetingId == id);
        return Ok(ToDto(m, count));
    }

    /// <summary>Reopen a closed meeting so it can be edited again (Admin + PM).</summary>
    [HttpPost("meetings/{id:int}/reopen")]
    public async Task<ActionResult<MeetingRecordDto>> Reopen(int id)
    {
        var m = await db.Meetings.FindAsync(id);
        if (m is null) return NotFound();
        if (m.IsClosed)
        {
            m.IsClosed = false;
            m.ClosedAt = null;
            m.ClosedBy = null;
            m.CertifiedBy = null;   // ยกเลิกการรับรองเมื่อเปิดกลับมาแก้ไข
            m.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        var count = await db.MeetingLines.CountAsync(l => l.MeetingId == id);
        return Ok(ToDto(m, count));
    }

    // ---- Defaults (applied when creating a new meeting) ----

    [HttpGet("meetings/settings")]
    public async Task<ActionResult<MeetingSettingDto>> GetSettings()
    {
        var s = await db.MeetingSettings.FindAsync(1);
        return Ok(new MeetingSettingDto(s?.DefaultAgenda, s?.DefaultAttendees, s?.DefaultPreparedBy));
    }

    [HttpPut("meetings/settings")]
    public async Task<ActionResult<MeetingSettingDto>> SaveSettings(MeetingSettingDto req)
    {
        var s = await db.MeetingSettings.FindAsync(1);
        if (s is null)
        {
            s = new MeetingSetting { Id = 1 };
            db.MeetingSettings.Add(s);
        }
        s.DefaultAgenda = req.DefaultAgenda;
        s.DefaultAttendees = req.DefaultAttendees;
        s.DefaultPreparedBy = req.DefaultPreparedBy;
        s.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new MeetingSettingDto(s.DefaultAgenda, s.DefaultAttendees, s.DefaultPreparedBy));
    }

    // ---- Lines ----

    // Returns a 409 result if the meeting is closed; null if editable (or NotFound handled by caller).
    private async Task<(bool ok, ActionResult? error)> EnsureEditable(int meetingId)
    {
        var m = await db.Meetings.FirstOrDefaultAsync(x => x.MeetingId == meetingId);
        if (m is null) return (false, NotFound());
        if (m.IsClosed) return (false, Conflict(LockedError));
        return (true, null);
    }

    [HttpGet("meetings/{meetingId:int}/lines")]
    public async Task<ActionResult<IEnumerable<MeetingLineDto>>> ListLines(int meetingId)
    {
        if (!await db.Meetings.AnyAsync(m => m.MeetingId == meetingId))
            return NotFound();

        var items = await db.MeetingLines
            .Include(l => l.Project).ThenInclude(p => p!.Customer)
            .Where(l => l.MeetingId == meetingId)
            .OrderBy(l => l.SortOrder).ThenBy(l => l.Project!.Code)
            .ToListAsync();
        return Ok(items.Select(ToLineDto));
    }

    /// <summary>Bulk-create one line per project matching the given statuses (default Open+Hold), skipping projects already on the meeting.</summary>
    [HttpPost("meetings/{meetingId:int}/load-projects")]
    public async Task<ActionResult<object>> LoadProjects(int meetingId, MeetingLoadProjects? req)
    {
        var (ok, error) = await EnsureEditable(meetingId);
        if (!ok) return error!;

        var statuses = (req?.Statuses is { Length: > 0 } s ? s : DefaultLoadStatuses);

        // Existing lines on this meeting, keyed by ProjectId — we upsert against these.
        var existing = await db.MeetingLines
            .Where(l => l.MeetingId == meetingId)
            .ToListAsync();
        var byProject = existing.ToDictionary(l => l.ProjectId);

        var projects = await db.Projects
            .Where(p => statuses.Contains(p.Status))
            .OrderBy(p => p.Code)
            .ToListAsync();

        var nextOrder = existing.Count == 0 ? -1 : existing.Max(l => l.SortOrder);
        int created = 0, updated = 0;

        foreach (var p in projects)
        {
            if (byProject.TryGetValue(p.ProjectId, out var line))
            {
                // Refresh the status/progress snapshot; keep UpdateDetail / NextAction / SortOrder.
                line.StatusSnapshot = p.Status;
                line.ProgressSnapshot = p.Progress;
                line.UpdatedAt = DateTime.UtcNow;
                updated++;
            }
            else
            {
                db.MeetingLines.Add(new MeetingLine
                {
                    MeetingId = meetingId,
                    ProjectId = p.ProjectId,
                    StatusSnapshot = p.Status,
                    ProgressSnapshot = p.Progress,
                    SortOrder = ++nextOrder,
                    CreatedAt = DateTime.UtcNow,
                });
                created++;
            }
        }
        await db.SaveChangesAsync();
        return Ok(new { created, updated });
    }

    /// <summary>Manually add a single project line (snapshots its current status/progress).</summary>
    [HttpPost("meetings/{meetingId:int}/lines")]
    public async Task<ActionResult<MeetingLineDto>> AddLine(int meetingId, MeetingLineAdd req)
    {
        var (ok, error) = await EnsureEditable(meetingId);
        if (!ok) return error!;
        var p = await db.Projects.FindAsync(req.ProjectId);
        if (p is null) return BadRequest(new { message = "ไม่พบโปรเจกต์ที่เลือก" });
        if (await db.MeetingLines.AnyAsync(l => l.MeetingId == meetingId && l.ProjectId == req.ProjectId))
            return Conflict(new { message = $"โปรเจกต์ {p.Code} อยู่ในการประชุมนี้แล้ว" });

        var nextOrder = await db.MeetingLines.Where(l => l.MeetingId == meetingId)
            .Select(l => (int?)l.SortOrder).MaxAsync() ?? -1;

        var line = new MeetingLine
        {
            MeetingId = meetingId,
            ProjectId = p.ProjectId,
            StatusSnapshot = p.Status,
            ProgressSnapshot = p.Progress,
            SortOrder = nextOrder + 1,
            CreatedAt = DateTime.UtcNow,
        };
        db.MeetingLines.Add(line);
        await db.SaveChangesAsync();
        await db.Entry(line).Reference(x => x.Project).LoadAsync();
        if (line.Project is not null)
            await db.Entry(line.Project).Reference(x => x.Customer).LoadAsync();
        return Ok(ToLineDto(line));
    }

    /// <summary>Batch-save the inline-edited Update Detail / Next Action / order for a meeting's lines.</summary>
    [HttpPut("meetings/{meetingId:int}/lines")]
    public async Task<IActionResult> SaveLines(int meetingId, MeetingLineEdit[] edits)
    {
        var (ok, error) = await EnsureEditable(meetingId);
        if (!ok) return error!;

        var lines = await db.MeetingLines.Where(l => l.MeetingId == meetingId).ToListAsync();
        var byId = lines.ToDictionary(l => l.MeetingLineId);
        foreach (var edit in edits)
        {
            if (!byId.TryGetValue(edit.MeetingLineId, out var line)) continue;   // ignore rows not on this meeting
            line.UpdateDetail = edit.UpdateDetail;
            line.NextAction = edit.NextAction;
            line.SortOrder = edit.SortOrder;
            line.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("meeting-lines/{id:int}")]
    public async Task<IActionResult> DeleteLine(int id)
    {
        var line = await db.MeetingLines.FindAsync(id);
        if (line is null) return NotFound();
        var (ok, error) = await EnsureEditable(line.MeetingId);
        if (!ok) return error!;
        db.MeetingLines.Remove(line);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
