using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Services;

/// <summary>
/// Orchestrates the D365BC project pull: token → jobs (filtered by the greatest SOJ code
/// currently in Project) → per-job name → upsert into D365ProjectStaging. Logs each run
/// to D365SyncLog. HTTP details live in <see cref="D365BcClient"/>.
/// </summary>
public class D365JobService(QtmDbContext db, D365BcClient client)
{
    /// <summary>Greatest existing Project.Code beginning with "SOJ", or "SOJ" when none exist.</summary>
    public async Task<string> GetMaxProjectCodeAsync(CancellationToken ct = default)
    {
        var max = await db.Projects
            .Where(p => p.Code.StartsWith("SOJ"))
            .OrderByDescending(p => p.Code)
            .Select(p => p.Code)
            .FirstOrDefaultAsync(ct);
        return string.IsNullOrEmpty(max) ? "SOJ" : max;
    }

    /// <summary>Pull all new SOJ jobs (PM-filtered, no gt the greatest existing Project.Code).</summary>
    public async Task<D365FetchResult> FetchAsync(CancellationToken ct = default)
    {
        var s = await LoadSettingsAsync(ct);
        var maxCode = await GetMaxProjectCodeAsync(ct);
        var errors = new List<string>();
        var jobs = new List<D365Job>();
        var inserted = 0;
        var updated = 0;

        try
        {
            var token = await client.GetTokenAsync(s, ct);
            jobs = await client.GetJobsAsync(s, token, maxCode, ct);
            (inserted, updated) = await ProcessAndSaveJobsAsync(s, token, jobs, errors, ct);
            await LogAsync("Project", "Success",
                $"fetched={jobs.Count}, inserted={inserted}, updated={updated}, maxCode={maxCode}, errors={errors.Count}",
                ct);
        }
        catch (D365BcException ex)
        {
            await LogAsync("Project", "Failed", ex.Message, ct);
            throw;
        }

        return new D365FetchResult(jobs.Count, inserted, updated, maxCode, errors);
    }

    /// <summary>
    /// Pull one job by its exact number. Same pipeline as <see cref="FetchAsync"/> but the job query
    /// drops the "no" filter (startswith SOJ / no gt maxCode) and matches no eq the given number;
    /// the PM filter still applies.
    /// </summary>
    public async Task<D365FetchResult> FetchByJobNoAsync(string jobNo, CancellationToken ct = default)
    {
        jobNo = (jobNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(jobNo)) throw new D365BcException("กรุณาระบุเลข Job");

        var s = await LoadSettingsAsync(ct);
        var errors = new List<string>();
        var jobs = new List<D365Job>();
        var inserted = 0;
        var updated = 0;

        try
        {
            var token = await client.GetTokenAsync(s, ct);
            jobs = await client.GetJobByNoAsync(s, token, jobNo, ct);
            if (jobs.Count == 0) errors.Add($"ไม่พบ Job '{jobNo}' (หรือไม่ตรงเงื่อนไข PM)");
            (inserted, updated) = await ProcessAndSaveJobsAsync(s, token, jobs, errors, ct);
            await LogAsync("Project", "Success",
                $"jobNo={jobNo}, fetched={jobs.Count}, inserted={inserted}, updated={updated}, errors={errors.Count}", ct);
        }
        catch (D365BcException ex)
        {
            await LogAsync("Project", "Failed", $"jobNo={jobNo}: {ex.Message}", ct);
            throw;
        }

        return new D365FetchResult(jobs.Count, inserted, updated, jobNo, errors);
    }

