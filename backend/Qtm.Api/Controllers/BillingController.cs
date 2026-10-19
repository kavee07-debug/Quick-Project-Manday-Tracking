using System.Security.Claims;
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
/// Billing KPI — the BC "Posted Sales Invoice Lines" export. Lines land on the Billing Manday Import
/// screen (pending); confirming one moves it to the Billing Manday Allocate screen, and un-confirming
/// moves it back.
///
/// Access: any signed-in role may READ the KPI and the Allocate screen (confirmed lines); the Import
/// screen (pending lines), the rate list and every write are Admin only — enforced per endpoint here,
/// not just by hiding buttons.
///
/// The export has no per-line key, so a line is identified by Document No. + its position within the
/// document. Posted invoices never change in BC, so an import only adds documents the table has not
/// seen; anything already here — pending, confirmed or deleted — is left exactly as it is. That is
/// also what keeps a deleted line deleted when the next (cumulative) export is imported.
/// </summary>
[ApiController]
[Route("api/v1/billing")]
[Authorize]
public class BillingController(QtmDbContext db, ExcelService excel, D365BcClient bc) : ControllerBase
{
    private string CurrentUser() =>
        User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue(ClaimTypes.Email) ?? "unknown";

    /// <summary>
    /// A line's Billing Manday: Line Amount ÷ the manday rate of its posting year, to 3 decimals.
    /// Null when that year has no rate yet — such a line can't count as fully allocated.
    /// Every place that needs the figure (screen, Lock, KPI, rate rescale) goes through here.
    /// </summary>
    private static decimal? MandayOf(decimal? lineAmount, DateOnly? postingDate, IReadOnlyDictionary<int, decimal> rates) =>
        postingDate is DateOnly d && rates.TryGetValue(d.Year, out var rate) && rate > 0
            ? Math.Round((lineAmount ?? 0) / rate, 3, MidpointRounding.AwayFromZero)
            : null;

    private Task<Dictionary<int, decimal>> RatesAsync() =>
        db.BillingMandayRates.ToDictionaryAsync(r => r.Year, r => r.Rate);

    /// <summary>Allocated in full: the cells add up to the Billing Manday (and something was allocated,
    /// unless there was nothing to allocate). The rule Lock enforces and the screen colours by.</summary>
    private static bool IsFullyAllocated(decimal? manday, decimal allocated) =>
        manday is decimal m && Math.Round(allocated, 3) == m && (allocated != 0 || m == 0);

    /// <summary>
    /// Pending lines belong to the Import screen, which is Admin only. Other roles may only ask for
    /// confirmed lines (the Allocate screen, view mode) — "all" (null) would include pending too.
    /// </summary>
    private bool MayRead(bool? confirmed) => confirmed == true || User.IsInRole(Roles.Admin);

    /// <summary>Live (not deleted) lines, optionally only pending or only confirmed.</summary>
    private IQueryable<BillingInvoiceLine> Live(bool? confirmed)
    {
        var q = db.BillingInvoiceLines.Where(l => !l.IsDeleted);
        return confirmed is bool c ? q.Where(l => l.IsConfirmed == c) : q;
    }

    /// <summary>Years that have lines (newest first) — per screen: pending for Import, confirmed for Allocate.</summary>
    [HttpGet("years")]
    public async Task<ActionResult<IEnumerable<BillingYearDto>>> Years([FromQuery] bool? confirmed = null)
    {
        if (!MayRead(confirmed)) return Forbid();
        // Group in SQL into an anonymous shape — EF cannot translate a GroupBy projected straight
        // into a record constructor — then map to the DTO in memory.
        var years = await Live(confirmed)
            .Where(l => l.PostingDate != null)
            .GroupBy(l => l.PostingDate!.Value.Year)
            .Select(g => new { Year = g.Key, Lines = g.Count() })
            .ToListAsync();
        return Ok(years.OrderByDescending(y => y.Year).Select(y => new BillingYearDto(y.Year, y.Lines)));
    }

    /// <summary>Lines posted in a year (optionally one month), with job name and PM resolved.</summary>
    [HttpGet("lines")]
    public async Task<ActionResult<IEnumerable<BillingLineDto>>> Lines(
        [FromQuery] int year, [FromQuery] int? month = null, [FromQuery] bool? confirmed = null)
    {
        if (!MayRead(confirmed)) return Forbid();
        if (year < 2000 || year > 2100) return BadRequest(new { message = "ปีไม่ถูกต้อง" });
        if (month is < 1 or > 12) return BadRequest(new { message = "เดือนไม่ถูกต้อง" });

        var from = new DateOnly(year, month ?? 1, 1);
        var to = month is int m ? from.AddMonths(1) : from.AddYears(1);

        var lines = await Live(confirmed)
            .Where(l => l.PostingDate >= from && l.PostingDate < to)
            .OrderBy(l => l.PostingDate).ThenBy(l => l.DocumentNo).ThenBy(l => l.LineSeq)
            .ToListAsync();

        return Ok(await ToDtosAsync(lines, withAllocations: confirmed == true));
    }

