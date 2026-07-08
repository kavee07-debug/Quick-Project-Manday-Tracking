namespace Qtm.Api.Data.Entities;

/// <summary>Log of D365BC sync attempts (one row per fetch). Maps to dbo.D365SyncLog.</summary>
public class D365SyncLog
{
    public int SyncId { get; set; }
    public string EntityName { get; set; } = string.Empty;   // e.g. Project
    public string Direction { get; set; } = "IN";
    public string Status { get; set; } = string.Empty;       // Success | Failed | Mock
    public string? Message { get; set; }
    public string? PayloadJson { get; set; }
    public DateTime CreatedAt { get; set; }
}