    private async Task<D365BcSetting> LoadSettingsAsync(CancellationToken ct) =>
        await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct)
            ?? throw new D365BcException("ยังไม่ได้ตั้งค่าการเชื่อมต่อ D365BC (หน้า Setup)");

    // Per-job pipeline shared by both fetch modes: name → revenue + task categories → job tasks →
    // upsert into staging. Returns (inserted, updated) and saves once at the end.
    private async Task<(int Inserted, int Updated)> ProcessAndSaveJobsAsync(
        D365BcSetting s, string token, List<D365Job> jobs, List<string> errors, CancellationToken ct)
    {
        var inserted = 0;
        var updated = 0;

        // Item no -> category, for the revenue calc (Master Item must be synced first).
        var itemCat = await db.MasterItems
            .ToDictionaryAsync(i => i.Number, i => i.ItemCategoryCode, StringComparer.OrdinalIgnoreCase, ct);

        foreach (var job in jobs)
        {
            string? name = null;
            if (!string.IsNullOrWhiteSpace(job.Id))
            {
                try { name = await client.GetProjectNameAsync(s, token, job.Id!, ct); }
                catch (D365BcException ex) { errors.Add($"{job.No}: {ex.Message}"); }
            }

            // Fetch planning lines once → revenue (Billable IMPLEMENT/CUSTOMIZE/MA) + each task's item category.
            var lines = await FetchPlanningLinesAsync(s, token, job.No, errors, ct);
            var revenue = lines is null ? (decimal?)null : ComputeRevenue(lines, itemCat);
            var taskAgg = BuildTaskAggregates(lines, itemCat);
            // Job tasks (Task No + Description); null when the call fails (keep existing tasks).
            var tasks = await FetchJobTasksAsync(s, token, job.No, errors, ct);

            var existing = await db.D365ProjectStagings.FirstOrDefaultAsync(x => x.JobNo == job.No, ct);
            if (existing is null)
            {
                db.D365ProjectStagings.Add(new D365ProjectStaging
                {
                    JobNo = job.No,
                    ProjectName = name,
                    BcJobId = job.Id,
                    ProjectManagerCode = job.ProjectManager,
                    CustomerNo = job.CustomerNo,
                    CustomerName = job.CustomerName,
                    Type = SuggestType(name),   // best-effort guess; user can edit
                    Revenue = revenue,          // computed from jobPlanningLines (null if the call failed)
                    RawJson = job.RawJson,
                    FetchedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow,
                    Tasks = BuildTaskRows(job.No, tasks, taskAgg),   // EF assigns StagingId on save
                });
                inserted++;
            }
            else
            {
                // Re-fetch: modify the existing staged row with the latest values from BC.
                existing.ProjectName = name ?? existing.ProjectName;
                existing.BcJobId = job.Id ?? existing.BcJobId;
                existing.ProjectManagerCode = job.ProjectManager ?? existing.ProjectManagerCode;
                existing.CustomerNo = job.CustomerNo ?? existing.CustomerNo;
                existing.CustomerName = job.CustomerName ?? existing.CustomerName;
                // Only suggest a Type when none is set — never clobber a user's edit.
                if (string.IsNullOrWhiteSpace(existing.Type)) existing.Type = SuggestType(name);
                // Revenue is BC-derived: recompute and overwrite, but keep the old value if the call failed.
                if (revenue is not null) existing.Revenue = revenue;
                existing.RawJson = job.RawJson;
                existing.FetchedAt = DateTime.UtcNow;
                existing.UpdatedAt = DateTime.UtcNow;
                // Tasks are BC-owned: replace the whole set (unless the fetch failed).
                if (tasks is not null)
                {
                    var old = await db.D365TaskStagings.Where(t => t.StagingId == existing.StagingId).ToListAsync(ct);
                    db.D365TaskStagings.RemoveRange(old);
                    foreach (var row in BuildTaskRows(job.No, tasks, taskAgg)) { row.StagingId = existing.StagingId; db.D365TaskStagings.Add(row); }
                }
                updated++;
            }
        }

        await db.SaveChangesAsync(ct);
        return (inserted, updated);
    }

    // Fetches the job's planning lines; returns null (not empty) on failure so the caller can keep
    // any previously stored revenue.
    private async Task<List<D365JobPlanLine>?> FetchPlanningLinesAsync(D365BcSetting s, string token, string jobNo,
        List<string> errors, CancellationToken ct)
    {
        try { return await client.GetJobPlanningLinesAsync(s, token, jobNo, ct); }
        catch (D365BcException ex) { errors.Add($"{jobNo} (revenue): {ex.Message}"); return null; }
    }

    // Revenue = sum of lineAmountLCY where lineType = Billable AND the line's item (mapped by number ->
    // MasterItem) has itemCategoryCode IMPLEMENT/CUSTOMIZE/MA.
    private static decimal ComputeRevenue(List<D365JobPlanLine> lines, IReadOnlyDictionary<string, string?> itemCat)
    {
        decimal sum = 0m;
        foreach (var l in lines)
        {
            if (!string.Equals(l.LineType, "Billable", StringComparison.OrdinalIgnoreCase)) continue;
            if (l.No is null || !itemCat.TryGetValue(l.No, out var cat)) continue;
            if (IsRevenueCategory(cat)) sum += l.LineAmountLcy;
        }
        return sum;
    }

    // Per-task aggregate from the job's planning lines: an item category (a revenue category wins over
    // others; else first non-null) and the task's revenue (Σ Billable revenue-category lineAmountLCY).
    private static Dictionary<string, (string? Category, decimal Revenue)> BuildTaskAggregates(
        List<D365JobPlanLine>? lines, IReadOnlyDictionary<string, string?> itemCat)
    {
        var map = new Dictionary<string, (string? Category, decimal Revenue)>(StringComparer.OrdinalIgnoreCase);
        if (lines is null) return map;
        foreach (var l in lines)
        {
            if (string.IsNullOrWhiteSpace(l.JobTaskNo) || l.No is null) continue;
            if (!itemCat.TryGetValue(l.No, out var cat) || cat is null) continue;

            map.TryGetValue(l.JobTaskNo, out var cur);   // (null, 0) when absent
            var category = cur.Category is null || (!IsRevenueCategory(cur.Category) && IsRevenueCategory(cat))
                ? cat : cur.Category;
            var revenue = cur.Revenue;
            if (string.Equals(l.LineType, "Billable", StringComparison.OrdinalIgnoreCase) && IsRevenueCategory(cat))
                revenue += l.LineAmountLcy;
            map[l.JobTaskNo] = (category, revenue);
        }
        return map;
    }

    private static bool IsRevenueCategory(string? cat) =>
        cat is not null && (cat.Equals("IMPLEMENT", StringComparison.OrdinalIgnoreCase)
                         || cat.Equals("CUSTOMIZE", StringComparison.OrdinalIgnoreCase)
                         || cat.Equals("MA", StringComparison.OrdinalIgnoreCase));

    // Fetches the job's tasks; returns null (not empty) on failure so the caller keeps existing tasks.
    private async Task<List<D365JobTask>?> FetchJobTasksAsync(D365BcSetting s, string token, string jobNo,
        List<string> errors, CancellationToken ct)
    {
        try { return await client.GetJobTasksAsync(s, token, jobNo, ct); }
        catch (D365BcException ex) { errors.Add($"{jobNo} (tasks): {ex.Message}"); return null; }
    }

    // Maps fetched job tasks to staging rows (BC order preserved via SortOrder), tagging each with its
    // item category derived from the job's planning lines.
    private static List<D365TaskStaging> BuildTaskRows(string jobNo, List<D365JobTask>? tasks,
        IReadOnlyDictionary<string, (string? Category, decimal Revenue)> taskAgg)
    {
        var rows = new List<D365TaskStaging>();
        if (tasks is null) return rows;
        var i = 0;
        foreach (var t in tasks)
        {
            var hasAgg = taskAgg.TryGetValue(t.TaskNo, out var agg);
            rows.Add(new D365TaskStaging
            {
                JobNo = jobNo,
                TaskNo = t.TaskNo,
                TaskDescription = t.Description,
                ItemCategoryCode = hasAgg ? agg.Category : null,
                Revenue = hasAgg ? agg.Revenue : null,   // null = no matching planning lines for this task
                SortOrder = i++,
                CreatedAt = DateTime.UtcNow,
            });
        }
        return rows;
    }

    /// <summary>Items — pull the item master from BC and Insert/Update dbo.MasterItem by Number.</summary>
    public async Task<MasterItemFetchResult> FetchItemsAsync(CancellationToken ct = default)
    {
        var s = await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct)
            ?? throw new D365BcException("ยังไม่ได้ตั้งค่าการเชื่อมต่อ D365BC (หน้า Setup)");

        var inserted = 0;
        var updated = 0;
        var errors = new List<string>();
        var items = new List<D365Item>();

        try
        {
            var token = await client.GetTokenAsync(s, ct);
            items = await client.GetItemsAsync(s, token, ct);

            var existing = await db.MasterItems
                .ToDictionaryAsync(i => i.Number, i => i, StringComparer.OrdinalIgnoreCase, ct);
            foreach (var it in items)
            {
                if (existing.TryGetValue(it.Number, out var row))
                {
                    row.DisplayName = it.DisplayName ?? row.DisplayName;
                    row.ItemCategoryCode = it.ItemCategoryCode;
                    row.UpdatedAt = DateTime.UtcNow;
                    updated++;
                }
                else
                {
                    var added = new MasterItem
                    {
                        Number = it.Number,
                        DisplayName = it.DisplayName ?? string.Empty,
                        ItemCategoryCode = it.ItemCategoryCode,
                        CreatedAt = DateTime.UtcNow,
                    };
                    db.MasterItems.Add(added);
                    existing[it.Number] = added;   // dedupe within this batch
                    inserted++;
                }
            }

            await db.SaveChangesAsync(ct);
            await LogAsync("Item", "Success", $"fetched={items.Count}, inserted={inserted}, updated={updated}", ct);
        }
        catch (D365BcException ex)
        {
            await LogAsync("Item", "Failed", ex.Message, ct);
            throw;
        }

        return new MasterItemFetchResult(items.Count, inserted, updated, errors);
    }

    // Best-effort guess of Project.Type from the job/project name. Returns a value from
    // {Implement, Customize, Training, Internal, Other}; the user refines it before promoting.
    public static string? SuggestType(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = name.ToLowerInvariant();
        if (n.Contains("internal") || n.Contains("ภายใน"))
            return "Internal";
        if (n.Contains("train") || n.Contains("workshop") || n.Contains("อบรม") || n.Contains("เทรน"))
            return "Training";
        if (n.Contains("customize") || n.Contains("custom ") || n.Contains("interface")
            || n.Contains("gap") || n.Contains("app ") || n.Contains("power app"))
            return "Customize";
        if (n.Contains("implement"))
            return "Implement";
        return "Other";   // licenses and everything else default to Other
    }

    private async Task LogAsync(string entityName, string status, string message, CancellationToken ct)
    {
        try
        {
            db.D365SyncLogs.Add(new D365SyncLog
            {
                EntityName = entityName,
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
