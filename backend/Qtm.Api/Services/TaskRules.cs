namespace Qtm.Api.Services;

/// <summary>Business rules applied when creating tasks (manual, Excel import, D365 staging).</summary>
public static class TaskRules
{
    /// <summary>
    /// Resolve a new task's status. A task whose description mentions "Confirm Order"
    /// is auto-completed (Done); otherwise the requested status is used (default Open).
    /// </summary>
    public static string ResolveStatus(string? description, string? requested)
    {
        if (!string.IsNullOrWhiteSpace(description) &&
            description.Contains("Confirm Order", StringComparison.OrdinalIgnoreCase))
            return "Done";
        return string.IsNullOrWhiteSpace(requested) ? "Open" : requested;
    }
}
