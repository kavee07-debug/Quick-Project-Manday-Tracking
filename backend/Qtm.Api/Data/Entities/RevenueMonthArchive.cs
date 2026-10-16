namespace Qtm.Api.Data.Entities;

/// <summary>
/// An immutable snapshot of a whole <see cref="RevenueMonth"/>, numbered per period
/// (VersionNo 1, 2, 3 …) and stamped with who kept it and when.
///
/// <see cref="PayloadJson"/> holds the fully-computed detail — header plus every line, imported
/// and hand-keyed alike — rather than links back to the live tables. That is the point of the
/// table: a version has to keep reading the same forever, even after the period is re-imported,
/// re-edited, or the calculation itself changes. Nothing writes to a row after the INSERT.
/// Maps to dbo.RevenueMonthArchive.
/// </summary>
public class RevenueMonthArchive
{
    public int RevenueMonthArchiveId { get; set; }
    public int RevenueMonthId { get; set; }                // FK -> RevenueMonth (cascade)
    public int VersionNo { get; set; }                     // 1, 2, 3 … per period
    public DateTime ArchivedAt { get; set; }
    public string? ArchivedBy { get; set; }
    public string? Reason { get; set; }
    public bool IsAuto { get; set; }                       // taken automatically on Confirm

    // Denormalised so the version list renders without deserialising the payload.
    public int JobCount { get; set; }
    public decimal? TotalStd { get; set; }
    public decimal? TotalAct { get; set; }
    public decimal? TargetAmount { get; set; }
    public bool WasConfirmed { get; set; }

    public string PayloadJson { get; set; } = string.Empty;

    public RevenueMonth? Month { get; set; }
}
