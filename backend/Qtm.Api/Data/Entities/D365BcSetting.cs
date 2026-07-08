namespace Qtm.Api.Data.Entities;

/// <summary>D365 Business Central connection settings — single row (Id = 1). Maps to dbo.D365BcSetting.</summary>
public class D365BcSetting
{
    public int Id { get; set; } = 1;
    public string TenantId { get; set; } = string.Empty;
    public string EnvironmentId { get; set; } = string.Empty;
    public string CompanyId { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
    public string ApiPublisher { get; set; } = string.Empty;
    public string ApiGroup { get; set; } = string.Empty;
    public string ApiVersion { get; set; } = string.Empty;
    public string ProjectManagerCodes { get; set; } = "Q63-036,Q63-041";  // comma-separated
    public DateTime UpdatedAt { get; set; }
}
