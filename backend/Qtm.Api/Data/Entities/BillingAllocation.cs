namespace Qtm.Api.Data.Entities;

/// <summary>
/// How much of one confirmed invoice line's Quantity a Billing-KPI resource gets — one cell of the
/// allocation matrix on the Billing Manday Allocate screen. A blank cell is simply no row. Signed,
/// because credit lines carry a negative Quantity. Maps to dbo.BillingAllocation.
/// </summary>
public class BillingAllocation
{
    public int BillingInvoiceLineId { get; set; }          // FK -> BillingInvoiceLine (cascade)
    public int ResourceId { get; set; }                    // FK -> Resource
    public decimal Quantity { get; set; }
    public DateTime UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}
