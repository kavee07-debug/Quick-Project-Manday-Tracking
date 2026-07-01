using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;
using Qtm.Api.Services;

namespace Qtm.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController(
    QtmDbContext db,
    IPasswordHasher<User> hasher,
    JwtTokenService jwt,
    IConfiguration config) : ControllerBase
{
    /// <summary>Legacy password login — kept for the bootstrap/admin account (break-glass).</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResult>> Login(LoginRequest req)
    {
        var user = await db.Users
            .Include(u => u.Roles)
            .FirstOrDefaultAsync(u => u.Email == req.Email && u.IsActive);

        if (user is null || string.IsNullOrEmpty(user.PasswordHash))
            return Unauthorized(new { message = "Invalid credentials" });

        var verify = hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
        if (verify == PasswordVerificationResult.Failed)
            return Unauthorized(new { message = "Invalid credentials" });

        return Ok(Issue(user));
    }

    /// <summary>
    /// Microsoft (Entra ID) login. The frontend signs in with MSAL and calls this with the
    /// Microsoft token as the Bearer (validated by the "EntraId" scheme). We map the verified
    /// identity to an app user + roles and issue our own app JWT — no password is stored.
    /// </summary>
    [HttpPost("ms-login")]
    [Authorize(AuthenticationSchemes = AuthSchemes.EntraId)]
    public async Task<ActionResult<AuthResult>> MsLogin()
    {
        var email = User.FindFirstValue("preferred_username")
                    ?? User.FindFirstValue(ClaimTypes.Email)
                    ?? User.FindFirstValue(ClaimTypes.Upn);
        if (string.IsNullOrWhiteSpace(email))
            return Unauthorized(new { message = "ไม่พบอีเมลใน Microsoft token" });

        var name = User.FindFirstValue("name") ?? User.FindFirstValue(ClaimTypes.Name) ?? email;

        var user = await db.Users
            .Include(u => u.Roles)
            .FirstOrDefaultAsync(u => u.Email == email);

        // Bootstrap: emails listed in Auth:AdminEmails become Admin on first sign-in.
        if (user is null)
        {
            var adminEmails = config.GetSection("Auth:AdminEmails").Get<string[]>() ?? [];
            if (!adminEmails.Any(e => string.Equals(e, email, StringComparison.OrdinalIgnoreCase)))
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ" });

            var adminRole = await db.Roles.FirstOrDefaultAsync(r => r.Name == Roles.Admin);
            if (adminRole is null)
                return StatusCode(StatusCodes.Status500InternalServerError, new { message = "ยังไม่ได้ตั้งค่า role (schema)" });

            user = new User { Email = email, DisplayName = name, IsActive = true, CreatedAt = DateTime.UtcNow };
            user.Roles.Add(adminRole);
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }
        else if (!user.IsActive)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" });
        }

        return Ok(Issue(user));
    }

    private AuthResult Issue(User user)
    {
        var roles = user.Roles.Select(r => r.Name).ToArray();
        var (token, expiresAt) = jwt.Create(user, roles);
        return new AuthResult(token, user.Email, user.DisplayName, roles, expiresAt);
    }
}
