namespace Qtm.Api.Data.Entities;

/// <summary>A person who consumes mandays. Maps to dbo.Resource (named ResourceItem to avoid ambiguity).</summary>
public class ResourceItem
{
    public int ResourceId { get; set; }
    public string Code { get; set; } = string.Empty;       // short code e.g. KAVEE
    public string Name { get; set; } = string.Empty;       // display name e.g. Kavee
    public string? Position { get; set; }                  // Dev | SA | PM
    public string? PositionLevelCode { get; set; }         // level within Position (dbo.PositionLevel)
    public bool IsActive { get; set; } = true;
    public bool IsBillingKpi { get; set; }                 // counts toward the Billing KPI (allocation matrix column)
}
