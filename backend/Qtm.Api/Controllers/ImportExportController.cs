using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;
using Qtm.Api.Services;

namespace Qtm.Api.Controllers;

/// <summary>
/// Excel (.xlsx) import/export for Project, Task and Estimate &amp; Actual (manday) data.
/// Columns mirror the manday data model (Project, Task, Type, Resource, Manday).
/// Projects/Tasks import = upsert by natural key; Manday import = append (bulk load).
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public class ImportExportController(QtmDbContext db, ExcelService excel) : ControllerBase
{
    private static readonly string[] ValidTypes = ["Budget", "Actual", "Adjust"];
    private static readonly string[] ValidProjectTypes = ["Implement", "Customize", "Training", "Other"];
    private static readonly string[] ValidProjectStatuses = ["Open", "Hold", "Completed", "Cancel"];

    private FileContentResult Xlsx(byte[] bytes, string name) =>
        File(bytes, ExcelService.ContentTypeXlsx, name);

    // ============================ Projects ============================
    [HttpGet("export/projects")]
    public async Task<IActionResult> ExportProjects()
    {
        var rows = await db.Projects.OrderBy(p => p.Code)
            .Select(p => new ProjectRow(p.Code, p.Name, p.Description, p.Type, p.Status, p.Revenue, p.StartDate, p.EndDate))
            .ToListAsync();
        return Xlsx(excel.WriteProjects(rows), "projects.xlsx");
    }

    [HttpPost("import/projects")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> ImportProjects(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        List<ProjectRow> rows;
        using (var s = file.OpenReadStream()) rows = excel.ReadProjects(s);

        int created = 0, updated = 0, skipped = 0;
        var errors = new List<string>();
        var line = 1;

        foreach (var row in rows)
        {
            line++;
            if (string.IsNullOrWhiteSpace(row.Code) || string.IsNullOrWhiteSpace(row.Name))
            {
                errors.Add($"แถว {line}: ต้องมี Code และ Name");
                skipped++;
                continue;
            }
            var type = string.IsNullOrWhiteSpace(row.Type) ? null : row.Type;
            if (type is not null && !ValidProjectTypes.Contains(type))
            {
                errors.Add($"แถว {line}: Type ต้องเป็น Implement/Customize/Training/Other (พบ '{row.Type}')");
                skipped++;
                continue;
            }
            var status = string.IsNullOrWhiteSpace(row.Status) ? "Open" : row.Status;
            if (!ValidProjectStatuses.Contains(status))
            {
                errors.Add($"แถว {line}: Status ต้องเป็น Open/Hold/Completed/Cancel (พบ '{row.Status}')");
                skipped++;
                continue;
            }

            var existing = await db.Projects.FirstOrDefaultAsync(p => p.Code == row.Code);
            if (existing is null)
            {
                db.Projects.Add(new Project
                {
                    Code = row.Code, Name = row.Name, Description = row.Description,
                    Type = type, Status = status, Revenue = row.Revenue,
                    StartDate = row.StartDate, EndDate = row.EndDate,
                    CreatedAt = DateTime.UtcNow,
                });
                created++;
            }
            else
            {
                existing.Name = row.Name;
                existing.Description = row.Description;
                existing.Type = type;
                existing.Status = status;
                existing.Revenue = row.Revenue;
                existing.StartDate = row.StartDate;
                existing.EndDate = row.EndDate;
                existing.UpdatedAt = DateTime.UtcNow;
                updated++;
            }
        }

        await db.SaveChangesAsync();
        return Ok(new ImportResult(created, updated, skipped, errors));
    }

    // ============================ Tasks ============================
    [HttpGet("export/tasks")]
    public async Task<IActionResult> ExportTasks([FromQuery] int? projectId)
    {
        var q = db.Tasks.Include(t => t.Project).AsQueryable();
        if (projectId is int pid) q = q.Where(t => t.ProjectId == pid);

        var rows = await q.OrderBy(t => t.Project!.Code).ThenBy(t => t.SortOrder)
            .Select(t => new TaskRow(t.Project!.Code, t.Name, t.Description, t.Status, t.SortOrder))
            .ToListAsync();
        return Xlsx(excel.WriteTasks(rows), "tasks.xlsx");
    }

    [HttpPost("import/tasks")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> ImportTasks(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        List<TaskRow> rows;
        using (var s = file.OpenReadStream()) rows = excel.ReadTasks(s);

        int created = 0, updated = 0, skipped = 0;
        var errors = new List<string>();
        var line = 1;

        foreach (var row in rows)
        {
            line++;
            if (string.IsNullOrWhiteSpace(row.ProjectCode) || string.IsNullOrWhiteSpace(row.TaskName))
            {
                errors.Add($"แถว {line}: ต้องมี Project และ Task");
                skipped++;
                continue;
            }

            var project = await db.Projects.FirstOrDefaultAsync(p => p.Code == row.ProjectCode);
            if (project is null)
            {
                errors.Add($"แถว {line}: ไม่พบโปรเจกต์ '{row.ProjectCode}'");
                skipped++;
                continue;
            }

            var existing = await db.Tasks
                .FirstOrDefaultAsync(t => t.ProjectId == project.ProjectId && t.Name == row.TaskName);
            if (existing is null)
            {
                db.Tasks.Add(new TaskItem
                {
                    ProjectId = project.ProjectId, Name = row.TaskName, Description = row.Description,
                    Status = row.Status, SortOrder = row.SortOrder, CreatedAt = DateTime.UtcNow,
                });
                created++;
            }
            else
            {
                existing.Description = row.Description;
                existing.Status = row.Status;
                existing.SortOrder = row.SortOrder;
                existing.UpdatedAt = DateTime.UtcNow;
                updated++;
            }
        }

        await db.SaveChangesAsync();
        return Ok(new ImportResult(created, updated, skipped, errors));
    }

    // ====================== Mandays (Estimate & Actual) ======================
    [HttpGet("export/mandays")]
    public async Task<IActionResult> ExportMandays([FromQuery] int? projectId)
    {
        var q = db.MandayEntries.Include(m => m.Task)!.ThenInclude(t => t!.Project)
            .Include(m => m.Resource).AsQueryable();
        if (projectId is int pid) q = q.Where(m => m.Task!.ProjectId == pid);

        var rows = await q
            .OrderBy(m => m.Task!.Project!.Code).ThenBy(m => m.Task!.Name).ThenBy(m => m.EntryType)
            .Select(m => new MandayRow(
                m.Task!.Project!.Code, m.Task!.Name, m.EntryType,
                m.Resource != null ? m.Resource.Name : null, m.Manday, m.StartDate, m.EndDate, m.Note))
            .ToListAsync();
        return Xlsx(excel.WriteMandays(rows), "estimate-actual.xlsx");
    }

    [HttpPost("import/mandays")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> ImportMandays(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        List<MandayRow> rows;
        using (var s = file.OpenReadStream()) rows = excel.ReadMandays(s);

        // Preload resources for case-insensitive name/code matching.
        var resources = await db.Resources.ToListAsync();

        int created = 0, skipped = 0;
        var errors = new List<string>();
        var line = 1;

        foreach (var row in rows)
        {
            line++;
            if (string.IsNullOrWhiteSpace(row.ProjectCode) || string.IsNullOrWhiteSpace(row.TaskName))
            {
                errors.Add($"แถว {line}: ต้องมี Project และ Task");
                skipped++;
                continue;
            }
            if (!ValidTypes.Contains(row.EntryType))
            {
                errors.Add($"แถว {line}: Type ต้องเป็น Budget/Actual/Adjust (พบ '{row.EntryType}')");
                skipped++;
                continue;
            }

            var task = await db.Tasks.Include(t => t.Project)
                .FirstOrDefaultAsync(t => t.Project!.Code == row.ProjectCode && t.Name == row.TaskName);
            if (task is null)
            {
                errors.Add($"แถว {line}: ไม่พบ task '{row.TaskName}' ในโปรเจกต์ '{row.ProjectCode}'");
                skipped++;
                continue;
            }

            int? resourceId = null;
            if (!string.IsNullOrWhiteSpace(row.ResourceName))
            {
                var res = resources.FirstOrDefault(r =>
                    string.Equals(r.Name, row.ResourceName, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(r.Code, row.ResourceName, StringComparison.OrdinalIgnoreCase));
                if (res is null)
                {
                    errors.Add($"แถว {line}: ไม่พบ resource '{row.ResourceName}'");
                    skipped++;
                    continue;
                }
                resourceId = res.ResourceId;
            }

            if (row.Manday < 0)
            {
                errors.Add($"แถว {line}: Manday ต้องไม่ติดลบ");
                skipped++;
                continue;
            }
            if (row.StartDate is DateOnly isd && row.EndDate is DateOnly ied && ied < isd)
            {
                errors.Add($"แถว {line}: End Date ต้องไม่ก่อน Start Date");
                skipped++;
                continue;
            }

            db.MandayEntries.Add(new MandayEntry
            {
                TaskId = task.TaskId, EntryType = row.EntryType, ResourceId = resourceId,
                Manday = row.Manday, StartDate = row.StartDate, EndDate = row.EndDate,
                Note = row.Note, CreatedAt = DateTime.UtcNow,
            });
            created++;
        }

        await db.SaveChangesAsync();
        return Ok(new ImportResult(created, 0, skipped, errors));
    }
}
