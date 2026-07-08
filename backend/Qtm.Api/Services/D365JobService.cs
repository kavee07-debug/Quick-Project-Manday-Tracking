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

    public async Task<D365FetchResult> FetchAsync(CancellationToken ct = default)
    {
        var s = await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct)
            ?? throw new D365BcException("ยังไม่ได้ตั้งค่าการเชื่อมต่อ D365BC (หน้า Setup)");

        var maxCode = await GetMaxProjectCodeAsync(ct);
        var errors = new List<string>();
        var inserted = 0;
        var updated = 0;
        var jobs = new List<D365Job>();

        try
        {
            var token = await client.GetTokenAsync(s, ct);
            jobs = await client.GetJobsAsync(s, token, maxCode, ct);

            foreach (var job in jobs)
            {
                string? name = null;
                if (!string.IsNullOrWhiteSpace(job.Id))
                {
                    try { name = await client.GetProjectNameAsync(s, token, job.Id!, ct); }
                    catch (D365BcException ex) { errors.Add($"{job.No}: {ex.Message}"); }
                }

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
                        RawJson = job.RawJson,
                        FetchedAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow,
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
                    existing.RawJson = job.RawJson;
                    existing.FetchedAt = DateTime.UtcNow;
                    existing.UpdatedAt = DateTime.UtcNow;
                    updated++;
                }
            }

            await db.SaveChangesAsync(ct);
            await LogAsync("Success",
                $"fetched={jobs.Count}, inserted={inserted}, updated={updated}, maxCode={maxCode}, errors={errors.Count}",
                ct);
        }
        catch (D365BcException ex)
        {
            await LogAsync("Failed", ex.Message, ct);
            throw;
        }

        return new D365FetchResult(jobs.Count, inserted, updated, maxCode, errors);
    }

    // Best-effort guess of Project.Type from the job/project name. Returns a value from
    // {Implement, Customize, Training, Other}; the user refines it before promoting.
    public static string? SuggestType(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = name.ToLowerInvariant();
        if (n.Contains("train") || n.Contains("workshop") || n.Contains("อบรม") || n.Contains("เทรน"))
            return "Training";
        if (n.Contains("customize") || n.Contains("custom ") || n.Contains("interface")
            || n.Contains("gap") || n.Contains("app ") || n.Contains("power app"))
            return "Customize";
        if (n.Contains("implement"))
            return "Implement";
        return "Other";   // licenses and everything else default to Other
    }

    private async Task LogAsync(string status, string message, CancellationToken ct)
    {
        try
        {
            db.D365SyncLogs.Add(new D365SyncLog
            {
                EntityName = "Project",
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
