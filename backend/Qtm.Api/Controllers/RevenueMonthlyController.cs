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
/// Monthly revenue recognition from the QERP "Standard Progress vs Actual Progress Summary" report.
/// A period holds two imported snapshots — Prev (end of the previous month) and Curr (end of this
/// month) — and revenue for the month is the progress delta applied to the project value:
/// (%curr − %prev) / 100 × Revenue. Jobs are matched by Job No. only; this module deliberately does
/// not touch the local Project master, because the report carries jobs that do not exist there.
/// </summary>
[ApiController]
[Route("api/v1/revenue-monthly")]
[Authorize]
public class RevenueMonthlyController(QtmDbContext db, ExcelService excel) : ControllerBase
{
    private const string SidePrev = "Prev";
    private const string SideCurr = "Curr";

    [HttpGet]
    public async Task<ActionResult<IEnumerable<RevenueMonthDto>>> List()
    {
        var months = await db.RevenueMonths
            .OrderByDescending(m => m.PeriodYear).ThenByDescending(m => m.PeriodMonth)
            .ToListAsync();
        if (months.Count == 0) return Ok(Array.Empty<RevenueMonthDto>());

        var ids = months.Select(m => m.RevenueMonthId).ToList();
        var byMonth = (await db.RevenueMonthSnapshots.Where(s => ids.Contains(s.RevenueMonthId)).ToListAsync())
            .GroupBy(s => s.RevenueMonthId)
            .ToDictionary(g => g.Key, g => Compute(g));

        return Ok(months.Select(m => ToDto(m, byMonth.GetValueOrDefault(m.RevenueMonthId) ?? [])));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<RevenueMonthDetailDto>> Get(int id)
    {
        var month = await db.RevenueMonths.FirstOrDefaultAsync(m => m.RevenueMonthId == id);
        if (month is null) return NotFound(new { message = "ไม่พบงวดที่ระบุ" });

        var lines = Compute(await db.RevenueMonthSnapshots.Where(s => s.RevenueMonthId == id).ToListAsync());
        return Ok(new RevenueMonthDetailDto(ToDto(month, lines), [.. lines]));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<RevenueMonthDto>> Create(RevenueMonthCreate req)
    {
        if (req.PeriodYear < 2000 || req.PeriodYear > 2999)
            return BadRequest(new { message = "ปีไม่ถูกต้อง" });
        if (req.PeriodMonth is < 1 or > 12)
            return BadRequest(new { message = "เดือนต้องอยู่ระหว่าง 1 ถึง 12" });
        if (await db.RevenueMonths.AnyAsync(m => m.PeriodYear == req.PeriodYear && m.PeriodMonth == req.PeriodMonth))
            return BadRequest(new { message = $"มีงวด {req.PeriodYear}-{req.PeriodMonth:00} อยู่แล้ว" });

        var month = new RevenueMonth
        {
            PeriodYear = req.PeriodYear,
            PeriodMonth = req.PeriodMonth,
            Note = req.Note,
            CreatedAt = DateTime.UtcNow,
        };
        db.RevenueMonths.Add(month);
        await db.SaveChangesAsync();
        return Ok(ToDto(month, []));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var month = await db.RevenueMonths.FirstOrDefaultAsync(m => m.RevenueMonthId == id);
        if (month is null) return NotFound(new { message = "ไม่พบงวดที่ระบุ" });
        db.RevenueMonths.Remove(month);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Imports one snapshot side. Re-importing replaces that side entirely (the other side is untouched).</summary>
    [HttpPost("{id:int}/import/{side}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<ImportResult>> Import(int id, string side, IFormFile file)
    {
        var target = NormalizeSide(side);
        if (target is null) return BadRequest(new { message = "side ต้องเป็น prev หรือ curr" });
        if (file is null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });

        var month = await db.RevenueMonths.FirstOrDefaultAsync(m => m.RevenueMonthId == id);
        if (month is null) return NotFound(new { message = "ไม่พบงวดที่ระบุ" });

        StdProgressReport report;
        try
        {
            using var s = file.OpenReadStream();
            report = excel.ReadStdProgressReport(s);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception)
        {
            return BadRequest(new { message = "อ่านไฟล์ Excel ไม่สำเร็จ — ไฟล์อาจไม่ใช่ .xlsx หรือเสียหาย" });
        }

        if (report.Rows.Count == 0)
            return BadRequest(new { message = "ไม่พบข้อมูล Job ในไฟล์" });

        var errors = new List<string>();
        var now = DateTime.UtcNow;
        var snapshots = new List<RevenueMonthSnapshot>();

        // Collapse duplicate Job No. rows — keep the row with the highest progress (Act first, then Std).
        foreach (var g in report.Rows.GroupBy(r => r.JobNo, StringComparer.OrdinalIgnoreCase))
        {
            var count = g.Count();
            var best = g.OrderByDescending(r => r.ProgressAct ?? -1m)
                        .ThenByDescending(r => r.ProgressStd ?? -1m)
                        .First();
            if (count > 1)
                errors.Add($"Job '{best.JobNo}': พบ {count} แถวในไฟล์ ยุบเหลือแถวเดียว (ใช้ % สูงสุด)");
            if (best.Revenue is null)
                errors.Add($"แถว {best.ExcelRow}: Job '{best.JobNo}' ไม่มีค่า Revenue — รายได้จะคิดเป็น 0");

            snapshots.Add(new RevenueMonthSnapshot
            {
                RevenueMonthId = id,
                Side = target,
                JobNo = best.JobNo,
                JobName = best.JobName,
                Customer = best.Customer,
                Pm = best.Pm,
                StdGroup = best.StdGroup,
                Stage = best.Stage,
                Revenue = best.Revenue,
                ProgressStd = best.ProgressStd,
                ProgressAct = best.ProgressAct,
                RevenueProgress = best.RevenueProgress,
                MergedRowCount = count,
                CreatedAt = now,
            });
        }

        // Replace the side: delete first (own round-trip) so the unique key never collides with the inserts.
        await db.RevenueMonthSnapshots.Where(s => s.RevenueMonthId == id && s.Side == target).ExecuteDeleteAsync();
        db.RevenueMonthSnapshots.AddRange(snapshots);

        var fileName = Path.GetFileName(file.FileName);
        if (target == SidePrev)
        {
            month.PrevFileName = fileName;
            month.PrevReportInfo = report.ReportInfo;
            month.PrevImportedAt = now;
            month.PrevJobCount = snapshots.Count;
        }
        else
        {
            month.CurrFileName = fileName;
            month.CurrReportInfo = report.ReportInfo;
            month.CurrImportedAt = now;
            month.CurrJobCount = snapshots.Count;
        }
        month.UpdatedAt = now;
        await db.SaveChangesAsync();

        return Ok(new ImportResult(snapshots.Count, 0, report.Rows.Count - snapshots.Count, errors));
    }

    [HttpGet("{id:int}/export")]
    public async Task<IActionResult> Export(int id)
    {
        var month = await db.RevenueMonths.FirstOrDefaultAsync(m => m.RevenueMonthId == id);
        if (month is null) return NotFound(new { message = "ไม่พบงวดที่ระบุ" });

        var lines = Compute(await db.RevenueMonthSnapshots.Where(s => s.RevenueMonthId == id).ToListAsync());
        var period = $"{month.PeriodYear}-{month.PeriodMonth:00}";
        var bytes = excel.WriteRevenueMonthly($"Revenue {period}", lines.Select(l => new RevenueMonthlyExportRow(
            l.JobNo, l.JobName, l.Customer, l.Revenue,
            l.PrevStd, l.CurrStd, l.DeltaStd, l.AmountStd,
            l.PrevAct, l.CurrAct, l.DeltaAct, l.AmountAct, l.Status)));
        return File(bytes, ExcelService.ContentTypeXlsx, $"revenue-monthly-{period}.xlsx");
    }

    // ---------- helpers ----------

    private static string? NormalizeSide(string side) => side?.ToLowerInvariant() switch
    {
        "prev" => SidePrev,
        "curr" => SideCurr,
        _ => null,
    };

    private static RevenueMonthDto ToDto(RevenueMonth m, IReadOnlyCollection<RevenueMonthLineDto> lines) =>
        new(m.RevenueMonthId, m.PeriodYear, m.PeriodMonth, m.Note,
            m.PrevFileName, m.PrevReportInfo, m.PrevImportedAt, m.PrevJobCount,
            m.CurrFileName, m.CurrReportInfo, m.CurrImportedAt, m.CurrJobCount,
            lines.Count, lines.Sum(l => l.AmountStd), lines.Sum(l => l.AmountAct));

    /// <summary>Full-outer-joins the two snapshot sides by Job No. and derives the month's revenue per job.</summary>
    private static List<RevenueMonthLineDto> Compute(IEnumerable<RevenueMonthSnapshot> snapshots)
    {
        var all = snapshots as IList<RevenueMonthSnapshot> ?? [.. snapshots];
        var prev = all.Where(s => s.Side == SidePrev).ToDictionary(s => s.JobNo, StringComparer.OrdinalIgnoreCase);
        var curr = all.Where(s => s.Side == SideCurr).ToDictionary(s => s.JobNo, StringComparer.OrdinalIgnoreCase);

        var lines = new List<RevenueMonthLineDto>();
        foreach (var jobNo in prev.Keys.Union(curr.Keys, StringComparer.OrdinalIgnoreCase)
                                       .OrderBy(j => j, StringComparer.OrdinalIgnoreCase))
        {
            prev.TryGetValue(jobNo, out var p);
            curr.TryGetValue(jobNo, out var c);

            // Project value: this month's figure wins; a job that dropped out of the report keeps last month's.
            var revenue = c?.Revenue ?? p?.Revenue;
            // A side with no row for this job counts as 0% (a brand-new job recognises its full progress).
            var prevStd = p?.ProgressStd ?? 0m;
            var currStd = c?.ProgressStd ?? 0m;
            var prevAct = p?.ProgressAct ?? 0m;
            var currAct = c?.ProgressAct ?? 0m;

            // Signed on purpose: progress (or the project value) can move backwards, and that has to
            // show up as negative revenue for the month rather than silently disappear.
            decimal Amount(decimal delta) =>
                revenue is decimal v ? Math.Round(delta / 100m * v, 2, MidpointRounding.AwayFromZero) : 0m;

            lines.Add(new RevenueMonthLineDto(
                JobNo: jobNo,
                JobName: c?.JobName ?? p?.JobName,
                Customer: c?.Customer ?? p?.Customer,
                Pm: c?.Pm ?? p?.Pm,
                StdGroup: c?.StdGroup ?? p?.StdGroup,
                Stage: c?.Stage ?? p?.Stage,
                Revenue: revenue,
                PrevRevenue: p?.Revenue,
                RevenueChanged: p?.Revenue is decimal pr && c?.Revenue is decimal cr && pr != cr,
                PrevStd: prevStd, CurrStd: currStd, DeltaStd: currStd - prevStd, AmountStd: Amount(currStd - prevStd),
                PrevAct: prevAct, CurrAct: currAct, DeltaAct: currAct - prevAct, AmountAct: Amount(currAct - prevAct),
                Status: p is null ? "New" : c is null ? "Gone" : "Normal",
                MergedRowCount: Math.Max(p?.MergedRowCount ?? 1, c?.MergedRowCount ?? 1)));
        }
        return lines;
    }
}
