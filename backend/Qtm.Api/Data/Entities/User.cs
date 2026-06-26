namespace Qtm.Api.Data.Entities;

/// <summary>Application user for JWT auth. Maps to dbo.[User].</summary>
public class User
{
    public int UserId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? PasswordHash { get; set; }              // null when auth is external/SSO
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    public ICollection<Role> Roles { get; set; } = new List<Role>();
}
