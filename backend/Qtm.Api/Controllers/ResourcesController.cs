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

    private static ResourceDto ToDto(ResourceItem r) =>
        new(r.ResourceId, r.Code, r.Name, r.Position, r.IsActive);

    private static string? NormalizePosition(string? p) => string.IsNullOrWhiteSpace(p) ? null : p.Trim();

    /// <summary>Active resources by default (for dropdowns); pass includeInactive=true for the master page.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<ResourceDto>>> List([FromQuery] bool includeInactive = false)
    {
        var q = db.Resources.AsQueryable();
        if (!includeInactive) q = q.Where(r => r.IsActive);
        var items = await q.OrderBy(r => r.Name).ToListAsync();
        return Ok(items.Select(ToDto));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ResourceDto>> Get(int id)
    {
        var r = await db.Resources.FindAsync(id);
        return r is null ? NotFound() : Ok(ToDto(r));
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

        var r = new ResourceItem { Code = req.Code.Trim(), Name = req.Name.Trim(), Position = position, IsActive = req.IsActive };
        db.Resources.Add(r);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = r.ResourceId }, ToDto(r));
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

        r.Code = req.Code.Trim();
        r.Name = req.Name.Trim();
        r.Position = position;
        r.IsActive = req.IsActive;
        await db.SaveChangesAsync();
        return Ok(ToDto(r));
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

        db.Resources.Remove(r);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
