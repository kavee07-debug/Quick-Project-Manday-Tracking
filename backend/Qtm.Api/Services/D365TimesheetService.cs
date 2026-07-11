using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Services;

/// <summary>
/// Orchestrates the D365BC timesheet pull and the "apply to Actual manday" step.
/// Fetch: token → entitySetTimesheettoPowerBI (year + date range + resourceGroupNo contains 'CD')
/// → upsert into D365TimesheetStaging by SystemId. Apply: create Actual MandayEntry rows from the
/// staged lines (mapped via New Job/New Task), stamping the timesheet SystemId + apply datetime.
/// </summary>
public class D365TimesheetService(QtmDbContext db, D365BcClient client)
{
    public async Task<D365TimesheetFetchResult> FetchAsync(DateOnly start, DateOnly end, CancellationToken ct = default)
    {
        if (start.Year != end.Year)
            throw new D365BcException("Start Date และ End Date ต้องเป็นปีเดียวกัน");
        if (end < start)
            throw new D365BcException("End Date ต้องไม่ก่อน Start Date");

        var s = await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct)
            ?? throw new D365BcException("ยังไม่ได้ตั้งค่าการเชื่อมต่อ D365BC (หน้า Setup)");

        var inserted = 0;
        var updated = 0;
        var errors = new List<string>();
        var rows = new List<D365Timesheet>();

        try
        {
            var token = await client.GetTokenAsync(s, ct);
            rows = await client.GetTimesheetsAsync(s, token, start, end, ct);

            var ids = rows.Select(r => r.SystemId).ToList();
            var existing = await db.D365TimesheetStagings
                .Where(x => ids.Contains(x.SystemId))
                .ToDictionaryAsync(x => x.SystemId, x => x, StringComparer.OrdinalIgnoreCase, ct);

            foreach (var t in rows)
            {
                if (existing.TryGetValue(t.SystemId, out var row))
                {
                    // Refresh API fields; keep the user's New Job/New Task edits.
                    row.JobNo = t.JobNo;
                    row.JobTaskNo = t.JobTaskNo;
                    row.TimesheetDate = t.StartDate;
                    row.ResourceNo = t.No;
                    row.QuantityHour = t.Quantity;
                    row.QuantityMD = t.QuantityMD;
                    row.Comment = t.Comment;
                    row.ProjectManager = t.ProjectManager;
                    row.TimesheetStatus = t.TimesheetStatus;
                    row.RawJson = t.RawJson;
                    row.FetchedAt = DateTime.UtcNow;
                    row.UpdatedAt = DateTime.UtcNow;
                    updated++;
                }
                else
                {
                    db.D365TimesheetStagings.Add(new D365TimesheetStaging
                    {
                        SystemId = t.SystemId,
                        JobNo = t.JobNo,
                        JobTaskNo = t.JobTaskNo,
                        TimesheetDate = t.StartDate,
                        ResourceNo = t.No,
                        QuantityHour = t.Quantity,
                        QuantityMD = t.QuantityMD,
                        Comment = t.Comment,
                        ProjectManager = t.ProjectManager,
                        TimesheetStatus = t.TimesheetStatus,
                        NewJobNo = t.JobNo,        // default = API value, editable
                        NewTaskNo = t.JobTaskNo,   // default = API value, editable
                        RawJson = t.RawJson,
                        FetchedAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow,
                    });
                    inserted++;
                }
            }

            await db.SaveChangesAsync(ct);
            await LogAsync("Success", $"year={start.Year}, range={start:yyyy-MM-dd}..{end:yyyy-MM-dd}, "
                + $"fetched={rows.Count}, inserted={inserted}, updated={updated}", ct);
        }
        catch (D365BcException ex)
        {
            await LogAsync("Failed", ex.Message, ct);
            throw;
        }

