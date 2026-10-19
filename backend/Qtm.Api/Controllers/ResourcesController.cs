using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>Resource master (people who consume mandays). CRUD is Manager-only.</summary>
[ApiController]
[Route("api/v1/resources")]
[Authorize]
public class ResourcesController(QtmDbContext db) : ControllerBase
{
    private static readonly string[] ValidPositions = ["Dev", "SA", "PM"];

    private async Task<ResourceDto> ToDtoAsync(ResourceItem r) => ToDto(r, await LevelNamesAsync());

    private static ResourceDto ToDto(ResourceItem r, Dictionary<(string, string), string> levelNames) =>
        new(r.ResourceId, r.Code, r.Name, r.Position, r.IsActive, r.IsBillingKpi, r.PositionLevelCode,
            r.Position is string p && r.PositionLevelCode is string c ? levelNames.GetValueOrDefault((p, c)) : null);

    private async Task<Dictionary<(string, string), string>> LevelNamesAsync() =>
        (await db.PositionLevels.ToListAsync()).ToDictionary(l => (l.Position, l.Code), l => l.Name);

    private static string? NormalizePosition(string? p) => string.IsNullOrWhiteSpace(p) ? null : p.Trim();

    /// <summary>
    /// The level to store: null when none is picked or there is no position; otherwise it must be a
    /// level of that position (the DB's composite FK enforces the same). Returns an error message.
    /// </summary>
    private async Task<(string? Level, string? Error)> ResolveLevelAsync(string? position, string? level)
    {
        level = string.IsNullOrWhiteSpace(level) ? null : level.Trim();
        if (level is null || position is null) return (null, null);
        return await db.PositionLevels.AnyAsync(l => l.Position == position && l.Code == level)
            ? (level, null)
            : (null, $"Position Level '{level}' ไม่มีใน {position}");
    }

    /// <summary>Active resources by default (for dropdowns); pass includeInactive=true for the master page.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ResourceDto>>> List([FromQuery] bool includeInactive = false)
    {
        var q = db.Resources.AsQueryable();
        if (!includeInactive) q = q.Where(r => r.IsActive);
        var items = await q.OrderBy(r => r.Name).ToListAsync();
        var names = await LevelNamesAsync();
        return Ok(items.Select(r => ToDto(r, names)));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ResourceDto>> Get(int id)
    {
        var r = await db.Resources.FindAsync(id);
        return r is null ? NotFound() : Ok(await ToDtoAsync(r));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ResourceDto>> Create(ResourceUpsert req)
    {
        if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "ต้องมี Code และ Name" });
        var position = NormalizePosition(req.Position);
        if (position is not null && !ValidPositions.Contains(position))
            return BadRequest(new { message = "Position ต้องเป็น Dev/SA/PM" });
        if (await db.Resources.AnyAsync(r => r.Code == req.Code))
            return Conflict(new { message = $"Resource code '{req.Code}' มีอยู่แล้ว" });
        var (level, levelError) = await ResolveLevelAsync(position, req.PositionLevelCode);
        if (levelError is not null) return BadRequest(new { message = levelError });

        var r = new ResourceItem
        {
            Code = req.Code.Trim(), Name = req.Name.Trim(), Position = position, PositionLevelCode = level,
            IsActive = req.IsActive,
        };
        db.Resources.Add(r);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = r.ResourceId }, await ToDtoAsync(r));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ResourceDto>> Update(int id, ResourceUpsert req)
    {
        var r = await db.Resources.FindAsync(id);
        if (r is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "ต้องมี Code และ Name" });
        var position = NormalizePosition(req.Position);
        if (position is not null && !ValidPositions.Contains(position))
            return BadRequest(new { message = "Position ต้องเป็น Dev/SA/PM" });
        if (req.Code != r.Code && await db.Resources.AnyAsync(x => x.Code == req.Code))
            return Conflict(new { message = $"Resource code '{req.Code}' มีอยู่แล้ว" });
        var (level, levelError) = await ResolveLevelAsync(position, req.PositionLevelCode);
        if (levelError is not null) return BadRequest(new { message = levelError });

        r.Code = req.Code.Trim();
        r.Name = req.Name.Trim();
        r.Position = position;
        r.PositionLevelCode = level;
        r.IsActive = req.IsActive;
        await db.SaveChangesAsync();
        return Ok(await ToDtoAsync(r));
    }

    /// <summary>
    /// Marks whether this resource counts toward the Billing KPI (a column of the allocation matrix).
    /// Its own endpoint rather than a field on ResourceUpsert, so the existing edit form — which
    /// doesn't know about the flag — can never clear it by saving. Admin only, like the Billing screens.
    /// </summary>
    [HttpPut("{id:int}/billing-kpi")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<ResourceDto>> SetBillingKpi(int id, ResourceBillingKpiRequest req)
    {
        var r = await db.Resources.FindAsync(id);
        if (r is null) return NotFound();
        r.IsBillingKpi = req.IsBillingKpi;
        await db.SaveChangesAsync();
        return Ok(await ToDtoAsync(r));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var r = await db.Resources.FindAsync(id);
        if (r is null) return NotFound();

        // Resources referenced by manday rows can't be hard-deleted (FK) — deactivate instead.
        if (await db.MandayEntries.AnyAsync(m => m.ResourceId == id))
            return Conflict(new { message = "Resource นี้ถูกใช้ในรายการ manday แล้ว ลบไม่ได้ — ให้ปิดใช้งาน (Inactive) แทน" });
        if (await db.BillingAllocations.AnyAsync(a => a.ResourceId == id))
            return Conflict(new { message = "Resource นี้มีการ Allocate Billing Manday แล้ว ลบไม่ได้ — ให้ปิดใช้งาน (Inactive) แทน" });

        db.Resources.Remove(r);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
