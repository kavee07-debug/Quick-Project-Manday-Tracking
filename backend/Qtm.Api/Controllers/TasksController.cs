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
public class TasksController(QtmDbContext db) : ControllerBase
{
    private static TaskDto ToDto(TaskItem t) =>
        new(t.TaskId, t.ProjectId, t.Name, t.Description, t.Status, t.SortOrder);

    [HttpGet("projects/{projectId:int}/tasks")]
    public async Task<ActionResult<IEnumerable<TaskDto>>> List(int projectId)
    {
        if (!await db.Projects.AnyAsync(p => p.ProjectId == projectId))
            return NotFound();

        var items = await db.Tasks
            .Where(t => t.ProjectId == projectId)
            .OrderBy(t => t.SortOrder).ThenBy(t => t.Name)
            .ToListAsync();
        return Ok(items.Select(ToDto));
    }

    [HttpGet("tasks/{id:int}")]
    public async Task<ActionResult<TaskDto>> Get(int id)
    {
        var t = await db.Tasks.FindAsync(id);
        return t is null ? NotFound() : Ok(ToDto(t));
    }

    [HttpPost("projects/{projectId:int}/tasks")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<TaskDto>> Create(int projectId, TaskUpsert req)
    {
        if (!await db.Projects.AnyAsync(p => p.ProjectId == projectId))
            return NotFound();
        if (await db.Tasks.AnyAsync(t => t.ProjectId == projectId && t.Name == req.Name))
            return Conflict(new { message = $"Task '{req.Name}' already exists in this project." });

        var t = new TaskItem
        {
            ProjectId = projectId,
            Name = req.Name,
            Description = req.Description,
            Status = string.IsNullOrWhiteSpace(req.Status) ? "Open" : req.Status,
            SortOrder = req.SortOrder,
            CreatedAt = DateTime.UtcNow,
        };
        db.Tasks.Add(t);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = t.TaskId }, ToDto(t));
    }

    [HttpPut("tasks/{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<TaskDto>> Update(int id, TaskUpsert req)
    {
        var t = await db.Tasks.FindAsync(id);
        if (t is null) return NotFound();

        if (req.Name != t.Name &&
            await db.Tasks.AnyAsync(x => x.ProjectId == t.ProjectId && x.Name == req.Name))
            return Conflict(new { message = $"Task '{req.Name}' already exists in this project." });

        t.Name = req.Name;
        t.Description = req.Description;
        t.Status = req.Status;
        t.SortOrder = req.SortOrder;
        t.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(ToDto(t));
    }

    [HttpDelete("tasks/{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var t = await db.Tasks.FindAsync(id);
        if (t is null) return NotFound();
        db.Tasks.Remove(t);   // cascades to MandayEntry per schema FK
        await db.SaveChangesAsync();
        return NoContent();
    }
}