    /// <summary>
    /// Shapes lines for the screens (and the Excel export): job name and PM resolved, Billing Manday
    /// worked out from the year's rate, and — for the Allocate screen — each line's matrix cells.
    /// One place, so the export can never disagree with what the screen shows.
    /// </summary>
    private async Task<List<BillingLineDto>> ToDtosAsync(List<BillingInvoiceLine> lines, bool withAllocations)
    {
        // Job name: the local Project master wins (it may have been renamed here), then the BC job
        // cache, then the D365 job staging. PM: the BC job cache, then the staging.
        var codes = lines.Where(l => l.ProjectNo != null).Select(l => l.ProjectNo!).Distinct().ToList();
        var names = await db.Projects.Where(p => codes.Contains(p.Code))
            .Select(p => new { p.Code, p.Name })
            .ToDictionaryAsync(p => p.Code, p => p.Name, StringComparer.OrdinalIgnoreCase);
        var cached = await db.BcJobInfos.Where(j => codes.Contains(j.JobNo))
            .ToDictionaryAsync(j => j.JobNo, StringComparer.OrdinalIgnoreCase);
        var staged = (await db.D365ProjectStagings.Where(s => codes.Contains(s.JobNo))
                .Select(s => new { s.JobNo, s.ProjectName, s.ProjectManagerCode })
                .ToListAsync())
            .GroupBy(s => s.JobNo, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var rates = await RatesAsync();

        // The Allocate screen also needs each line's matrix cells.
        Dictionary<int, Dictionary<int, decimal>>? allocByLine = null;
        if (withAllocations)
        {
            var lineIds = lines.Select(l => l.BillingInvoiceLineId).ToList();
            allocByLine = (await db.BillingAllocations.Where(a => lineIds.Contains(a.BillingInvoiceLineId)).ToListAsync())
                .GroupBy(a => a.BillingInvoiceLineId)
                .ToDictionary(g => g.Key, g => g.ToDictionary(a => a.ResourceId, a => a.Quantity));
        }

        return lines.Select(l =>
        {
            string? name = null, pm = null;
            if (l.ProjectNo is string job)
            {
                cached.TryGetValue(job, out var bcJob);
                staged.TryGetValue(job, out var st);
                name = names.TryGetValue(job, out var n) ? n : bcJob?.JobName ?? st?.ProjectName;
                pm = bcJob?.ProjectManager ?? st?.ProjectManagerCode;
            }
            return new BillingLineDto(
                l.BillingInvoiceLineId, l.DocumentNo, l.LineSeq, l.PostingDate,
                l.CustomerNo, l.CustomerName, l.CustomerSearchName,
                l.LineType, l.ItemNo, l.ItemCategoryCode, l.Description,
                l.Quantity, l.UnitOfMeasure, l.UnitPrice, l.LineAmount,
                l.ProjectNo, l.ProjectTaskNo, name, pm,
                l.IsConfirmed, l.ConfirmedAt, l.ConfirmedBy,
                allocByLine is null ? null
                    : allocByLine.TryGetValue(l.BillingInvoiceLineId, out var cells) ? cells : [],
                l.IsAllocLocked, l.AllocLockedAt, l.AllocLockedBy,
                l.PostingDate is DateOnly pd && rates.TryGetValue(pd.Year, out var rate) ? rate : null,
                MandayOf(l.LineAmount, l.PostingDate, rates),
                l.OtherQuantity, l.OtherNote);
        }).ToList();
    }

    /// <summary>
    /// Excel export of the Allocate screen — exactly the lines the user has filtered to, in the
    /// order shown (the screen sends their ids, so every filter on it — year, month, status, column
    /// filters, search — applies without being re-implemented here). Same columns as the screen:
    /// line details, Billing Manday, one column per KPI resource, Other, totals. Any role may
    /// export; only confirmed, live lines are ever included, whatever ids are sent.
    /// </summary>
    [HttpPost("lines/export")]
    public async Task<IActionResult> ExportAllocate(BillingExportRequest req)
    {
        var ids = (req?.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "ไม่มีรายการให้ Export" });

        var byId = (await Live(confirmed: true).Where(l => ids.Contains(l.BillingInvoiceLineId)).ToListAsync())
            .ToDictionary(l => l.BillingInvoiceLineId);
        var lines = ids.Where(byId.ContainsKey).Select(id => byId[id]).ToList();   // keep the screen's order
        var dtos = await ToDtosAsync(lines, withAllocations: true);
        var people = (await db.Resources.Where(r => r.IsBillingKpi).ToListAsync())
            .OrderBy(r => PositionRank(r.Position)).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var columns = new List<ExcelColumn>
        {
            new("Document No.", ExcelColumnKind.Text), new("Posting Date", ExcelColumnKind.Date),
            new("Job No.", ExcelColumnKind.Text), new("ชื่อ Job", ExcelColumnKind.Text),
            new("Project Manager", ExcelColumnKind.Text), new("ลูกค้า", ExcelColumnKind.Text),
            new("Type", ExcelColumnKind.Text), new("No.", ExcelColumnKind.Text), new("รายการ", ExcelColumnKind.Text),
            new("Quantity", ExcelColumnKind.Quantity, Sum: true), new("UOM", ExcelColumnKind.Text),
            new("Line Amount", ExcelColumnKind.Money, Sum: true), new("Rate (บาท/MD)", ExcelColumnKind.Money),
            new("Confirm โดย", ExcelColumnKind.Text), new("สถานะ Allocate", ExcelColumnKind.Text),
            new("Billing Manday", ExcelColumnKind.Manday, Sum: true),
        };
        columns.AddRange(people.Select(p => new ExcelColumn(
            p.Position is null ? p.Name : $"{p.Name} ({p.Position})", ExcelColumnKind.Manday, Sum: true)));
        columns.Add(new("Other", ExcelColumnKind.Manday, Sum: true));
        columns.Add(new("Other (ระบุ)", ExcelColumnKind.Text));
        columns.Add(new("รวม Allocate", ExcelColumnKind.Manday, Sum: true));
        columns.Add(new("คงเหลือ", ExcelColumnKind.Manday, Sum: true));

        var rows = dtos.Select(d =>
        {
            var cells = d.Allocations ?? [];
            var allocated = cells.Values.Sum() + (d.OtherQuantity ?? 0);
            var status = d.IsAllocLocked ? "Locked"
                : IsFullyAllocated(d.BillingManday, allocated) ? "Allocate ครบ"
                : allocated != 0 ? "Allocate ไม่ครบ" : "ยังไม่ Allocate";
            var row = new List<object?>
            {
                d.DocumentNo, d.PostingDate, d.ProjectNo, d.JobName, d.ProjectManager,
                d.CustomerSearchName ?? d.CustomerName, d.LineType, d.ItemNo, d.Description,
                d.Quantity, d.UnitOfMeasure, d.LineAmount, d.MandayRate,
                d.ConfirmedBy, status, d.BillingManday,
            };
            row.AddRange(people.Select(p => cells.TryGetValue(p.ResourceId, out var q) ? (object?)q : null));
            row.Add(d.OtherQuantity);
            row.Add(d.OtherNote);
            row.Add(Math.Round(allocated, 3));
            row.Add(d.BillingManday is decimal m ? Math.Round(m - allocated, 3) : null);
            return row.ToArray();
        });

        var note = $"Billing Manday Allocate — {lines.Count:N0} รายการ ตามตัวกรองบนหน้าจอ"
                 + (string.IsNullOrWhiteSpace(req!.FilterSummary) ? "" : $" ({req.FilterSummary.Trim()})")
                 + $" · Export โดย {CurrentUser()} เมื่อ {DateTime.UtcNow.AddHours(7):dd/MM/yyyy HH:mm}";
        var bytes = excel.WriteTable("Billing Allocate", columns, rows, note);
        return File(bytes, ExcelService.ContentTypeXlsx, $"billing-manday-allocate-{DateTime.UtcNow.AddHours(7):yyyyMMdd-HHmm}.xlsx");
    }

