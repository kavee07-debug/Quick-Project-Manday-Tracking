namespace Qtm.Api.Data.Entities;

/// <summary>
/// Item master synced from D365BC (number / displayName / itemCategoryCode).
/// Maps to dbo.MasterItem. Number is the business key. Used to map a
/// jobPlanningLines line back to its item category when computing project revenue.
/// </summary>
public class MasterItem
{
    public int ItemId { get; set; }
    public string Number { get; set; } = string.Empty;        // BC item "number"
    public string DisplayName { get; set; } = string.Empty;
    public string? ItemCategoryCode { get; set; }             // e.g. IMPLEMENT / CUSTOMIZE
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
