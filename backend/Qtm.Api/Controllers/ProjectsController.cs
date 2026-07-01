using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

[ApiController]
[Route("api/v1/projects")]
[Authorize]
public class ProjectsController(QtmDbContext db) : ControllerBase
{
    private static readonly string[] ValidTypes = ["Implement", "Customize", "Training", "Other"];
    private static readonly string[] ValidStatuses = ["Open", "Hold", "Completed", "Cancel"];

    // Rolls the per-task view rows up to project level.
    // Remaining = (Sum Budget + Sum Adjust) - Sum Actual.
    private static ProjectDto ToDto(Project p, IEnumerable<TaskMandaySummary> sums)
    {
        var budget = sums.Sum(s => s.TotalBudget);
        var adjust = sums.Sum(s => s.TotalAdjust);
        var actual = sums.Sum(s => s.TotalActual);
        return new ProjectDto(p.ProjectId, p.Code, p.Name, p.Description,
            p.CustomerId, p.Customer?.Code, p.Customer?.Name,
            p.Type, p.Status, p.Progress,
            p.Revenue, p.StartDate, p.EndDate, budget, adjust, actual, (budget + adjust) - actual);
    }

    private static ActionResult? ValidateChoices(ProjectUpsert req, ControllerBase c)
    {
        if (!string.IsNullOrWhiteSpace(req.Type) && !ValidTypes.Contains(req.Type))
            return c.BadRequest(new { message = "Type ต้องเป็น Implement/Customize/Training/Other" });
        if (!string.IsNullOrWhiteSpace(req.Status) && !ValidStatuses.Contains(req.Status))
            return c.BadRequest(new { message = "Status ต้องเป็น Open/Hold/Completed/Cancel" });
        if (req.Progress is decimal pct && (pct < 0 || pct > 100))
            return c.BadRequest(new { message = "Progress ต้องอยู่ระหว่าง 0 ถึง 100" });
        return null;
    }

    // Rejects a CustomerId that doesn't exist. Null CustomerId (no customer) is allowed.
    private async Task<ActionResult?> CustomerNotFound(int? customerId)
    {
        if (customerId is int id && !await db.Customers.AnyAsync(c => c.CustomerId == id))
            return BadRequest(new { message = $"ไม่พบลูกค้า (CustomerId={id})" });
        return null;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProjectDto>>> List()
    {
        var items = await db.Projects.Include(p => p.Customer).OrderBy(p => p.Code).ToListAsync();
        var sums = (await db.TaskMandaySummaries.ToListAsync())
            .GroupBy(s => s.ProjectId)
            .ToDictionary(g => g.Key, g => g.ToList());
        return Ok(items.Select(p => ToDto(p, sums.GetValueOrDefault(p.ProjectId, []))));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ProjectDto>> Get(int id)
    {
        var p = await db.Projects.Include(x => x.Customer).FirstOrDefaultAsync(x => x.ProjectId == id);
        if (p is null) return NotFound();
        var sums = await db.TaskMandaySummaries.Where(s => s.ProjectId == id).ToListAsync();
        return Ok(ToDto(p, sums));
    }

    [HttpGet("{id:int}/summary")]
    public async Task<ActionResult<IEnumerable<TaskSummaryDto>>> Summary(int id)
    {
        if (!await db.Projects.AnyAsync(p => p.ProjectId == id))
            return NotFound();

        var rows = await db.TaskMandaySummaries
            .Where(s => s.ProjectId == id)
            .ToListAsync();

        return Ok(rows.Select(s => new TaskSummaryDto(
            s.TaskId, s.TaskName, s.TotalBudget, s.TotalActual, s.TotalAdjust, s.Remaining)));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ProjectDto>> Create(ProjectUpsert req)
    {
        if (ValidateChoices(req, this) is { } bad) return bad;
        if (await CustomerNotFound(req.CustomerId) is { } cbad) return cbad;
        if (await db.Projects.AnyAsync(p => p.Code == req.Code))
            return Conflict(new { message = $"Project code '{req.Code}' already exists." });

        var p = new Project
        {
            Code = req.Code,
            Name = req.Name,
            Description = req.Description,
            CustomerId = req.CustomerId,
            Type = string.IsNullOrWhiteSpace(req.Type) ? null : req.Type,
            Status = string.IsNullOrWhiteSpace(req.Status) ? "Open" : req.Status,
            Progress = req.Progress,
            Revenue = req.Revenue,
            StartDate = req.StartDate,
            EndDate = req.EndDate,
            CreatedAt = DateTime.UtcNow,
        };
        db.Projects.Add(p);
        await db.SaveChangesAsync();
        await db.Entry(p).Reference(x => x.Customer).LoadAsync();
        return CreatedAtAction(nameof(Get), new { id = p.ProjectId }, ToDto(p, []));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ProjectDto>> Update(int id, ProjectUpsert req)
    {
        if (ValidateChoices(req, this) is { } bad) return bad;
        if (await CustomerNotFound(req.CustomerId) is { } cbad) return cbad;
        var p = await db.Projects.FindAsync(id);
        if (p is null) return NotFound();

        if (req.Code != p.Code && await db.Projects.AnyAsync(x => x.Code == req.Code))
            return Conflict(new { message = $"Project code '{req.Code}' already exists." });

        p.Code = req.Code;
        p.Name = req.Name;
        p.Description = req.Description;
        p.CustomerId = req.CustomerId;
        p.Type = string.IsNullOrWhiteSpace(req.Type) ? null : req.Type;
        p.Status = string.IsNullOrWhiteSpace(req.Status) ? "Open" : req.Status;
        p.Progress = req.Progress;
        p.Revenue = req.Revenue;
        p.StartDate = req.StartDate;
        p.EndDate = req.EndDate;
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await db.Entry(p).Reference(x => x.Customer).LoadAsync();
        var sums = await db.TaskMandaySummaries.Where(s => s.ProjectId == p.ProjectId).ToListAsync();
        return Ok(ToDto(p, sums));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.Projects.FindAsync(id);
        if (p is null) return NotFound();
        db.Projects.Remove(p);   // cascades to Task -> MandayEntry per schema FKs
        await db.SaveChangesAsync();
        return NoContent();
    }
}
