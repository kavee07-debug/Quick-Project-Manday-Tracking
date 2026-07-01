using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// User + role administration. Admin-only. Users created here authenticate via Microsoft
/// (Entra ID) — no password is stored (PasswordHash stays null). Only users that exist here
/// and are active may sign in.
/// </summary>
[ApiController]
[Route("api/v1/users")]
[Authorize(Roles = Roles.Admin)]
public class UsersController(QtmDbContext db) : ControllerBase
{
    private static UserDto ToDto(User u) =>
        new(u.UserId, u.Email, u.DisplayName, u.IsActive, u.Roles.Select(r => r.Name).OrderBy(n => n).ToArray());

    private int CurrentUserId =>
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    [HttpGet]
    public async Task<ActionResult<IEnumerable<UserDto>>> List()
    {
        var users = await db.Users.Include(u => u.Roles).OrderBy(u => u.Email).ToListAsync();
        return Ok(users.Select(ToDto));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UserDto>> Get(int id)
    {
        var u = await db.Users.Include(x => x.Roles).FirstOrDefaultAsync(x => x.UserId == id);
        return u is null ? NotFound() : Ok(ToDto(u));
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(UserUpsert req)
    {
        var validation = Validate(req);
        if (validation is not null) return validation;

        var email = req.Email.Trim();
        if (await db.Users.AnyAsync(u => u.Email == email))
            return BadRequest(new { message = "อีเมลนี้มีอยู่แล้ว" });

        var user = new User
        {
            Email = email,
            DisplayName = req.DisplayName.Trim(),
            IsActive = req.IsActive,
            PasswordHash = null,               // Microsoft (Entra) auth — no local password
            CreatedAt = DateTime.UtcNow,
        };
        await AssignRolesAsync(user, req.Roles);

        db.Users.Add(user);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = user.UserId }, ToDto(user));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserDto>> Update(int id, UserUpsert req)
    {
        var user = await db.Users.Include(u => u.Roles).FirstOrDefaultAsync(u => u.UserId == id);
        if (user is null) return NotFound();

        var validation = Validate(req);
        if (validation is not null) return validation;

        // Guard: an admin cannot lock themselves out (deactivate self or drop own Admin role).
        if (id == CurrentUserId && (!req.IsActive || !req.Roles.Contains(Roles.Admin)))
            return BadRequest(new { message = "ไม่สามารถถอดสิทธิ์ Admin หรือปิดใช้งานบัญชีตัวเองได้" });

        user.DisplayName = req.DisplayName.Trim();
        user.IsActive = req.IsActive;
        user.UpdatedAt = DateTime.UtcNow;
        await AssignRolesAsync(user, req.Roles);

        await db.SaveChangesAsync();
        return Ok(ToDto(user));
    }

    /// <summary>Deactivates the user (soft) so they can no longer sign in. Keeps history intact.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Deactivate(int id)
    {
        if (id == CurrentUserId) return BadRequest(new { message = "ปิดใช้งานบัญชีตัวเองไม่ได้" });
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();
        user.IsActive = false;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return NoContent();
    }

    private ActionResult? Validate(UserUpsert req)
    {
        if (string.IsNullOrWhiteSpace(req.Email))
            return BadRequest(new { message = "ต้องระบุอีเมล" });
        if (string.IsNullOrWhiteSpace(req.DisplayName))
            return BadRequest(new { message = "ต้องระบุชื่อ" });
        if (req.Roles is null || req.Roles.Length == 0)
            return BadRequest(new { message = "ต้องเลือกอย่างน้อย 1 role" });
        if (req.Roles.Any(r => !Roles.All.Contains(r)))
            return BadRequest(new { message = "role ไม่ถูกต้อง (ต้องเป็น Admin/ProjectManager/User)" });
        return null;
    }

    // Replaces the user's roles with the requested set (loads Role entities by name).
    private async Task AssignRolesAsync(User user, string[] roleNames)
    {
        var roles = await db.Roles.Where(r => roleNames.Contains(r.Name)).ToListAsync();
        user.Roles.Clear();
        foreach (var r in roles) user.Roles.Add(r);
    }
}
