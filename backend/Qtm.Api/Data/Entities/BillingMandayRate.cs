namespace Qtm.Api.Data.Entities;

/// <summary>
/// Baht per manday for one year. A billing line's manday is ROUND(Line Amount / the rate of its
/// posting year, 3) — computed when read, never stored, so changing a rate reaches every line of
/// the year at once. Maps to dbo.BillingMandayRate.
/// </summary>
public class BillingMandayRate
{
    public int Year { get; set; }
    public decimal Rate { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}
