using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data.Entities;

namespace Qtm.Api.Data;

/// <summary>
/// Ensures a bootstrap admin user exists with a hashed password. Roles themselves are seeded by
/// db/schema.sql; this only adds the login account (its password hash format is owned by ASP.NET
/// Core Identity, so it cannot be precomputed in SQL).
/// </summary>
public static class DbSeeder
{
    public static async Task SeedAdminAsync(IServiceProvider sp, IConfiguration config)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<QtmDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();

        var email = config["Seed:AdminEmail"] ?? "Admin1@qtmtraining.com";
        var password = config["Seed:AdminPassword"] ?? "Admin@123";

        if (await db.Users.AnyAsync(u => u.Email == email))
            return;

        var adminRole = await db.Roles.FirstOrDefaultAsync(r => r.Name == Roles.Admin);
        if (adminRole is null)
            return; // roles come from schema.sql; if absent, schema hasn't been applied

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
