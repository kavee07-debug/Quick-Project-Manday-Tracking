using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;
using Qtm.Api.Services;

namespace Qtm.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController(QtmDbContext db, IPasswordHasher<User> hasher, JwtTokenService jwt) : ControllerBase
{
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

        var roles = user.Roles.Select(r => r.Name).ToArray();
        var (token, expiresAt) = jwt.Create(user, roles);
        return Ok(new AuthResult(token, user.Email, user.DisplayName, roles, expiresAt));
    }
}
