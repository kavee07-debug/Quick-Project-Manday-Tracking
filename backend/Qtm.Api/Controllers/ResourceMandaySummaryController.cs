using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// Resource-angle counterpart of the Manday Summary: each resource's manday totals
/// (Budget+Adjust, Actual, Remaining) placed under its own Position group.
/// Manday rows with no resource fall under a "(ไม่ระบุ)" row / "ไม่ระบุ" position.
/// </summary>
[ApiController]
[Route("api/v1/resource-manday-summary")]
[Authorize]
public class ResourceMandaySummaryController(QtmDbContext db) : ControllerBase
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
    public async Task<ActionResult<IEnumerable<ResourceMandaySummaryRow>>> Get(
        [FromQuery] string? statuses = null, [FromQuery] string? types = null, [FromQuery] string? jobs = null)
    {
        var statusSet = ParseCsv(statuses);
        var typeSet = ParseCsv(types);
        var jobSet = ParseCsv(jobs);

        // Join through Task→Project so manday can be filtered by the owning project's status/type/code.
        var query =
            from m in db.MandayEntries
            join t in db.Tasks on m.TaskId equals t.TaskId
            join p in db.Projects on t.ProjectId equals p.ProjectId
            join r in db.Resources on m.ResourceId equals r.ResourceId into rj
            from r in rj.DefaultIfEmpty()
            select new
            {
                ResId = m.ResourceId,
                Code = r != null ? r.Code : null,
                Name = r != null ? r.Name : null,
                Position = r != null ? r.Position : null,
                ProjectStatus = p.Status,
                ProjectType = p.Type,
                ProjectCode = p.Code,
                m.EntryType,
                m.Manday,
            };

        if (statusSet.Count > 0) query = query.Where(x => statusSet.Contains(x.ProjectStatus));
        if (typeSet.Count > 0) query = query.Where(x => x.ProjectType != null && typeSet.Contains(x.ProjectType));
        if (jobSet.Count > 0) query = query.Where(x => jobSet.Contains(x.ProjectCode));

        var raw = await query.ToListAsync();

        var rows = raw
            .GroupBy(x => x.ResId)
            .Select(g =>
            {
                var first = g.First();
                var position = string.IsNullOrWhiteSpace(first.Position) ? Unassigned : first.Position!;
                var budgetAdjust = g.Where(e => e.EntryType is "Budget" or "Adjust").Sum(e => e.Manday);
                var actual = g.Where(e => e.EntryType == "Actual").Sum(e => e.Manday);
                var cell = new MandaySummaryCell(position, budgetAdjust, actual, budgetAdjust - actual);
                return new ResourceMandaySummaryRow(
                    first.Name != null ? g.Key ?? 0 : 0,
                    first.Code ?? "—",
                    first.Name ?? "(ไม่ระบุ)",
                    [cell]);
            })
            .OrderBy(r => r.Code)
            .ToList();

        return Ok(rows);
    }

    /// <summary>Un-aggregated manday rows behind the pivot (for the "explain" drill-down).</summary>
    [HttpGet("breakdown")]
    public async Task<ActionResult<IEnumerable<ResourceBreakdownRow>>> Breakdown(
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
                ResId = m.ResourceId,
                Position = r != null ? r.Position : null,
                ProjectCode = p.Code, ProjectName = p.Name, p.Status, p.Type,
                TaskName = t.Name, TaskDescription = t.Description, m.EntryType, m.Manday, m.Note,
            };
        if (statusSet.Count > 0) q = q.Where(x => statusSet.Contains(x.Status));
        if (typeSet.Count > 0) q = q.Where(x => x.Type != null && typeSet.Contains(x.Type));
        if (jobSet.Count > 0) q = q.Where(x => jobSet.Contains(x.ProjectCode));

        var rows = (await q.ToListAsync())
            .Select(x => new ResourceBreakdownRow(x.ResId ?? 0,
                string.IsNullOrWhiteSpace(x.Position) ? Unassigned : x.Position!,
                x.ProjectCode, x.ProjectName, x.TaskName, x.TaskDescription, x.EntryType, x.Manday, x.Note));
        return Ok(rows);
    }
}
