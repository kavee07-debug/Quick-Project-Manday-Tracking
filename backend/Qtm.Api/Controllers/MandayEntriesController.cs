using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

[ApiController]
[Route("api/v1")]
[Authorize]
public class MandayEntriesController(QtmDbContext db) : ControllerBase
{
    private static readonly string[] ValidTypes = ["Budget", "Actual", "Adjust"];

    private static MandayEntryDto ToDto(MandayEntry m) =>
        new(m.MandayEntryId, m.TaskId, m.EntryType, m.ResourceId, m.Resource?.Name, m.Resource?.Position,
            m.Manday, m.EntryDate, m.StartDate, m.EndDate, m.Note);

    [HttpGet("tasks/{taskId:int}/mandays")]
    public async Task<ActionResult<IEnumerable<MandayEntryDto>>> List(int taskId)
    {
        if (!await db.Tasks.AnyAsync(t => t.TaskId == taskId))
            return NotFound();

        var items = await db.MandayEntries
            .Include(m => m.Resource)
            .Where(m => m.TaskId == taskId)
            .OrderBy(m => m.EntryType).ThenBy(m => m.MandayEntryId)
            .ToListAsync();
        return Ok(items.Select(ToDto));
    }

    [HttpGet("mandays/{id:int}")]
    public async Task<ActionResult<MandayEntryDto>> Get(int id)
    {
        var m = await db.MandayEntries.Include(x => x.Resource).FirstOrDefaultAsync(x => x.MandayEntryId == id);
        return m is null ? NotFound() : Ok(ToDto(m));
    }

    [HttpPost("tasks/{taskId:int}/mandays")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<MandayEntryDto>> Create(int taskId, MandayUpsert req)
    {
        if (!await db.Tasks.AnyAsync(t => t.TaskId == taskId))
            return NotFound();

        var validation = await ValidateAsync(req);
        if (validation is not null) return validation;

        var m = new MandayEntry
        {
            TaskId = taskId,
            EntryType = req.EntryType,
            ResourceId = req.ResourceId,
            Manday = req.Manday,
            EntryDate = req.EntryDate,
            StartDate = req.StartDate,
            EndDate = req.EndDate,
            Note = req.Note,
            CreatedAt = DateTime.UtcNow,
        };
        db.MandayEntries.Add(m);
        await db.SaveChangesAsync();
        await db.Entry(m).Reference(x => x.Resource).LoadAsync();
        return CreatedAtAction(nameof(Get), new { id = m.MandayEntryId }, ToDto(m));
    }

    [HttpPut("mandays/{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<MandayEntryDto>> Update(int id, MandayUpsert req)
    {
        var m = await db.MandayEntries.FindAsync(id);
        if (m is null) return NotFound();

        var validation = await ValidateAsync(req);
        if (validation is not null) return validation;

        m.EntryType = req.EntryType;
        m.ResourceId = req.ResourceId;
        m.Manday = req.Manday;
        m.EntryDate = req.EntryDate;
        m.StartDate = req.StartDate;
        m.EndDate = req.EndDate;
        m.Note = req.Note;
        m.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await db.Entry(m).Reference(x => x.Resource).LoadAsync();
        return Ok(ToDto(m));
    }

    [HttpDelete("mandays/{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var m = await db.MandayEntries.FindAsync(id);
        if (m is null) return NotFound();
        db.MandayEntries.Remove(m);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task<ActionResult?> ValidateAsync(MandayUpsert req)
    {
        if (!ValidTypes.Contains(req.EntryType))
            return BadRequest(new { message = "EntryType must be Budget, Actual or Adjust." });
        if (req.Manday < 0)
            return BadRequest(new { message = "Manday must be zero or greater." });
        if (req.StartDate is DateOnly sd && req.EndDate is DateOnly ed && ed < sd)
            return BadRequest(new { message = "End Date ต้องไม่ก่อน Start Date." });
        if (req.ResourceId is int rid && !await db.Resources.AnyAsync(r => r.ResourceId == rid))
            return BadRequest(new { message = "Unknown ResourceId." });
        return null;
    }
}
