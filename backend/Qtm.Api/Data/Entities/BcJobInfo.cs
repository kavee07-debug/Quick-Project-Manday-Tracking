namespace Qtm.Api.Data.Entities;

/// <summary>
/// A local copy of one BC job's name and Project Manager, refreshed on demand from the Billing
/// screen. Invoices reference far more jobs than the Project master or the D365 job staging hold,
/// and asking BC per page view would be too slow. Maps to dbo.BcJobInfo.
/// </summary>
public class BcJobInfo
{
    public string JobNo { get; set; } = string.Empty;
    public string? JobName { get; set; }
    public string? ProjectManager { get; set; }
    public string? PmEmail { get; set; }
    public string? CustomerName { get; set; }
    public string? Status { get; set; }
    public DateTime FetchedAt { get; set; }
}
