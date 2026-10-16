using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data.Entities;

namespace Qtm.Api.Data;

/// <summary>
/// Ensures the RBAC roles and a bootstrap admin user exist. Roles are also seeded by db/schema.sql,
/// but this guarantees the current set (Admin/ProjectManager/User) even on older databases that
/// pre-date a role (e.g. missing "User"). The admin's password hash format is owned by ASP.NET
/// Core Identity, so it cannot be precomputed in SQL.
/// </summary>
public static class DbSeeder
{
    private static string RoleDescription(string role) => role switch
    {
        Roles.Admin => "Full access + manage users",
        Roles.ProjectManager => "Manage projects, tasks, mandays",
        Roles.User => "Read-only",
        _ => role,
    };

    // Published in the repository (appsettings.json / the Production template), so never usable
    // as a real admin password.
    private static readonly string[] KnownPlaceholderPasswords = ["Admin@123", "CHANGE_ME_strong_admin_password"];

    public static async Task SeedAdminAsync(IServiceProvider sp, IConfiguration config, bool isProduction = false,
        ILogger? log = null)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QtmDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();

        // Ensure every RBAC role exists (idempotent) — so role assignment never silently drops a role.
        var existingRoles = await db.Roles.Select(r => r.Name).ToListAsync();
        foreach (var name in Roles.All.Where(n => !existingRoles.Contains(n)))
            db.Roles.Add(new Role { Name = name, Description = RoleDescription(name) });
        if (db.ChangeTracker.HasChanges())
            await db.SaveChangesAsync();

        var email = config["Seed:AdminEmail"] ?? "Admin1@qtmtraining.com";
        var password = config["Seed:AdminPassword"] ?? "Admin@123";

        if (await db.Users.AnyAsync(u => u.Email == email))
            return;

        // A fresh Production database must not get an admin whose password is in the repository.
        if (isProduction && KnownPlaceholderPasswords.Contains(password))
        {
            log?.LogWarning("Admin user not created: Seed:AdminPassword is still a repository placeholder. " +
                "Set a real one (App Service: Seed__AdminPassword) and restart.");
            return;
        }

        var adminRole = await db.Roles.FirstOrDefaultAsync(r => r.Name == Roles.Admin);
        if (adminRole is null)
            return; // should not happen now that roles are ensured above

        var user = new User
        {
            Email = email,
            DisplayName = "Administrator",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        };
        user.PasswordHash = hasher.HashPassword(user, password);
        user.Roles.Add(adminRole);

        db.Users.Add(user);
        await db.SaveChangesAsync();
    }
}
