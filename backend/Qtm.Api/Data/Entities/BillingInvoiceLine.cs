namespace Qtm.Api.Data.Entities;

/// <summary>
/// One line of the BC "Posted Sales Invoice Lines" export, imported on the Billing Manday Allocate
/// screen. The export has no per-line key, so a line is its Document No. plus its position in that
/// document (<see cref="LineSeq"/>). Posted invoices never change in BC, so an import only adds
/// documents not seen before. Deliberately not linked to dbo.Project — <see cref="ProjectNo"/> is matched
/// by code when read, since invoices can reference jobs the local master does not have.
/// Maps to dbo.BillingInvoiceLine.
/// </summary>
public class BillingInvoiceLine
{
    public int BillingInvoiceLineId { get; set; }
    public string DocumentNo { get; set; } = string.Empty;
    public int LineSeq { get; set; }
    public DateOnly? PostingDate { get; set; }
    public string? CustomerNo { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerSearchName { get; set; }
    public string LineType { get; set; } = string.Empty;  // Item | Resource
    public string? ItemNo { get; set; }
    public string? ItemCategoryCode { get; set; }
    public string? Description { get; set; }
    public decimal? Quantity { get; set; }
    public string? UnitOfMeasure { get; set; }
    public decimal? UnitPrice { get; set; }
    public decimal? LineDiscountPct { get; set; }
    public decimal? LineAmount { get; set; }
    public decimal? AmountInclVat { get; set; }
    public string? BoiCode { get; set; }
    public string? ProjectNo { get; set; }
    public string? ProjectTaskNo { get; set; }
    public int? ContractEntryNo { get; set; }
    public int? JobPlanningLineNo { get; set; }
    public string? JobPlanningDescription { get; set; }

    public bool IsConfirmed { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public string? ConfirmedBy { get; set; }

    // Allocation finished and locked: the matrix cells are read-only and the line can't be
    // un-confirmed until unlocked. Only a fully allocated line may be locked.
    public bool IsAllocLocked { get; set; }
    public DateTime? AllocLockedAt { get; set; }
    public string? AllocLockedBy { get; set; }

    // "Other" allocation: manday given to someone outside the resource master (another department…).
    // Kept on the line because BillingAllocation needs a real ResourceId; counts toward the line's
    // allocated total like any matrix cell.
    public decimal? OtherQuantity { get; set; }
    public string? OtherNote { get; set; }

    // Soft delete: kept as a tombstone so a later export of the same document cannot bring it back.
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    public string? SourceFileName { get; set; }
    public DateTime ImportedAt { get; set; }
    public string? ImportedBy { get; set; }
}