    /// <summary>
    /// Auto Allocate — sets ONE target (a KPI resource's cell, or "Other") on many lines at once,
    /// each line with its own figure (the screen evaluates the formula / fixed value / remaining).
    /// Same rules as typing into the cell: confirmed, unlocked, live lines only — anything else is
    /// skipped and counted. All of it is one SaveChanges, so a run lands whole or not at all.
    /// </summary>
    [HttpPost("lines/allocate-bulk")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingBulkAllocateResult>> AllocateBulk(BillingBulkAllocateRequest req)
    {
        var items = (req?.Items ?? []).GroupBy(i => i.LineId).Select(g => g.Last()).ToList();
        if (items.Count == 0) return BadRequest(new { message = "กรุณาเลือกรายการ" });
        if (req!.Other == (req.ResourceId is not null))
            return BadRequest(new { message = "เลือกปลายทางได้อย่างเดียว — Resource หรือ Other" });
        if (req.ResourceId is int rid && !await db.Resources.AnyAsync(r => r.ResourceId == rid && r.IsBillingKpi))
            return BadRequest(new { message = "Resource นี้ไม่ได้กำหนดให้คิด KPI Billing" });

        var ids = items.Select(i => i.LineId).ToList();
        var lines = await db.BillingInvoiceLines
            .Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && l.IsConfirmed && !l.IsAllocLocked)
            .ToDictionaryAsync(l => l.BillingInvoiceLineId);
        var cells = req.ResourceId is int resId
            ? await db.BillingAllocations
                .Where(a => a.ResourceId == resId && ids.Contains(a.BillingInvoiceLineId))
                .ToDictionaryAsync(a => a.BillingInvoiceLineId)
            : [];

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        var updated = 0;
        foreach (var item in items)
        {
            if (!lines.TryGetValue(item.LineId, out var line)) continue;   // locked / not confirmed / gone
            var qty = item.Quantity is decimal q ? Math.Round(q, 3, MidpointRounding.AwayFromZero) : 0m;

            if (req.Other)
            {
                line.OtherQuantity = qty == 0m ? null : qty;
            }
            else
            {
                cells.TryGetValue(item.LineId, out var cell);
                if (qty == 0m) { if (cell is not null) db.BillingAllocations.Remove(cell); }
                else if (cell is null)
                {
                    db.BillingAllocations.Add(new BillingAllocation
                    {
                        BillingInvoiceLineId = item.LineId, ResourceId = req.ResourceId!.Value, Quantity = qty,
                        UpdatedAt = now, UpdatedBy = $"{user} (Auto Allocate)",
                    });
                }
                else
                {
                    cell.Quantity = qty;
                    cell.UpdatedAt = now;
                    cell.UpdatedBy = $"{user} (Auto Allocate)";
                }
            }
            updated++;
        }
        await db.SaveChangesAsync();
        return Ok(new BillingBulkAllocateResult(updated, items.Count - updated));
    }

