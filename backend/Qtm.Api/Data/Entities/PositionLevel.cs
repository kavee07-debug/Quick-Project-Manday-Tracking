namespace Qtm.Api.Data.Entities;

/// <summary>
/// A level within a Position (e.g. SA / SR = Senior SA). Keyed by (Position, Code) — the same code
/// may exist under several positions. Maps to dbo.PositionLevel.
/// </summary>
public class PositionLevel
{
    public string Position { get; set; } = string.Empty;   // Dev | SA | PM
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

/// <summary>
/// Manday target per person at one Position Level for one year — compared with each resource's
/// allocated Billing Manday on the Billing KPI Manday screen. Maps to dbo.PositionLevelTarget.
/// </summary>
public class PositionLevelTarget
{
    public string Position { get; set; } = string.Empty;
    public string LevelCode { get; set; } = string.Empty;
    public int Year { get; set; }
    public decimal TargetManday { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}
