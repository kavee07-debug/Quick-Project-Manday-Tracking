namespace Qtm.Api.Data.Entities;

/// <summary>
/// One monthly revenue-recognition period (e.g. 2026-08). Holds the import status of the two
/// QERP "Standard Progress vs Actual Progress" snapshots that get compared. Maps to dbo.RevenueMonth.
/// </summary>
public class RevenueMonth
{
    public int RevenueMonthId { get; set; }
    public int PeriodYear { get; set; }
    public int PeriodMonth { get; set; }                   // 1..12
    public string? Note { get; set; }

    // "Prev" = snapshot as of the end of the previous month; "Curr" = end of this month.
    public string? PrevFileName { get; set; }
    public string? PrevReportInfo { get; set; }            // the "Report : ..." filter line from the sheet
    public DateTime? PrevImportedAt { get; set; }
    public int PrevJobCount { get; set; }

    public string? CurrFileName { get; set; }
    public string? CurrReportInfo { get; set; }
    public DateTime? CurrImportedAt { get; set; }
    public int CurrJobCount { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<RevenueMonthSnapshot> Snapshots { get; set; } = new List<RevenueMonthSnapshot>();
}
