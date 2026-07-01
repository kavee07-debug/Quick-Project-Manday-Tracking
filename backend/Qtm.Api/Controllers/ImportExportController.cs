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
        var rows = await db.Projects.Include(p => p.Customer).OrderBy(p => p.Code)
            .Select(p => new ProjectRow(p.Code, p.Name,
                p.Customer != null ? p.Customer.Code : null,
                p.Customer != null ? p.Customer.Name : null,
                p.Description, p.Type, p.Status, p.Progress, p.Revenue, p.StartDate, p.EndDate))
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

        // Cache customers by code (case-insensitive). Auto-created customers are added here too,
        // so repeated codes within one import resolve to the same new customer.
        var customers = (await db.Customers.ToListAsync())
            .ToDictionary(c => c.Code, c => c, StringComparer.OrdinalIgnoreCase);

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
            if (row.Progress is decimal pct && (pct < 0 || pct > 100))
            {
                errors.Add($"แถว {line}: Progress ต้องอยู่ระหว่าง 0 ถึง 100 (พบ '{row.Progress}')");
                skipped++;
                continue;
            }

            // Resolve customer by code; auto-create it if the code is new (name falls back to code).
            Customer? customer = null;
            if (!string.IsNullOrWhiteSpace(row.CustomerCode))
            {
                if (!customers.TryGetValue(row.CustomerCode, out customer))
                {
                    customer = new Customer
                    {
                        Code = row.CustomerCode.Trim(),
                        Name = string.IsNullOrWhiteSpace(row.CustomerName) ? row.CustomerCode.Trim() : row.CustomerName.Trim(),
                        IsActive = true,
                        CreatedAt = DateTime.UtcNow,
                    };
                    db.Customers.Add(customer);
                    customers[customer.Code] = customer;
                }
            }

            var existing = await db.Projects.FirstOrDefaultAsync(p => p.Code == row.Code);
            if (existing is null)
            {
                db.Projects.Add(new Project
                {
                    Code = row.Code, Name = row.Name, Description = row.Description,
                    Customer = customer, Type = type, Status = status, Progress = row.Progress,
                    Revenue = row.Revenue, StartDate = row.StartDate, EndDate = row.EndDate,
                    CreatedAt = DateTime.UtcNow,
                });
                created++;
            }
            else
            {
                existing.Name = row.Name;
                existing.Description = row.Description;
                if (customer is not null) existing.Customer = customer;
                existing.Type = type;
                existing.Status = status;
                existing.Progress = row.Progress;
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

    // ==================== Progress update (Code, Name, Progress, Status) ====================
    [HttpGet("export/progress")]
    public async Task<IActionResult> ExportProgress()
    {
        var rows = await db.Projects.OrderBy(p => p.Code)
            .Select(p => new ProgressRow(p.Code, p.Name, p.Progress, p.Status))
            .ToListAsync();
        return Xlsx(excel.WriteProgress(rows), "progress.xlsx");
    }

    // Updates Progress (+ Status) of existing projects, matched by Code. Name is informational only.
    [HttpPost("import/progress")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> ImportProgress(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        List<ProgressRow> rows;
        using (var s = file.OpenReadStream()) rows = excel.ReadProgress(s);

        int updated = 0, skipped = 0;
        var errors = new List<string>();
        var line = 1;

        foreach (var row in rows)
        {
            line++;
            if (string.IsNullOrWhiteSpace(row.Code))
            {
                errors.Add($"แถว {line}: ต้องมี Project No");
                skipped++;
                continue;
            }
            if (row.Progress is decimal pct && (pct < 0 || pct > 100))
            {
                errors.Add($"แถว {line}: Progress ต้องอยู่ระหว่าง 0 ถึง 100 (พบ '{row.Progress}')");
                skipped++;
                continue;
            }
            var status = row.Status?.Trim();
            if (!string.IsNullOrWhiteSpace(status) && !ValidProjectStatuses.Contains(status))
            {
                errors.Add($"แถว {line}: Status ต้องเป็น Open/Hold/Completed/Cancel (พบ '{row.Status}')");
                skipped++;
                continue;
            }

            var project = await db.Projects.FirstOrDefaultAsync(p => p.Code == row.Code);
            if (project is null)
            {
                errors.Add($"แถว {line}: ไม่พบโปรเจกต์ '{row.Code}'");
                skipped++;
                continue;
            }

            project.Progress = row.Progress;
            if (!string.IsNullOrWhiteSpace(status)) project.Status = status;
            project.UpdatedAt = DateTime.UtcNow;
            updated++;
        }

        await db.SaveChangesAsync();
        return Ok(new ImportResult(0, updated, skipped, errors));
    }

    // ============================ Customers ============================
    [HttpGet("export/customers")]
    public async Task<IActionResult> ExportCustomers()
    {
        var rows = await db.Customers.OrderBy(c => c.Code)
            .Select(c => new CustomerRow(c.Code, c.Name, c.IsActive))
            .ToListAsync();
        return Xlsx(excel.WriteCustomers(rows), "customers.xlsx");
    }

    // Upsert customers by Code.
    [HttpPost("import/customers")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> ImportCustomers(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        List<CustomerRow> rows;
        using (var s = file.OpenReadStream()) rows = excel.ReadCustomers(s);

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

            var existing = await db.Customers.FirstOrDefaultAsync(c => c.Code == row.Code);
            if (existing is null)
            {
                db.Customers.Add(new Customer
                {
                    Code = row.Code.Trim(), Name = row.Name.Trim(), IsActive = row.IsActive,
                    CreatedAt = DateTime.UtcNow,
                });
                created++;
            }
            else
            {
                existing.Name = row.Name.Trim();
                existing.IsActive = row.IsActive;
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
