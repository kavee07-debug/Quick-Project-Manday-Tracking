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
/// D365 Business Central integration (Admin only). Configure the connection, pull candidate
/// projects into a staging table, review/edit them, then promote rows to real Projects.
/// </summary>
[ApiController]
[Route("api/v1/d365")]
[Authorize(Roles = Roles.Admin)]
public class D365Controller(QtmDbContext db, D365BcClient client, D365JobService jobs) : ControllerBase
{
    private static readonly string[] ValidTypes = ["Implement", "Customize", "Training", "Other"];

    // Normalises a Type: blank -> null; invalid -> null (so it never violates CK_Project_Type).
    private static string? NormalizeType(string? type) =>
        !string.IsNullOrWhiteSpace(type) && ValidTypes.Contains(type) ? type : null;

    // ---------- Settings ----------
    [HttpGet("settings")]
    public async Task<ActionResult<D365SettingDto>> GetSettings(CancellationToken ct)
        => Ok(ToDto(await LoadSettingsAsync(ct)));

    [HttpPut("settings")]
    public async Task<ActionResult<D365SettingDto>> SaveSettings(D365SettingUpsert req, CancellationToken ct)
    {
        var s = await LoadSettingsAsync(ct);
        s.TenantId = req.TenantId.Trim();
        s.EnvironmentId = req.EnvironmentId.Trim();
        s.CompanyId = req.CompanyId.Trim();
        s.ClientId = req.ClientId.Trim();
        // Blank secret keeps the currently-stored one (mirrors DB Config behaviour).
        if (!string.IsNullOrEmpty(req.ClientSecret)) s.ClientSecret = req.ClientSecret;
        s.ApiPublisher = req.ApiPublisher.Trim();
        s.ApiGroup = req.ApiGroup.Trim();
        s.ApiVersion = req.ApiVersion.Trim();
        s.ProjectManagerCodes = req.ProjectManagerCodes.Trim();
        s.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(s));
    }

    [HttpPost("settings/test")]
    public async Task<ActionResult<D365TestResult>> TestSettings(D365SettingUpsert req, CancellationToken ct)
    {
        // Test against the posted values, keeping the stored secret when the field is blank.
        var current = await LoadSettingsAsync(ct);
        var probe = new D365BcSetting
        {
            TenantId = req.TenantId.Trim(),
            ClientId = req.ClientId.Trim(),
            ClientSecret = string.IsNullOrEmpty(req.ClientSecret) ? current.ClientSecret : req.ClientSecret,
        };
        try
        {
            await client.GetTokenAsync(probe, ct);
            return Ok(new D365TestResult(true, "ขอ access token สำเร็จ — เชื่อมต่อ D365BC ได้"));
        }
        catch (D365BcException ex)
        {
            return Ok(new D365TestResult(false, ex.Message));
        }
    }

    // ---------- Max project code (shown on the API Job screen) ----------
    [HttpGet("max-project-code")]
    public async Task<ActionResult<object>> GetMaxProjectCode(CancellationToken ct)
        => Ok(new { code = await jobs.GetMaxProjectCodeAsync(ct) });

    // ---------- Staging ----------
    [HttpGet("staging")]
    public async Task<ActionResult<IEnumerable<D365StagingDto>>> ListStaging(CancellationToken ct)
    {
        var rows = await db.D365ProjectStagings
            .Include(x => x.Tasks)
            .OrderBy(x => x.JobNo)
            .ToListAsync(ct);
        // Map JobNo -> existing Project (case-insensitive) to flag duplicates.
        var byCode = await db.Projects
            .Select(p => new { p.ProjectId, p.Code })
            .ToListAsync(ct);
        var lookup = byCode.ToDictionary(p => p.Code.ToLowerInvariant(), p => p.ProjectId);

        return Ok(rows.Select(r =>
        {
            lookup.TryGetValue(r.JobNo.ToLowerInvariant(), out var existingId);
            var exists = existingId != 0;
            return new D365StagingDto(r.StagingId, r.JobNo, r.ProjectName, r.ProjectManagerCode,
                r.CustomerNo, r.CustomerName, r.Type, r.Revenue, r.FetchedAt, exists, exists ? existingId : null,
                r.Tasks.OrderBy(t => t.SortOrder)
                    .Select(t => new D365TaskStagingDto(t.TaskStagingId, t.TaskNo, t.TaskDescription, t.ItemCategoryCode, t.Revenue)).ToList());
        }));
    }

    [HttpPost("staging/fetch")]
    public async Task<ActionResult<D365FetchResult>> Fetch(CancellationToken ct)
    {
        try { return Ok(await jobs.FetchAsync(ct)); }
        catch (D365BcException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Pull a single job by number (ignores the "no gt maxCode" filter; PM filter still applies).
    [HttpPost("staging/fetch-by-job")]
    public async Task<ActionResult<D365FetchResult>> FetchByJob(FetchByJobRequest req, CancellationToken ct)
    {
        try { return Ok(await jobs.FetchByJobNoAsync(req.JobNo, ct)); }
        catch (D365BcException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("staging/{id:int}")]
    public async Task<ActionResult<D365StagingDto>> UpdateStaging(int id, D365StagingUpsert req, CancellationToken ct)
    {
        var row = await db.D365ProjectStagings.FindAsync([id], ct);
        if (row is null) return NotFound();

        var jobNo = req.JobNo.Trim();
        if (string.IsNullOrWhiteSpace(jobNo))
            return BadRequest(new { message = "กรุณาระบุ Job No" });
        if (jobNo != row.JobNo && await db.D365ProjectStagings.AnyAsync(x => x.JobNo == jobNo, ct))
            return Conflict(new { message = $"มี Job No '{jobNo}' ในรายการอยู่แล้ว" });

        if (req.Revenue is decimal rev && rev < 0)
            return BadRequest(new { message = "Revenue ต้องไม่ติดลบ" });

        row.JobNo = jobNo;
        row.ProjectName = string.IsNullOrWhiteSpace(req.ProjectName) ? null : req.ProjectName.Trim();
        row.CustomerNo = string.IsNullOrWhiteSpace(req.CustomerNo) ? null : req.CustomerNo.Trim();
        row.CustomerName = string.IsNullOrWhiteSpace(req.CustomerName) ? null : req.CustomerName.Trim();
        row.Type = NormalizeType(req.Type);
        row.Revenue = req.Revenue;
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var exists = await db.Projects.AnyAsync(p => p.Code == row.JobNo, ct);
        var existingId = exists
            ? await db.Projects.Where(p => p.Code == row.JobNo).Select(p => (int?)p.ProjectId).FirstOrDefaultAsync(ct)
            : null;
        var tasks = await db.D365TaskStagings.Where(t => t.StagingId == row.StagingId)
            .OrderBy(t => t.SortOrder)
            .Select(t => new D365TaskStagingDto(t.TaskStagingId, t.TaskNo, t.TaskDescription, t.ItemCategoryCode, t.Revenue))
            .ToListAsync(ct);
        return Ok(new D365StagingDto(row.StagingId, row.JobNo, row.ProjectName, row.ProjectManagerCode,
            row.CustomerNo, row.CustomerName, row.Type, row.Revenue, row.FetchedAt, exists, existingId, tasks));
    }

    [HttpDelete("staging/{id:int}")]
    public async Task<IActionResult> DeleteStaging(int id, CancellationToken ct)
    {
        var row = await db.D365ProjectStagings.FindAsync([id], ct);
        if (row is null) return NotFound();
        db.D365ProjectStagings.Remove(row);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    // Bulk delete the selected staging rows.
    [HttpPost("staging/delete")]
    public async Task<ActionResult<object>> DeleteSelected(StagingIdsRequest req, CancellationToken ct)
    {
        var ids = req.Ids ?? [];
        if (ids.Length == 0) return Ok(new { deleted = 0 });
        var rows = await db.D365ProjectStagings.Where(x => ids.Contains(x.StagingId)).ToListAsync(ct);
        db.D365ProjectStagings.RemoveRange(rows);
        await db.SaveChangesAsync(ct);
        return Ok(new { deleted = rows.Count });
    }

    [HttpPost("staging/{id:int}/create-project")]
    public async Task<ActionResult<ProjectDto>> CreateProject(int id, CancellationToken ct)
    {
        var row = await db.D365ProjectStagings.FindAsync([id], ct);
        if (row is null) return NotFound();
        if (await db.Projects.AnyAsync(p => p.Code == row.JobNo, ct))
            return Conflict(new { message = $"มี Project code '{row.JobNo}' อยู่แล้ว — ไม่สร้างซ้ำ" });

        // Auto-create the customer when its code is new (mirrors the Excel import behaviour).
        var customer = await ResolveCustomerAsync(row.CustomerNo, row.CustomerName, null, ct);
        var p = NewProject(row, customer);
        var stagedTasks = await db.D365TaskStagings.Where(t => t.StagingId == row.StagingId).ToListAsync(ct);
        AddStagedTasks(p, stagedTasks);
        db.Projects.Add(p);
        db.D365ProjectStagings.Remove(row);   // promoted -> drop from staging (tasks cascade)
        await db.SaveChangesAsync(ct);

        return CreatedAtAction("Get", "Projects", new { id = p.ProjectId },
            new ProjectDto(p.ProjectId, p.Code, p.Name, p.Description,
                p.CustomerId, customer?.Code, customer?.Name,
                p.Type, p.Status, p.Progress, p.Revenue, p.TimesheetMapping, p.TrainingDate, p.StartDate, p.EndDate, 0, 0, 0, 0));
    }

    // Update an EXISTING project from its staged row: refresh Name/Customer/Type/Revenue, create-or-update
    // its tasks (revenue-bearing only), auto-create the customer if new, then drop the staging row.
    [HttpPost("staging/{id:int}/update-project")]
    public async Task<ActionResult<object>> UpdateProject(int id, CancellationToken ct)
    {
        var row = await db.D365ProjectStagings.FindAsync([id], ct);
        if (row is null) return NotFound();

        var project = await db.Projects.FirstOrDefaultAsync(p => p.Code == row.JobNo, ct);
        if (project is null)
            return NotFound(new { message = $"ไม่พบ Project code '{row.JobNo}' — ใช้ปุ่ม “สร้างเป็น Project” แทน" });

        // Auto-create the customer when its code is new (same rule as create).
        var customer = await ResolveCustomerAsync(row.CustomerNo, row.CustomerName, null, ct);
        if (customer is not null) project.Customer = customer;
        if (!string.IsNullOrWhiteSpace(row.ProjectName)) project.Name = row.ProjectName!.Trim();
        project.Type = NormalizeType(row.Type) ?? project.Type;
        if (row.Revenue is not null) project.Revenue = row.Revenue;
        project.UpdatedAt = DateTime.UtcNow;

        // Create-or-update tasks by TaskNo (Name). Revenue-bearing rows only; existing mandays untouched.
        var staged = await db.D365TaskStagings
            .Where(t => t.StagingId == row.StagingId && t.Revenue > 0m)
            .OrderBy(t => t.SortOrder)
            .ToListAsync(ct);
        var byName = (await db.Tasks.Where(t => t.ProjectId == project.ProjectId).ToListAsync(ct))
            .ToDictionary(t => t.Name, t => t, StringComparer.OrdinalIgnoreCase);
        var createdTasks = 0;
        var updatedTasks = 0;
        foreach (var st in staged)
        {
            if (byName.TryGetValue(st.TaskNo, out var t))
            {
                t.Description = st.TaskDescription;
                t.ItemCategoryCode = st.ItemCategoryCode;
                t.Revenue = st.Revenue;
                t.SortOrder = st.SortOrder;
                t.UpdatedAt = DateTime.UtcNow;
                updatedTasks++;
            }
            else
            {
                var nt = new TaskItem
                {
                    ProjectId = project.ProjectId,
                    Name = st.TaskNo,
                    Description = st.TaskDescription,
                    ItemCategoryCode = st.ItemCategoryCode,
                    Revenue = st.Revenue,
                    Status = "Open",
                    SortOrder = st.SortOrder,
                    CreatedAt = DateTime.UtcNow,
                };
                db.Tasks.Add(nt);
                byName[st.TaskNo] = nt;   // dedupe within this batch
                createdTasks++;
            }
        }

        db.D365ProjectStagings.Remove(row);   // applied -> drop from staging (task staging cascades)
        await db.SaveChangesAsync(ct);

        return Ok(new { projectId = project.ProjectId, tasksCreated = createdTasks, tasksUpdated = updatedTasks });
    }

    // Promote all non-duplicate staged rows.
    [HttpPost("staging/create-eligible")]
    public async Task<ActionResult<CreateProjectsResult>> CreateEligible(CancellationToken ct)
    {
        var rows = await db.D365ProjectStagings.OrderBy(x => x.JobNo).ToListAsync(ct);
        return Ok(await CreateProjectsFromAsync(rows, ct));
    }

    // Promote only the selected staged rows (duplicates among them are skipped).
    [HttpPost("staging/create-selected")]
    public async Task<ActionResult<CreateProjectsResult>> CreateSelected(StagingIdsRequest req, CancellationToken ct)
    {
        var ids = req.Ids ?? [];
        if (ids.Length == 0) return Ok(new CreateProjectsResult(0, 0, []));
        var rows = await db.D365ProjectStagings
            .Where(x => ids.Contains(x.StagingId))
            .OrderBy(x => x.JobNo)
            .ToListAsync(ct);
        return Ok(await CreateProjectsFromAsync(rows, ct));
    }

    // Shared promote: skips rows whose JobNo is already a Project.Code, auto-creates customers, carries
    // revenue-bearing tasks, and deletes each promoted staging row (its task rows cascade).
    private async Task<CreateProjectsResult> CreateProjectsFromAsync(List<D365ProjectStaging> rows, CancellationToken ct)
    {
        var existing = (await db.Projects.Select(p => p.Code).ToListAsync(ct))
            .Select(c => c.ToLowerInvariant()).ToHashSet();
        // Cache customers by code (case-insensitive) so repeated codes reuse the same new customer.
        var customerCache = (await db.Customers.ToListAsync(ct))
            .ToDictionary(c => c.Code, c => c, StringComparer.OrdinalIgnoreCase);
        // Staged tasks grouped by parent, so each promoted project carries its tasks.
        var tasksByStaging = (await db.D365TaskStagings.ToListAsync(ct))
            .GroupBy(t => t.StagingId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var created = 0;
        var skipped = 0;
        var errors = new List<string>();

        foreach (var row in rows)
        {
            if (existing.Contains(row.JobNo.ToLowerInvariant())) { skipped++; continue; }
            var customer = await ResolveCustomerAsync(row.CustomerNo, row.CustomerName, customerCache, ct);
            var p = NewProject(row, customer);
            AddStagedTasks(p, tasksByStaging.GetValueOrDefault(row.StagingId) ?? []);
            db.Projects.Add(p);
            db.D365ProjectStagings.Remove(row);
            existing.Add(row.JobNo.ToLowerInvariant());
            created++;
        }

        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex)
        {
            errors.Add(ex.InnerException?.Message ?? ex.Message);
            return new CreateProjectsResult(0, skipped, errors);
        }
        return new CreateProjectsResult(created, skipped, errors);
    }

    // ---------- Master Item (BC pull) ----------
    // Sync the item master from BC. Master CRUD/list lives in MasterItemsController; the pull is
    // here so all BC calls stay Admin-only alongside the settings.
    [HttpPost("items/fetch")]
    public async Task<ActionResult<MasterItemFetchResult>> FetchItems(CancellationToken ct)
    {
        try { return Ok(await jobs.FetchItemsAsync(ct)); }
        catch (D365BcException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ---------- helpers ----------
    // Adds the staged job tasks to a (not-yet-saved) project: TaskNo -> Name, description -> Description.
    // Only tasks that carry revenue (> 0) are promoted — LICENSE/zero-revenue tasks are skipped.
    private static void AddStagedTasks(Project p, IEnumerable<D365TaskStaging> tasks)
    {
        foreach (var t in tasks.Where(t => t.Revenue > 0m).OrderBy(t => t.SortOrder))
            p.Tasks.Add(new TaskItem
            {
                Name = t.TaskNo,
                Description = t.TaskDescription,
                ItemCategoryCode = t.ItemCategoryCode,
                Revenue = t.Revenue,
                Status = "Open",
                SortOrder = t.SortOrder,
                CreatedAt = DateTime.UtcNow,
            });
    }

    private static Project NewProject(D365ProjectStaging row, Customer? customer) => new()
    {
        Code = row.JobNo,
        Name = string.IsNullOrWhiteSpace(row.ProjectName) ? row.JobNo : row.ProjectName!,
        Customer = customer,
        Type = NormalizeType(row.Type),
        Revenue = row.Revenue,
        TimesheetMapping = row.JobNo,   // default map key = the project code
        Status = "Open",
        CreatedAt = DateTime.UtcNow,
    };

    // Resolves a customer by code; auto-creates it when the code is new (name falls back to code).
    // Pass a cache to dedupe new customers across a batch (create-eligible).
    private async Task<Customer?> ResolveCustomerAsync(string? code, string? name,
        Dictionary<string, Customer>? cache, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        code = code.Trim();
        if (cache is not null && cache.TryGetValue(code, out var cached)) return cached;

        var customer = await db.Customers.FirstOrDefaultAsync(c => c.Code == code, ct);
        if (customer is null)
        {
            customer = new Customer
            {
                Code = code,
                Name = string.IsNullOrWhiteSpace(name) ? code : name.Trim(),
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
            };
            db.Customers.Add(customer);
        }
        if (cache is not null) cache[code] = customer;
        return customer;
    }

    private async Task<D365BcSetting> LoadSettingsAsync(CancellationToken ct)
    {
        var s = await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct);
        if (s is null)
        {
            s = new D365BcSetting { Id = 1, UpdatedAt = DateTime.UtcNow };
            db.D365BcSettings.Add(s);
            await db.SaveChangesAsync(ct);
        }
        return s;
    }

    private static D365SettingDto ToDto(D365BcSetting s) => new(
        s.TenantId, s.EnvironmentId, s.CompanyId, s.ClientId,
        HasClientSecret: !string.IsNullOrEmpty(s.ClientSecret),
        s.ApiPublisher, s.ApiGroup, s.ApiVersion, s.ProjectManagerCodes);
}
