namespace Qtm.Api.Data.Entities;

/// <summary>
/// A job typed in by hand on the Revenue Monthly screen — mainly to estimate revenue for work the
/// QERP report does not carry yet. Deliberately kept in its own table rather than on a snapshot
/// side, so re-importing either Excel file leaves these rows untouched.
/// Maps to dbo.RevenueMonthManualLine.
/// </summary>
public class RevenueMonthManualLine
{
    public int RevenueMonthManualLineId { get; set; }
    public int RevenueMonthId { get; set; }                // FK -> RevenueMonth (cascade)
    public string JobNo { get; set; } = string.Empty;
    public string? JobName { get; set; }
    public string? Customer { get; set; }
    public decimal? Revenue { get; set; }                  // project value
    public decimal? PrevProgress { get; set; }             // % at the end of last month (0..100)
    public decimal? CurrProgress { get; set; }             // % at the end of this month (0..100)
    // Typed straight in as money; when present it wins over the figure derived from the two %.
    public decimal? Amount { get; set; }
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public RevenueMonth? Month { get; set; }
}
