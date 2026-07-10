namespace Qtm.Api.Data.Entities;

/// <summary>
/// A project candidate pulled from D365BC, held for review/edit before being promoted
/// to dbo.Project. JobNo (the BC "no") becomes Project.Code. Maps to dbo.D365ProjectStaging.
/// </summary>
public class D365ProjectStaging
{
    public int StagingId { get; set; }
    public string JobNo { get; set; } = string.Empty;   // BC "no", becomes Project.Code
    public string? ProjectName { get; set; }
    public string? BcJobId { get; set; }                 // BC job id (GUID) used to fetch the name
    public string? ProjectManagerCode { get; set; }
    public string? CustomerNo { get; set; }              // becomes Customer.Code (auto-created on promote)
    public string? CustomerName { get; set; }
    public string? Type { get; set; }                    // Project.Type (auto-suggested from name)
    public decimal? Revenue { get; set; }                // Project.Revenue
    public string? RawJson { get; set; }
    public DateTime FetchedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<D365TaskStaging> Tasks { get; set; } = new List<D365TaskStaging>();
}
