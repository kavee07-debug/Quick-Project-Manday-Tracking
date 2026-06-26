namespace Qtm.Api.Auth;

/// <summary>Canonical RBAC role names (must match dbo.[Role].Name seed values).</summary>
public static class Roles
{
    public const string Admin = "Admin";
    public const string ProjectManager = "ProjectManager";
    public const string Member = "Member";
    public const string Viewer = "Viewer";

    /// <summary>Roles allowed to create/update/delete projects, tasks and budget/adjust mandays.</summary>
    public const string Managers = Admin + "," + ProjectManager;

    /// <summary>Roles allowed to record actual mandays (managers + members).</summary>
    public const string Contributors = Admin + "," + ProjectManager + "," + Member;
}
