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
    [HttpGet]
    public async Task<ActionResult<IEnumerable<MandaySummaryRow>>> Get(
        [FromQuery] string? statuses = null, [FromQuery] string? types = null)
    {
        var statusSet = ParseCsv(statuses);
        var typeSet = ParseCsv(types);
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
        var projects = await projQuery.OrderBy(p => p.Code).ToListAsync();
        var rows = projects.Select(p => new MandaySummaryRow(
            p.ProjectId, p.Code, p.Name, p.Status,
            byProject.TryGetValue(p.ProjectId, out var cells) ? cells : []));

        return Ok(rows);
    }
}
