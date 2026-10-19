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
/// Position Level master — the levels within each Position (Dev / SA / PM), which resources are
/// assigned to — and the manday target per level per year that the Billing KPI screen measures
/// each resource against. Levels are kept by Managers, like the Resource master; targets feed the
/// KPI, so they are Admin only.
/// </summary>
[ApiController]
[Route("api/v1/position-levels")]
[Authorize]
public class PositionLevelsController(QtmDbContext db) : ControllerBase
{
    private static readonly string[] ValidPositions = ["Dev", "SA", "PM"];

    private string CurrentUser() =>
        User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue(ClaimTypes.Email) ?? "unknown";

    /// <summary>Every level with its targets by year and how many resources use it.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<PositionLevelDto>>> List()
    {
        var levels = await db.PositionLevels.ToListAsync();
        var targets = await db.PositionLevelTargets.ToListAsync();
        var used = (await db.Resources.Where(r => r.PositionLevelCode != null)
                .GroupBy(r => new { r.Position, r.PositionLevelCode })
                .Select(g => new { g.Key.Position, g.Key.PositionLevelCode, N = g.Count() })
                .ToListAsync())
            .ToDictionary(x => (x.Position!, x.PositionLevelCode!), x => x.N);

        return Ok(levels
            .OrderBy(l => Array.IndexOf(ValidPositions, l.Position)).ThenBy(l => l.Code)
            .Select(l => new PositionLevelDto(l.Position, l.Code, l.Name,
                used.GetValueOrDefault((l.Position, l.Code)),
                targets.Where(t => t.Position == l.Position && t.LevelCode == l.Code)
                    .ToDictionary(t => t.Year, t => t.TargetManday))));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Create(PositionLevelUpsert req)
    {
        var position = req.Position?.Trim() ?? "";
        var code = req.Code?.Trim().ToUpperInvariant() ?? "";
        var name = req.Name?.Trim() ?? "";
        if (!ValidPositions.Contains(position)) return BadRequest(new { message = "Position ต้องเป็น Dev/SA/PM" });
        if (code.Length == 0 || name.Length == 0) return BadRequest(new { message = "ต้องมี Code และ Name" });
        if (code.Length > 20 || name.Length > 100) return BadRequest(new { message = "Code ยาวได้ไม่เกิน 20 ตัวอักษร, Name ไม่เกิน 100" });
        if (await db.PositionLevels.AnyAsync(l => l.Position == position && l.Code == code))
            return Conflict(new { message = $"Level '{code}' ของ {position} มีอยู่แล้ว" });

        db.PositionLevels.Add(new PositionLevel { Position = position, Code = code, Name = name });
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Renames a level. Position and Code are its key — to change them, add a new level.</summary>
    [HttpPut("{position}/{code}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Update(string position, string code, PositionLevelUpsert req)
    {
        var level = await db.PositionLevels.FindAsync(position, code);
        if (level is null) return NotFound();
        var name = req.Name?.Trim() ?? "";
        if (name.Length == 0 || name.Length > 100) return BadRequest(new { message = "ต้องมี Name (ไม่เกิน 100 ตัวอักษร)" });
        level.Name = name;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Deletes a level and its targets — refused while any resource is on it.</summary>
    [HttpDelete("{position}/{code}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(string position, string code)
    {
        var level = await db.PositionLevels.FindAsync(position, code);
        if (level is null) return NotFound();
        var n = await db.Resources.CountAsync(r => r.Position == position && r.PositionLevelCode == code);
        if (n > 0) return Conflict(new { message = $"มี Resource ใช้ Level นี้อยู่ {n} คน — เปลี่ยน Level ของ Resource ก่อนจึงจะลบได้" });

        db.PositionLevels.Remove(level);   // targets go with it (ON DELETE CASCADE)
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Sets (or, with null, clears) a level's manday target for one year.</summary>
    [HttpPut("{position}/{code}/targets/{year:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> SetTarget(string position, string code, int year, PositionLevelTargetRequest req)
    {
        if (year < 2000 || year > 2100) return BadRequest(new { message = "ปีไม่ถูกต้อง" });
        if (await db.PositionLevels.FindAsync(position, code) is null) return NotFound();
        if (req.TargetManday is < 0 or > 99999) return BadRequest(new { message = "Target ต้องอยู่ระหว่าง 0 – 99,999" });

        var t = await db.PositionLevelTargets.FindAsync(position, code, year);
        if (req.TargetManday is not decimal value)
        {
            if (t is not null) db.PositionLevelTargets.Remove(t);
        }
        else
        {
            if (t is null)
                db.PositionLevelTargets.Add(t = new PositionLevelTarget { Position = position, LevelCode = code, Year = year });
            t.TargetManday = Math.Round(value, 3);
            t.UpdatedAt = DateTime.UtcNow;
            t.UpdatedBy = CurrentUser();
        }
        await db.SaveChangesAsync();
        return NoContent();
    }
}
