using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// Pivot report: each project broken down by resource Position, showing
/// Budget+Adjust, Actual and Remaining = (Budget+Adjust) - Actual.
/// Manday rows whose resource has no Position (or no resource) fall under "ไม่ระบุ".
/// </summary>
[ApiController]
[Route("api/v1/manday-summary")]
[Authorize]
public class MandaySummaryController(QtmDbContext db) : ControllerBase
{
    private const string Unassigned = "ไม่ระบุ";

    private static HashSet<string> ParseCsv(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? []
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();

    /// <param name="statuses">Optional CSV of project statuses to include (e.g. "Open,Hold"); empty = all.</param>
    /// <param name="types">Optional CSV of project types to include (e.g. "Implement,Internal"); empty = all.</param>
    /// <param name="jobs">Optional CSV of project codes to include; empty = all.</param>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<MandaySummaryRow>>> Get(
        [FromQuery] string? statuses = null, [FromQuery] string? types = null, [FromQuery] string? jobs = null)
    {
        var statusSet = ParseCsv(statuses);
        var typeSet = ParseCsv(types);
        var jobSet = ParseCsv(jobs);
        // Left-join resource so manday rows with null ResourceId are kept.
        var raw = await (
            from m in db.MandayEntries
            join t in db.Tasks on m.TaskId equals t.TaskId
            join r in db.Resources on m.ResourceId equals r.ResourceId into rj
            from r in rj.DefaultIfEmpty()
            select new
            {
                t.ProjectId,
                Position = r != null ? r.Position : null,
                m.EntryType,
                m.Manday,
            }).ToListAsync();

        var byProject = raw
            .GroupBy(x => x.ProjectId)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(x => string.IsNullOrWhiteSpace(x.Position) ? Unassigned : x.Position!)
                      .Select(pg =>
                      {
                          var budgetAdjust = pg.Where(e => e.EntryType is "Budget" or "Adjust").Sum(e => e.Manday);
                          var actual = pg.Where(e => e.EntryType == "Actual").Sum(e => e.Manday);
                          return new MandaySummaryCell(pg.Key, budgetAdjust, actual, budgetAdjust - actual);
                      })
                      .ToArray());

        var projQuery = db.Projects.AsQueryable();
        if (statusSet.Count > 0) projQuery = projQuery.Where(p => statusSet.Contains(p.Status));
        if (typeSet.Count > 0) projQuery = projQuery.Where(p => p.Type != null && typeSet.Contains(p.Type));
        if (jobSet.Count > 0) projQuery = projQuery.Where(p => jobSet.Contains(p.Code));
        var projects = await projQuery.OrderBy(p => p.Code).ToListAsync();
        var rows = projects.Select(p => new MandaySummaryRow(
            p.ProjectId, p.Code, p.Name, p.Status,
            byProject.TryGetValue(p.ProjectId, out var cells) ? cells : []));

        return Ok(rows);
    }

    /// <summary>Un-aggregated manday rows behind the pivot (for the "explain" drill-down).</summary>
    [HttpGet("breakdown")]
    public async Task<ActionResult<IEnumerable<MandayBreakdownRow>>> Breakdown(
        [FromQuery] string? statuses = null, [FromQuery] string? types = null, [FromQuery] string? jobs = null)
    {
        var statusSet = ParseCsv(statuses);
        var typeSet = ParseCsv(types);
        var jobSet = ParseCsv(jobs);

        var q =
            from m in db.MandayEntries
            join t in db.Tasks on m.TaskId equals t.TaskId
            join p in db.Projects on t.ProjectId equals p.ProjectId
            join r in db.Resources on m.ResourceId equals r.ResourceId into rj
            from r in rj.DefaultIfEmpty()
            select new
            {
                p.ProjectId, ProjectCode = p.Code, ProjectName = p.Name, p.Status, p.Type,
                Position = r != null ? r.Position : null,
                ResourceName = r != null ? r.Name : null,
                TaskName = t.Name, TaskDescription = t.Description, m.EntryType, m.Manday, m.Note,
            };
        if (statusSet.Count > 0) q = q.Where(x => statusSet.Contains(x.Status));
        if (typeSet.Count > 0) q = q.Where(x => x.Type != null && typeSet.Contains(x.Type));
        if (jobSet.Count > 0) q = q.Where(x => jobSet.Contains(x.ProjectCode));

        var rows = (await q.ToListAsync())
            .Select(x => new MandayBreakdownRow(x.ProjectId,
                string.IsNullOrWhiteSpace(x.Position) ? Unassigned : x.Position!,
                x.ProjectCode, x.ProjectName, x.TaskName, x.TaskDescription, x.EntryType, x.Manday, x.ResourceName, x.Note));
        return Ok(rows);
    }
}
