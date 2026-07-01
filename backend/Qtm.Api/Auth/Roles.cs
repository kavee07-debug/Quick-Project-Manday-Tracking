namespace Qtm.Api.Auth;

/// <summary>Canonical RBAC role names (must match dbo.[Role].Name seed values).</summary>
public static class Roles
{
    public const string Admin = "Admin";
    public const string ProjectManager = "ProjectManager";
    public const string User = "User";           // read-only (replaces the old Viewer/Member)

    /// <summary>Roles allowed to create/update/delete projects, tasks, resources and all mandays.</summary>
    public const string Managers = Admin + "," + ProjectManager;

    /// <summary>Every role name, for validation / UI dropdowns.</summary>
    public static readonly string[] All = [Admin, ProjectManager, User];
}