    /// <summary>
    /// Sets the line's "Other" allocation — manday given to someone outside the resource master
    /// (another department…), with a note saying who. Same rules as a matrix cell: confirmed,
    /// unlocked lines only; null/0 clears the quantity.
    /// </summary>
    [HttpPut("lines/{lineId:int}/other")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingOtherRequest>> SetOther(int lineId, BillingOtherRequest req)
    {
        var line = await db.BillingInvoiceLines.FirstOrDefaultAsync(l => l.BillingInvoiceLineId == lineId && !l.IsDeleted);
        if (line is null) return NotFound(new { message = "ไม่พบรายการ" });
        if (!line.IsConfirmed)
            return BadRequest(new { message = "Allocate ได้เฉพาะรายการที่ Confirm แล้ว" });
        if (line.IsAllocLocked)
            return BadRequest(new { message = "รายการนี้ Lock แล้ว — กด Unlock ก่อนถ้าต้องการแก้ไข" });

        var qty = req?.Quantity is decimal q ? Math.Round(q, 3, MidpointRounding.AwayFromZero) : 0m;
        line.OtherQuantity = qty == 0m ? null : qty;
        line.OtherNote = string.IsNullOrWhiteSpace(req?.Note) ? null : req.Note.Trim()[..Math.Min(req.Note.Trim().Length, 200)];
        await db.SaveChangesAsync();
        return Ok(new BillingOtherRequest(line.OtherQuantity, line.OtherNote));
    }

    // ---- Billing manday rates (baht per manday, per year) -----------------------------------

    /// <summary>Every year's rate, plus how many lines that year has and how many are locked.</summary>
    [HttpGet("rates")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IEnumerable<BillingRateDto>>> Rates()
    {
        var rates = await db.BillingMandayRates.ToListAsync();
        var counts = (await db.BillingInvoiceLines
                .Where(l => !l.IsDeleted && l.PostingDate != null)
                .GroupBy(l => l.PostingDate!.Value.Year)
                .Select(g => new { Year = g.Key, Lines = g.Count(), Locked = g.Count(l => l.IsAllocLocked) })
                .ToListAsync())
            .ToDictionary(x => x.Year);
        return Ok(rates.OrderByDescending(r => r.Year).Select(r =>
        {
            counts.TryGetValue(r.Year, out var c);
            return new BillingRateDto(r.Year, r.Rate, r.UpdatedAt, r.UpdatedBy, c?.Lines ?? 0, c?.Locked ?? 0);
        }));
    }

    /// <summary>
    /// Sets (or changes) a year's rate. Every line of the year picks the new Billing Manday up on
    /// the next read, and — in the same transaction — the allocations of that year's LOCKED lines are
    /// rescaled to it: each person keeps their share, and the cells add up to the new figure exactly,
    /// so a locked line stays fully allocated. Unlocked lines are left for the user to rebalance.
    /// </summary>
    [HttpPut("rates/{year:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingRateSaveResult>> SaveRate(int year, BillingRateUpsert req)
    {
        if (year < 2000 || year > 2100) return BadRequest(new { message = "ปีไม่ถูกต้อง" });
        if (req is null || req.Rate <= 0) return BadRequest(new { message = "เรท Manday ต้องมากกว่า 0" });
        var rate = Math.Round(req.Rate, 2);
        var user = CurrentUser();
        var now = DateTime.UtcNow;
        var rescaled = 0;

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var row = await db.BillingMandayRates.FindAsync(year);
            if (row is null) db.BillingMandayRates.Add(row = new BillingMandayRate { Year = year });
            row.Rate = rate;
            row.UpdatedAt = now;
            row.UpdatedBy = user;
            await db.SaveChangesAsync();

            rescaled = await RescaleLockedAsync(year, rate, user, now);
            await tx.CommitAsync();
            db.ChangeTracker.Clear();
        });

        var from = new DateOnly(year, 1, 1);
        var to = from.AddYears(1);
        var yearLines = db.BillingInvoiceLines.Where(l => !l.IsDeleted && l.PostingDate >= from && l.PostingDate < to);
        var dto = new BillingRateDto(year, rate, now, user,
            await yearLines.CountAsync(), await yearLines.CountAsync(l => l.IsAllocLocked));
        return Ok(new BillingRateSaveResult(dto, rescaled));
    }

    /// <summary>Removes a year's rate — refused while the year has locked lines, which depend on it.</summary>
    [HttpDelete("rates/{year:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> DeleteRate(int year)
    {
        var row = await db.BillingMandayRates.FindAsync(year);
        if (row is null) return NotFound(new { message = $"ไม่พบเรทปี {year}" });

        var from = new DateOnly(year, 1, 1);
        var to = from.AddYears(1);
        var locked = await db.BillingInvoiceLines.CountAsync(l =>
            l.IsAllocLocked && !l.IsDeleted && l.PostingDate >= from && l.PostingDate < to);
        if (locked > 0)
            return Conflict(new { message = $"ปี {year} มีรายการที่ Lock แล้ว {locked} รายการ — ลบเรทไม่ได้ (แก้ไขเรทแทน)" });

        db.BillingMandayRates.Remove(row);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Rescales each locked line of the year so its allocation — every person's cell plus the "Other"
    /// share — adds up to the line's new Billing Manday, keeping each share's proportion. Shares are
    /// rounded to 3 decimals and the rounding remainder goes to the largest, so the total lands
    /// exactly. A line with nothing allocated is left alone.
    /// </summary>
    private async Task<int> RescaleLockedAsync(int year, decimal rate, string user, DateTime now)
    {
        var from = new DateOnly(year, 1, 1);
        var to = from.AddYears(1);
        var locked = await db.BillingInvoiceLines   // tracked: OtherQuantity may be rewritten
            .Where(l => l.IsAllocLocked && !l.IsDeleted && l.PostingDate >= from && l.PostingDate < to)
            .ToListAsync();
        if (locked.Count == 0) return 0;

        var ids = locked.Select(l => l.BillingInvoiceLineId).ToList();
        var cellsByLine = (await db.BillingAllocations.Where(a => ids.Contains(a.BillingInvoiceLineId)).ToListAsync())
            .GroupBy(a => a.BillingInvoiceLineId)
            .ToDictionary(g => g.Key, g => g.ToList());

        var rescaled = 0;
        foreach (var line in locked)
        {
            var cells = cellsByLine.GetValueOrDefault(line.BillingInvoiceLineId) ?? [];
            // The shares to scale: each person's cell, then Other (last slot) when set.
            var shares = cells.Select(c => c.Quantity).ToList();
            var hasOther = line.OtherQuantity is decimal o && o != 0;
            if (hasOther) shares.Add(line.OtherQuantity!.Value);

            var target = Math.Round((line.LineAmount ?? 0) / rate, 3, MidpointRounding.AwayFromZero);
            var current = shares.Sum();
            if (current == 0 || current == target) continue;

            var scaled = shares.Select(q => Math.Round(q * target / current, 3, MidpointRounding.AwayFromZero)).ToArray();
            var remainder = target - scaled.Sum();
            if (remainder != 0)
            {
                var biggest = Array.IndexOf(scaled, scaled.MaxBy(Math.Abs));
                scaled[biggest] += remainder;
            }
            for (var i = 0; i < cells.Count; i++)
            {
                if (scaled[i] == 0) { db.BillingAllocations.Remove(cells[i]); continue; }
                cells[i].Quantity = scaled[i];
                cells[i].UpdatedAt = now;
                cells[i].UpdatedBy = $"{user} (ปรับตามเรทใหม่)";
            }
            if (hasOther)
            {
                var other = scaled[^1];
                line.OtherQuantity = other == 0 ? null : other;
            }
            rescaled++;
        }
        await db.SaveChangesAsync();
        return rescaled;
    }

    /// <summary>
    /// Locks fully allocated lines: their cells become read-only and they can't be un-confirmed.
    /// "Fully allocated" = the cells add up to the line's Billing Manday (Line Amount ÷ the year's
    /// rate) — so a year with no rate can't be locked yet. Lines that don't qualify are skipped and
    /// counted, never half-applied.
    /// </summary>
    [HttpPost("lines/lock")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingLockResult>> Lock(BillingConfirmRequest req)
    {
        var ids = (req?.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "กรุณาเลือกรายการ" });

        var rates = await RatesAsync();
        var lines = (await db.BillingInvoiceLines
                .Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && l.IsConfirmed && !l.IsAllocLocked)
                .Select(l => new { l.BillingInvoiceLineId, l.LineAmount, l.PostingDate, l.OtherQuantity })
                .ToListAsync())
            .Select(l => new
            {
                l.BillingInvoiceLineId,
                Manday = MandayOf(l.LineAmount, l.PostingDate, rates),
                Other = l.OtherQuantity ?? 0,
            })
            .ToList();
        var lineIds = lines.Select(l => l.BillingInvoiceLineId).ToList();
        var allocated = await db.BillingAllocations
            .Where(a => lineIds.Contains(a.BillingInvoiceLineId))
            .GroupBy(a => a.BillingInvoiceLineId)
            .Select(g => new { Id = g.Key, Sum = g.Sum(a => a.Quantity) })
            .ToDictionaryAsync(x => x.Id, x => x.Sum);

        var complete = lines
            .Where(l => IsFullyAllocated(l.Manday, allocated.GetValueOrDefault(l.BillingInvoiceLineId) + l.Other))
            .Select(l => l.BillingInvoiceLineId)
            .ToList();

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        var updated = complete.Count == 0 ? 0 : await db.BillingInvoiceLines
            .Where(l => complete.Contains(l.BillingInvoiceLineId))
            .ExecuteUpdateAsync(s => s
                .SetProperty(l => l.IsAllocLocked, true)
                .SetProperty(l => l.AllocLockedAt, now)
                .SetProperty(l => l.AllocLockedBy, user));
        return Ok(new BillingLockResult(updated, ids.Count - updated));
    }

    [HttpPost("lines/unlock")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingLockResult>> Unlock(BillingConfirmRequest req)
    {
        var ids = (req?.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "กรุณาเลือกรายการ" });

        var updated = await db.BillingInvoiceLines
            .Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && l.IsAllocLocked)
            .ExecuteUpdateAsync(s => s
                .SetProperty(l => l.IsAllocLocked, false)
                .SetProperty(l => l.AllocLockedAt, (DateTime?)null)
                .SetProperty(l => l.AllocLockedBy, (string?)null));
        return Ok(new BillingLockResult(updated, ids.Count - updated));
    }

    // Matrix column order: SA, then Dev, then PM, then anyone without a position — then by name.
    private static int PositionRank(string? p) => p switch { "SA" => 0, "Dev" => 1, "PM" => 2, _ => 3 };

    /// <summary>
    /// Billing KPI Manday — allocated manday per resource per posting year. Counts allocations on
    /// confirmed, live lines only: an un-confirmed line keeps its cells (they come back on re-confirm)
    /// but has left the Allocate screen, so it must not count. Also returns each year's confirmed
    /// Billing Manday (Line Amount ÷ rate), so the screen can show what is still unallocated, and
    /// the years that have confirmed lines but no rate yet.
    /// </summary>
    [HttpGet("kpi")]
    public async Task<ActionResult<BillingKpiDto>> Kpi()
    {
        var live = db.BillingInvoiceLines.Where(l => l.IsConfirmed && !l.IsDeleted && l.PostingDate != null);

        var cells = await (
            from a in db.BillingAllocations
            join l in live on a.BillingInvoiceLineId equals l.BillingInvoiceLineId
            group a by new { a.ResourceId, Year = l.PostingDate!.Value.Year } into g
            select new { g.Key.ResourceId, g.Key.Year, Qty = g.Sum(x => x.Quantity) }
        ).ToListAsync();

        // Billing Manday is rounded per line (as the Allocate screen shows it), so sum the rounded
        // figures in memory rather than dividing a SQL total — the two would drift by rounding.
        var rates = await RatesAsync();
        var confirmedLines = await live.Select(l => new { l.PostingDate, l.LineAmount, l.OtherQuantity }).ToListAsync();
        var lineYears = confirmedLines.Select(l => l.PostingDate!.Value.Year).Distinct().ToList();
        var missingRateYears = lineYears.Where(y => !rates.ContainsKey(y)).OrderBy(y => y).ToArray();
        var manday = confirmedLines
            .GroupBy(l => l.PostingDate!.Value.Year)
            .Where(g => rates.ContainsKey(g.Key))
            .ToDictionary(g => g.Key, g => g.Sum(l => MandayOf(l.LineAmount, l.PostingDate, rates) ?? 0));

        // Everyone ticked, plus anyone un-ticked who still has allocated manday.
        var allocatedIds = cells.Select(c => c.ResourceId).Distinct().ToList();
        var people = await db.Resources
            .Where(r => r.IsBillingKpi || allocatedIds.Contains(r.ResourceId))
            .ToListAsync();

        // Each person's target is their Position Level's target for the year (per person, not shared).
        var levelNames = (await db.PositionLevels.ToListAsync())
            .ToDictionary(l => (l.Position, l.Code), l => l.Name);
        var targets = await db.PositionLevelTargets.ToListAsync();

        // Years with a target show up too, so a year can be tracked before anything is billed in it.
        var years = lineYears.Union(cells.Select(c => c.Year)).Union(targets.Select(t => t.Year)).Order().ToArray();
        var rows = people
            .OrderBy(r => PositionRank(r.Position)).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(r =>
            {
                var byYear = cells.Where(c => c.ResourceId == r.ResourceId).ToDictionary(c => c.Year, c => c.Qty);
                var targetByYear = r.PositionLevelCode is null ? []
                    : targets.Where(t => t.Position == r.Position && t.LevelCode == r.PositionLevelCode)
                        .ToDictionary(t => t.Year, t => t.TargetManday);
                return new BillingKpiRow(r.ResourceId, r.Code, r.Name, r.Position, r.IsBillingKpi,
                    byYear, byYear.Values.Sum(),
                    r.PositionLevelCode,
                    r.Position is string p && r.PositionLevelCode is string c ? levelNames.GetValueOrDefault((p, c)) : null,
                    targetByYear);
            })
            .ToArray();

        // "Other" (outside the resource master) is its own figure, and part of the allocated total —
        // without it the year's allocation would never reconcile with its Billing Manday.
        var other = confirmedLines
            .Where(l => l.OtherQuantity is decimal q && q != 0)
            .GroupBy(l => l.PostingDate!.Value.Year)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.OtherQuantity!.Value));
        var allocated = cells.GroupBy(c => c.Year).ToDictionary(g => g.Key, g => g.Sum(c => c.Qty));
        foreach (var (year, q) in other) allocated[year] = allocated.GetValueOrDefault(year) + q;
        var rateByYear = years.Where(rates.ContainsKey).ToDictionary(y => y, y => rates[y]);
        // Total Amount: the confirmed lines' Line Amount per year — counted whether or not the year
        // has a rate yet, since it is the money billed, not a derived figure.
        var amount = confirmedLines
            .GroupBy(l => l.PostingDate!.Value.Year)
            .ToDictionary(g => g.Key, g => g.Sum(l => l.LineAmount ?? 0));
        return Ok(new BillingKpiDto(years, rows, allocated, manday, missingRateYears, other, rateByYear, amount));
    }

    /// <summary>The resources flagged for the Billing KPI — the columns of the allocation matrix.</summary>
    [HttpGet("resources")]
    public async Task<ActionResult<IEnumerable<BillingResourceDto>>> KpiResources()
    {
        var people = await db.Resources.Where(r => r.IsBillingKpi).ToListAsync();
        return Ok(people
            .OrderBy(r => PositionRank(r.Position)).ThenBy(r => r.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(r => new BillingResourceDto(r.ResourceId, r.Code, r.Name, r.Position)));
    }

    /// <summary>
    /// Sets one matrix cell: how much of a confirmed line's Quantity one KPI resource gets.
    /// Null or 0 clears the cell. The total is deliberately not forced to equal the line's Quantity
    /// — the screen shows the difference for cross-checking instead.
    /// </summary>
    [HttpPut("lines/{lineId:int}/allocations/{resourceId:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingAllocationResult>> SetAllocation(
        int lineId, int resourceId, BillingAllocationRequest req)
    {
        var line = await db.BillingInvoiceLines.FirstOrDefaultAsync(l => l.BillingInvoiceLineId == lineId && !l.IsDeleted);
        if (line is null) return NotFound(new { message = "ไม่พบรายการ" });
        if (!line.IsConfirmed)
            return BadRequest(new { message = "Allocate ได้เฉพาะรายการที่ Confirm แล้ว" });
        if (line.IsAllocLocked)
            return BadRequest(new { message = "รายการนี้ Lock แล้ว — กด Unlock ก่อนถ้าต้องการแก้ไข" });
        if (!await db.Resources.AnyAsync(r => r.ResourceId == resourceId && r.IsBillingKpi))
            return BadRequest(new { message = "Resource นี้ไม่ได้กำหนดให้คิด KPI Billing" });

        // 3 decimals — the precision Billing Manday is calculated to, so the totals can match exactly.
        var qty = req?.Quantity is decimal q ? Math.Round(q, 3, MidpointRounding.AwayFromZero) : 0m;
        var cell = await db.BillingAllocations.FindAsync(lineId, resourceId);
        if (qty == 0m)
        {
            if (cell is not null) db.BillingAllocations.Remove(cell);
        }
        else if (cell is null)
        {
            db.BillingAllocations.Add(new BillingAllocation
            {
                BillingInvoiceLineId = lineId, ResourceId = resourceId, Quantity = qty,
                UpdatedAt = DateTime.UtcNow, UpdatedBy = CurrentUser(),
            });
        }
        else
        {
            cell.Quantity = qty;
            cell.UpdatedAt = DateTime.UtcNow;
            cell.UpdatedBy = CurrentUser();
        }
        await db.SaveChangesAsync();
        return Ok(new BillingAllocationResult(lineId, resourceId, qty == 0m ? null : qty));
    }

    /// <summary>How fresh the BC job cache is, so the screen can say when names/PMs were last pulled.</summary>
    [HttpGet("jobs/status")]
    public async Task<ActionResult<BillingJobCacheDto>> JobCacheStatus()
    {
        var count = await db.BcJobInfos.CountAsync();
        var at = count == 0 ? (DateTime?)null : await db.BcJobInfos.MaxAsync(j => j.FetchedAt);
        return Ok(new BillingJobCacheDto(count, at));
    }

    /// <summary>
    /// Refreshes the BC job cache: every SOJ job's PM from the QERP job entity plus every job's name
    /// from the standard projects entity. Replaces the cache wholesale — it is a copy of BC, not data
    /// anyone edits here.
    /// </summary>
    [HttpPost("jobs/sync")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingJobSyncResult>> SyncJobs(CancellationToken ct)
    {
        var s = await db.D365BcSettings.FirstOrDefaultAsync(x => x.Id == 1, ct);
        if (s is null) return BadRequest(new { message = "ยังไม่ได้ตั้งค่าการเชื่อมต่อ D365BC (หน้า ตั้งค่า API (BC))" });

        List<D365JobPm> pms;
        List<D365ProjectName> projectNames;
        try
        {
            var token = await bc.GetTokenAsync(s, ct);
            pms = await bc.GetAllJobPmsAsync(s, token, ct);
            projectNames = await bc.GetProjectsAsync(s, token, ct);
        }
        catch (D365BcException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        var now = DateTime.UtcNow;
        var byNo = new Dictionary<string, BcJobInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in pms)
            byNo[p.No] = new BcJobInfo
            {
                JobNo = Trunc(p.No, 50)!, ProjectManager = Trunc(p.ProjectManager, 50), PmEmail = Trunc(p.PmEmail, 200),
                CustomerName = Trunc(p.CustomerName, 300), Status = Trunc(p.Status, 50), FetchedAt = now,
            };
        foreach (var n in projectNames)
        {
            if (!byNo.TryGetValue(n.Number, out var row))
                byNo[n.Number] = row = new BcJobInfo { JobNo = Trunc(n.Number, 50)!, FetchedAt = now };
            row.JobName = Trunc(n.DisplayName, 300);
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.BcJobInfos.ExecuteDeleteAsync(ct);
            db.BcJobInfos.AddRange(byNo.Values);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            db.ChangeTracker.Clear();
        });

        return Ok(new BillingJobSyncResult(byNo.Count,
            byNo.Values.Count(j => j.JobName != null), byNo.Values.Count(j => j.ProjectManager != null), now));
    }

    private static string? Trunc(string? v, int max)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        v = v.Trim();
        return v.Length > max ? v[..max] : v;
    }

    /// <summary>
    /// Imports a Posted Sales Invoice Lines export. Blank-Type lines are skipped by the reader, and
    /// only documents the table has never seen are added — exports are cumulative, posted invoices
    /// never change, and skipping known documents is what keeps deleted lines deleted and confirmed
    /// lines untouched.
    /// </summary>
    [HttpPost("import")]
    [Authorize(Roles = Roles.Admin)]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<BillingImportResult>> Import(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "กรุณาเลือกไฟล์ .xlsx" });

        PostedSalesInvoiceFile parsed;
        try
        {
            using var s = file.OpenReadStream();
            parsed = excel.ReadPostedSalesInvoiceLines(s);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception)
        {
            return BadRequest(new { message = "อ่านไฟล์ไม่ได้ — กรุณาใช้ไฟล์ .xlsx ที่ export จาก BC" });
        }
        if (parsed.Rows.Count == 0)
            return BadRequest(new { message = "ไม่พบบรรทัดที่มี Type ในไฟล์" });

        var docs = parsed.Rows.Select(r => r.DocumentNo).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var user = CurrentUser();
        var fileName = Path.GetFileName(file.FileName);
        var now = DateTime.UtcNow;
        BillingImportResult? result = null;

        // Check-then-insert in one transaction, so two imports at once cannot both add a document.
        // The retrying execution strategy (Azure SQL) refuses a hand-opened transaction unless it
        // runs inside the strategy, so wrap it.
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();

            // Deleted lines count as known on purpose — that is the tombstone doing its job.
            var known = (await db.BillingInvoiceLines
                    .Where(l => docs.Contains(l.DocumentNo))
                    .Select(l => l.DocumentNo)
                    .Distinct()
                    .ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var toInsert = parsed.Rows.Where(r => !known.Contains(r.DocumentNo)).Select(r => new BillingInvoiceLine
            {
                DocumentNo = r.DocumentNo, LineSeq = r.LineSeq, PostingDate = r.PostingDate,
                CustomerNo = r.CustomerNo, CustomerName = r.CustomerName, CustomerSearchName = r.CustomerSearchName,
                LineType = r.LineType, ItemNo = r.ItemNo, ItemCategoryCode = r.ItemCategoryCode,
                Description = r.Description, Quantity = r.Quantity, UnitOfMeasure = r.UnitOfMeasure,
                UnitPrice = r.UnitPrice, LineDiscountPct = r.LineDiscountPct, LineAmount = r.LineAmount,
                AmountInclVat = r.AmountInclVat, BoiCode = r.BoiCode, ProjectNo = r.ProjectNo,
                ProjectTaskNo = r.ProjectTaskNo, ContractEntryNo = r.ContractEntryNo,
                JobPlanningLineNo = r.JobPlanningLineNo, JobPlanningDescription = r.JobPlanningDescription,
                SourceFileName = fileName, ImportedAt = now, ImportedBy = user,
            }).ToList();

            db.BillingInvoiceLines.AddRange(toInsert);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            db.ChangeTracker.Clear();

            result = new BillingImportResult(
                Imported: toInsert.Count,
                Documents: docs.Count - known.Count,
                SkippedExistingDocuments: known.Count,
                SkippedBlankType: parsed.SkippedBlankType);
        });

