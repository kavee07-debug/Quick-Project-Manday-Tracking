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

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ResourceMandaySummaryRow>>> Get()
    {
        var raw = await (
            from m in db.MandayEntries
            join r in db.Resources on m.ResourceId equals r.ResourceId into rj
            from r in rj.DefaultIfEmpty()
            select new
            {
                ResId = m.ResourceId,
                Code = r != null ? r.Code : null,
                Name = r != null ? r.Name : null,
                Position = r != null ? r.Position : null,
                m.EntryType,
                m.Manday,
            }).ToListAsync();

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
}
