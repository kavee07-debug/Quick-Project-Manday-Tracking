namespace Qtm.Api.Data.Entities;

/// <summary>
/// One job of one imported snapshot side (Prev/Curr) of a <see cref="RevenueMonth"/>. Rows are
/// stored as imported — deliberately NOT linked to dbo.Project, since the QERP report carries jobs
/// that do not exist in the local project master. Maps to dbo.RevenueMonthSnapshot.
/// </summary>
public class RevenueMonthSnapshot
{
    public int RevenueSnapshotId { get; set; }
    public int RevenueMonthId { get; set; }                // FK -> RevenueMonth (cascade)
    public string Side { get; set; } = string.Empty;       // Prev | Curr
    public string JobNo { get; set; } = string.Empty;      // e.g. SOJ2411-0004
    public string? JobName { get; set; }
    public string? Customer { get; set; }
    public string? Pm { get; set; }
    public string? StdGroup { get; set; }                  // "Std. Progress" group code, e.g. CUT-MANUAL
    public string? Stage { get; set; }                     // "Progress" stage text, e.g. Sign go live
    public decimal? Revenue { get; set; }                  // project value from the report
    public decimal? ProgressStd { get; set; }              // "% Progress by Std." (0..100)
    public decimal? ProgressAct { get; set; }              // "% Progress by Act. Time sheet" (0..100)
    public decimal? RevenueProgress { get; set; }          // report's own recognised-to-date amount
    public int MergedRowCount { get; set; } = 1;           // how many raw rows collapsed into this one

    public DateTime CreatedAt { get; set; }

    public RevenueMonth? Month { get; set; }
}