        return Ok(result);
    }

    /// <summary>
    /// Deletes pending lines (soft delete — see the class remarks). Confirmed lines are refused:
    /// they belong to the Allocate screen, so send them back with Unconfirm first.
    /// </summary>
    [HttpPost("lines/delete")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<BillingDeleteResult>> Delete(BillingConfirmRequest req)
    {
        var ids = (req?.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "กรุณาเลือกรายการ" });

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        var skipped = await db.BillingInvoiceLines
            .CountAsync(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && l.IsConfirmed);
        var deleted = await db.BillingInvoiceLines
            .Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && !l.IsConfirmed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(l => l.IsDeleted, true)
                .SetProperty(l => l.DeletedAt, now)
                .SetProperty(l => l.DeletedBy, user));
        return Ok(new BillingDeleteResult(deleted, skipped));
    }

    [HttpPost("lines/confirm")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<BillingConfirmResult>> Confirm(BillingConfirmRequest req) => SetConfirmed(req, true);

    [HttpPost("lines/unconfirm")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<BillingConfirmResult>> Unconfirm(BillingConfirmRequest req) => SetConfirmed(req, false);

    private async Task<ActionResult<BillingConfirmResult>> SetConfirmed(BillingConfirmRequest req, bool confirmed)
    {
        var ids = (req?.Ids ?? []).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { message = "กรุณาเลือกรายการ" });

        var now = DateTime.UtcNow;
        var user = CurrentUser();
        // Only rows actually changing state — re-confirming keeps the original who/when.
        var updated = confirmed
            ? await db.BillingInvoiceLines.Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && !l.IsConfirmed)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.IsConfirmed, true)
                    .SetProperty(l => l.ConfirmedAt, now)
                    .SetProperty(l => l.ConfirmedBy, user))
            // A locked line is finished work — it has to be unlocked before it can go back to Import.
            : await db.BillingInvoiceLines.Where(l => ids.Contains(l.BillingInvoiceLineId) && !l.IsDeleted && l.IsConfirmed && !l.IsAllocLocked)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(l => l.IsConfirmed, false)
                    .SetProperty(l => l.ConfirmedAt, (DateTime?)null)
                    .SetProperty(l => l.ConfirmedBy, (string?)null));
        return Ok(new BillingConfirmResult(updated));
    }
}
