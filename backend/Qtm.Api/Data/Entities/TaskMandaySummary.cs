namespace Qtm.Api.Data.Entities;

/// <summary>Read-only projection of dbo.vTaskMandaySummary (Budget vs Actual+Adjust per task).</summary>
public class TaskMandaySummary
{
    public int TaskId { get; set; }
    public int ProjectId { get; set; }
    public string TaskName { get; set; } = string.Empty;
    public decimal TotalBudget { get; set; }
    public decimal TotalActual { get; set; }
    public decimal TotalAdjust { get; set; }
    public decimal Remaining { get; set; }       // (Budget + Adjust) - Actual
}
