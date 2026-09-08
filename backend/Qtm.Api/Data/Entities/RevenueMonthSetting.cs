namespace Qtm.Api.Data.Entities;

/// <summary>
/// Single-row (Id = 1) defaults applied when creating a Revenue Monthly period.
/// Maps to dbo.RevenueMonthSetting.
/// </summary>
public class RevenueMonthSetting
{
    public int Id { get; set; }                            // fixed = 1
    public decimal? DefaultTargetAmount { get; set; }      // prefilled as the new period's Target
    public DateTime? UpdatedAt { get; set; }
}
