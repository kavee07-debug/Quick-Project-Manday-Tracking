using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Dtos;
using Qtm.Api.Services;

namespace Qtm.Api.Controllers;

/// <summary>
/// D365 Business Central Timesheet staging (Admin only). Pull timesheet lines for a date range,
/// review/remap them to in-app Project/Task, then apply as Actual mandays.
/// </summary>
[ApiController]
[Route("api/v1/d365/timesheet")]
[Authorize(Roles = Roles.Admin)]
public class D365TimesheetController(QtmDbContext db, D365TimesheetService timesheets) : ControllerBase
{
    [HttpPost("fetch")]
    public async Task<ActionResult<D365TimesheetFetchResult>> Fetch(D365TimesheetFetchRequest req, CancellationToken ct)
    {
        try { return Ok(await timesheets.FetchAsync(req.StartDate, req.EndDate, ct)); }
        catch (D365BcException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<D365TimesheetRow>>> List(CancellationToken ct)
    {
        var rows = await db.D365TimesheetStagings.OrderBy(x => x.TimesheetDate).ThenBy(x => x.JobNo).ToListAsync(ct);

        var projects = (await db.Projects.Select(p => new { p.ProjectId, p.Code }).ToListAsync(ct))
            .ToDictionary(p => p.Code, p => p.ProjectId, StringComparer.OrdinalIgnoreCase);
        var tasks = (await db.Tasks.Select(t => new { t.ProjectId, t.Name }).ToListAsync(ct))
            .Select(t => (t.ProjectId, Name: t.Name.ToLowerInvariant())).ToHashSet();
        var appliedIds = (await db.MandayEntries.Where(m => m.SourceSystemId != null)
                .Select(m => m.SourceSystemId!).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        // Resource code -> name, to resolve each line's "No" against the Resource master.
        var resourceNames = (await db.Resources.Select(r => new { r.Code, r.Name }).ToListAsync(ct))
            .GroupBy(r => r.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Name, StringComparer.OrdinalIgnoreCase);

        // Validate a job/task pair against the in-app Project + Task masters.
        string Validate(string? jobNo, string? taskNo)
        {
            if (string.IsNullOrWhiteSpace(jobNo) || !projects.TryGetValue(jobNo!, out var pid))
                return "NoJob";
            if (string.IsNullOrWhiteSpace(taskNo) || !tasks.Contains((pid, taskNo!.ToLowerInvariant())))
                return "NoTask";
            return "OK";
        }

        return Ok(rows.Select(r =>
        {
            var resName = string.IsNullOrWhiteSpace(r.ResourceNo) ? null
                : resourceNames.GetValueOrDefault(r.ResourceNo!);

            return new D365TimesheetRow(r.TimesheetStagingId, r.SystemId, r.JobNo, r.JobTaskNo,
                r.TimesheetDate, r.ResourceNo, resName, r.QuantityHour, r.QuantityMD, r.Comment,
                r.ProjectManager, r.TimesheetStatus, r.NewJobNo, r.NewTaskNo,
                Validate(r.JobNo, r.JobTaskNo), Validate(r.NewJobNo, r.NewTaskNo),
                appliedIds.Contains(r.SystemId));
        }));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, D365TimesheetUpsert req, CancellationToken ct)
    {
        var row = await db.D365TimesheetStagings.FindAsync([id], ct);
        if (row is null) return NotFound();
        row.NewJobNo = string.IsNullOrWhiteSpace(req.NewJobNo) ? null : req.NewJobNo.Trim();
        row.NewTaskNo = string.IsNullOrWhiteSpace(req.NewTaskNo) ? null : req.NewTaskNo.Trim();
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var row = await db.D365TimesheetStagings.FindAsync([id], ct);
        if (row is null) return NotFound();
        db.D365TimesheetStagings.Remove(row);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("delete")]
    public async Task<ActionResult<object>> DeleteSelected(StagingIdsRequest req, CancellationToken ct)
    {
        var ids = req.Ids ?? [];
        if (ids.Length == 0) return Ok(new { deleted = 0 });
        var rows = await db.D365TimesheetStagings.Where(x => ids.Contains(x.TimesheetStagingId)).ToListAsync(ct);
        db.D365TimesheetStagings.RemoveRange(rows);
        await db.SaveChangesAsync(ct);
        return Ok(new { deleted = rows.Count });
    }

    [HttpPost("apply")]
    public async Task<ActionResult<D365ApplyResult>> Apply(StagingIdsRequest req, CancellationToken ct)
    {
        try { return Ok(await timesheets.ApplyAsync(req.Ids ?? [], ct)); }
        catch (D365BcException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("auto-map")]
    public async Task<ActionResult<D365TimesheetAutoMapResult>> AutoMap(StagingIdsRequest req, CancellationToken ct)
        => Ok(await timesheets.AutoMapAsync(req.Ids ?? [], ct));
}
