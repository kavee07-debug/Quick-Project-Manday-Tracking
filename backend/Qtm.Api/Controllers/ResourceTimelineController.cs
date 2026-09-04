using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// Predictive per-resource schedule of the remaining budgeted work. For every resource we take the
/// tasks that still have work left (per resource+task: Budget+Adjust − Actual &gt; 0, within jobs whose
/// job-level Budget+Adjust exceeds Actual), then pack them onto a working-day (Mon–Fri) calendar from
/// today, one task at a time. 1 manday = 1 working day. Projects whose code starts with 'Z' are
/// scheduled last. Planned Start/End on manday entries are intentionally ignored — everything starts now.
/// </summary>
[ApiController]
[Route("api/v1/resource-timeline")]
[Authorize]
public class ResourceTimelineController(QtmDbContext db) : ControllerBase
{
    private const string Unassigned = "ไม่ระบุ";

    private static HashSet<string> ParseCsv(string? csv) =>
        string.IsNullOrWhiteSpace(csv)
            ? []
            : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();

    /// <param name="types">Optional CSV of project types to include; empty = all.</param>
    /// <param name="jobs">Optional CSV of project codes to include; empty = all.</param>
    /// <param name="start">Reference "today" (yyyy-MM-dd) from the client; defaults to the server's local date.</param>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ResourceTimelineRow>>> Get(
        [FromQuery] string? types = null, [FromQuery] string? jobs = null, [FromQuery] DateOnly? start = null)
    {
        var typeSet = ParseCsv(types);
        var jobSet = ParseCsv(jobs);
        var today = start ?? DateOnly.FromDateTime(DateTime.Now);

        var query =
            from m in db.MandayEntries
            join t in db.Tasks on m.TaskId equals t.TaskId
            join p in db.Projects on t.ProjectId equals p.ProjectId
            join r in db.Resources on m.ResourceId equals r.ResourceId into rj
            from r in rj.DefaultIfEmpty()
            select new
            {
                ResId = m.ResourceId,
                ResCode = r != null ? r.Code : null,
                ResName = r != null ? r.Name : null,
                Position = r != null ? r.Position : null,
                ProjectId = p.ProjectId,
                ProjectCode = p.Code,
                ProjectName = p.Name,
                ProjectStatus = p.Status,
                ProjectType = p.Type,
                t.TaskId,
                TaskName = t.Name,
                TaskDescription = t.Description,
                t.SortOrder,
                m.EntryType,
                m.Manday,
            };

        // Only Open projects are scheduled — Hold/Completed/Cancel have no upcoming work to predict.
        query = query.Where(x => x.ProjectStatus == "Open");
        if (typeSet.Count > 0) query = query.Where(x => x.ProjectType != null && typeSet.Contains(x.ProjectType));
        if (jobSet.Count > 0) query = query.Where(x => jobSet.Contains(x.ProjectCode));

        var raw = await query.ToListAsync();

        // Job-level gate: keep only projects whose Budget+Adjust exceeds Actual (still net work left).
        var jobsWithRemaining = raw
            .GroupBy(x => x.ProjectId)
            .Where(g => g.Where(e => e.EntryType is "Budget" or "Adjust").Sum(e => e.Manday)
                        > g.Where(e => e.EntryType == "Actual").Sum(e => e.Manday))
            .Select(g => g.Key)
            .ToHashSet();

        // Per (resource, task): remaining = (Budget+Adjust) − Actual, kept only when > 0.
        var blocks = raw
            .Where(x => jobsWithRemaining.Contains(x.ProjectId))
            .GroupBy(x => new { x.ResId, x.TaskId })
            .Select(g =>
            {
                var f = g.First();
                var budgetAdjust = g.Where(e => e.EntryType is "Budget" or "Adjust").Sum(e => e.Manday);
                var actual = g.Where(e => e.EntryType == "Actual").Sum(e => e.Manday);
                return new
                {
                    f.ResId, f.ResCode, f.ResName, f.Position,
                    f.ProjectCode, f.ProjectName, f.TaskName, f.TaskDescription, f.SortOrder,
                    Remaining = budgetAdjust - actual,
                    IsZ = f.ProjectCode.StartsWith("Z", StringComparison.OrdinalIgnoreCase),
                };
            })
            .Where(x => x.Remaining > 0)
            .ToList();

        var rows = blocks
            .GroupBy(x => x.ResId)
            .Select(g =>
            {
                var f = g.First();
                var position = string.IsNullOrWhiteSpace(f.Position) ? Unassigned : f.Position!;

                // Order this resource's queue: non-Z first, then Z; within each by project code, task order.
                var ordered = g
                    .OrderBy(x => x.IsZ)
                    .ThenBy(x => x.ProjectCode, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(x => x.SortOrder)
                    .ThenBy(x => x.TaskName, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                // Pack sequentially from today across working days (Mon–Fri).
                var cursor = NextWorkingDay(today);
                var packed = new List<ResourceTimelineBlock>();
                foreach (var b in ordered)
                {
                    var dur = Math.Max(1, (int)Math.Ceiling(b.Remaining));
                    var startDate = cursor;
                    var endDate = AddWorkingDays(startDate, dur - 1);
                    packed.Add(new ResourceTimelineBlock(b.ProjectCode, b.ProjectName, b.IsZ, b.TaskName,
                        b.TaskDescription, b.Remaining, dur, startDate, endDate));
                    cursor = AddWorkingDays(endDate, 1);
                }

                return new ResourceTimelineRow(
                    f.ResName != null ? g.Key ?? 0 : 0,
                    f.ResCode ?? "—",
                    f.ResName ?? "(ไม่ระบุ)",
                    position,
                    g.Sum(x => x.Remaining),
                    packed.Count > 0 ? packed.Min(x => x.StartDate) : null,
                    packed.Count > 0 ? packed.Max(x => x.EndDate) : null,
                    [.. packed]);
            })
            .OrderBy(r => r.Code, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Ok(rows);
    }

    // Roll d forward to the next Mon–Fri (returns d unchanged when it's already a weekday).
    private static DateOnly NextWorkingDay(DateOnly d)
    {
        while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
            d = d.AddDays(1);
        return d;
    }

    // Add n working days to a working-day start (n=0 → same day). Skips weekends.
    private static DateOnly AddWorkingDays(DateOnly start, int n)
    {
        var d = NextWorkingDay(start);
        for (var added = 0; added < n; added++)
        {
            d = d.AddDays(1);
            while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
                d = d.AddDays(1);
        }
        return d;
    }
}