        return new D365TimesheetFetchResult(rows.Count, inserted, updated, start.Year.ToString(), errors);
    }

    /// <summary>
    /// Apply the selected staged lines as Actual MandayEntry rows under the mapped Project/Task.
    /// Idempotent: rows whose SystemId already exists in MandayEntry.SourceSystemId are skipped.
    /// </summary>
    public async Task<D365ApplyResult> ApplyAsync(int[] ids, CancellationToken ct = default)
    {
        if (ids is null || ids.Length == 0) return new D365ApplyResult(0, 0, []);

        var rows = await db.D365TimesheetStagings.Where(x => ids.Contains(x.TimesheetStagingId)).ToListAsync(ct);

        // SystemIds already applied (present as an Actual manday) — for idempotency.
        var appliedIds = (await db.MandayEntries
                .Where(m => m.SourceSystemId != null)
                .Select(m => m.SourceSystemId!)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Project code -> id, and (projectId, taskName) -> taskId (case-insensitive).
        var projects = (await db.Projects.Select(p => new { p.ProjectId, p.Code }).ToListAsync(ct))
            .ToDictionary(p => p.Code, p => p.ProjectId, StringComparer.OrdinalIgnoreCase);
        var tasks = (await db.Tasks.Select(t => new { t.TaskId, t.ProjectId, t.Name }).ToListAsync(ct))
            .ToDictionary(t => (t.ProjectId, t.Name.ToLowerInvariant()), t => t.TaskId);
        var resourceCache = (await db.Resources.ToListAsync(ct))
            .ToDictionary(r => r.Code, r => r, StringComparer.OrdinalIgnoreCase);

        var applied = 0;
        var skipped = 0;
        var errors = new List<string>();

        // Rows still to apply (not already in Actual). Already-applied rows are skipped, not errors.
        var toApply = new List<(D365TimesheetStaging Row, int TaskId)>();
        var validationErrors = new List<string>();

        foreach (var row in rows)
        {
            if (appliedIds.Contains(row.SystemId)) { skipped++; continue; }   // already in Actual

            var jobNo = (row.NewJobNo ?? "").Trim();
            var taskNo = (row.NewTaskNo ?? "").Trim();
            if (jobNo.Length == 0 || !projects.TryGetValue(jobNo, out var projectId))
            {
                validationErrors.Add($"{row.SystemId}: ไม่พบ Project '{row.NewJobNo}'"); continue;
            }
            if (taskNo.Length == 0 || !tasks.TryGetValue((projectId, taskNo.ToLowerInvariant()), out var taskId))
            {
                validationErrors.Add($"{row.SystemId}: ไม่พบ Task '{row.NewTaskNo}' ใน Project '{jobNo}'"); continue;
            }
            toApply.Add((row, taskId));
        }

        // Validate New Job/New Task must pass for every selected (not-yet-applied) row — else abort
        // the whole apply so nothing is partially committed.
        if (validationErrors.Count > 0)
        {
            await LogAsync("Failed", $"apply validate-new: {validationErrors.Count} รายการไม่ผ่าน", ct);
            throw new D365BcException(
                "ไม่สามารถ Apply ได้: New Job No / New Task ไม่ผ่านการตรวจสอบ\n" + string.Join("\n", validationErrors));
        }

        foreach (var (row, taskId) in toApply)
        {
            var resourceId = await ResolveResourceIdAsync(row.ResourceNo, resourceCache);

            db.MandayEntries.Add(new MandayEntry
            {
                TaskId = taskId,
                EntryType = "Actual",
                ResourceId = resourceId,
                Manday = row.QuantityMD ?? 0m,
                EntryDate = row.TimesheetDate,
                StartDate = row.TimesheetDate,
                EndDate = row.TimesheetDate,
                Note = row.Comment,
                SourceSystemId = row.SystemId,
                AppliedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
            });
            appliedIds.Add(row.SystemId);   // guard against duplicate systemIds within this batch
            applied++;
        }

        // Remove applied rows from staging (both just-applied and any selected that were already in
        // Actual). Idempotency is preserved by MandayEntry.SourceSystemId, which lives on the Actual.
        var toRemove = rows.Where(r => appliedIds.Contains(r.SystemId)).ToList();
        db.D365TimesheetStagings.RemoveRange(toRemove);

        await db.SaveChangesAsync(ct);
        await LogAsync("Success", $"apply: applied={applied}, skipped={skipped}, removed={toRemove.Count}, errors={errors.Count}", ct);
        return new D365ApplyResult(applied, skipped, errors);
    }

    /// <summary>
    /// Auto-map the selected staged rows: for each row, build the key "JobNo,JobTaskNo" (from the
    /// original API values) and look it up against every project's TimesheetMapping. On a hit, set
    /// NewJobNo = the matched project's Code and NewTaskNo = the timesheet's Task No. Rows with no
    /// match are left unchanged.
    /// </summary>
    public async Task<D365TimesheetAutoMapResult> AutoMapAsync(int[] ids, CancellationToken ct = default)
    {
        if (ids is null || ids.Length == 0) return new D365TimesheetAutoMapResult(0, 0);

        var rows = await db.D365TimesheetStagings.Where(x => ids.Contains(x.TimesheetStagingId)).ToListAsync(ct);

        // Build "JobNo,TaskNo" key -> Project.Code from every project's TimesheetMapping.
        // A project may list several keys separated by ';' or newline. First project wins on a clash.
        var map = new Dictionary<string, string>();
        var projects = await db.Projects
            .Where(p => p.TimesheetMapping != null && p.TimesheetMapping != "")
            .Select(p => new { p.Code, p.TimesheetMapping })
            .ToListAsync(ct);
        foreach (var p in projects)
        {
            foreach (var entry in p.TimesheetMapping!.Split([';', '\n', '\r'],
                         StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var key = NormKey(entry);
                if (key.Length > 0 && !map.ContainsKey(key)) map[key] = p.Code;
            }
        }

        var mapped = 0;
        var unmatched = 0;
        foreach (var row in rows)
        {
            var key = NormKey($"{row.JobNo},{row.JobTaskNo}");
            if (map.TryGetValue(key, out var code))
            {
                row.NewJobNo = code;
                row.NewTaskNo = string.IsNullOrWhiteSpace(row.JobTaskNo) ? null : row.JobTaskNo!.Trim();
                row.UpdatedAt = DateTime.UtcNow;
                mapped++;
            }
            else unmatched++;
        }

        await db.SaveChangesAsync(ct);
        await LogAsync("Success", $"auto-map: mapped={mapped}, unmatched={unmatched}", ct);
        return new D365TimesheetAutoMapResult(mapped, unmatched);
    }

    // Normalise a "JobNo,TaskNo" mapping key: trim each comma-part, lowercase, rejoin with ','.
    private static string NormKey(string s) =>
        string.Join(",", s.Split(',').Select(p => p.Trim())).ToLowerInvariant();

    // Resolves a resource by code; auto-creates it when the code is new (name falls back to the code).
    // Null when the timesheet has no resource no. Uses a cache so repeats reuse the same new resource.
    private async Task<int?> ResolveResourceIdAsync(string? code, Dictionary<string, ResourceItem> cache)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        code = code.Trim();
        if (cache.TryGetValue(code, out var cached))
            return cached.ResourceId == 0 ? null : cached.ResourceId;   // freshly-added: id assigned on save

        var resource = new ResourceItem { Code = code, Name = code, IsActive = true };
        db.Resources.Add(resource);
        await db.SaveChangesAsync();   // assign ResourceId so the MandayEntry FK is set this batch
        cache[code] = resource;
        return resource.ResourceId;
    }

    private async Task LogAsync(string status, string message, CancellationToken ct)
    {
        try
        {
            db.D365SyncLogs.Add(new D365SyncLog
            {
                EntityName = "Timesheet",
                Direction = "IN",
                Status = status,
                Message = message,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync(ct);
        }
        catch { /* logging must never mask the real outcome */ }
    }
}
