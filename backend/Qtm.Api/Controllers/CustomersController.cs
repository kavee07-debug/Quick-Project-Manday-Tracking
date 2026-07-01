using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>Customer master (owns projects). CRUD is Manager-only.</summary>
[ApiController]
[Route("api/v1/customers")]
[Authorize]
public class CustomersController(QtmDbContext db) : ControllerBase
{
    private static CustomerDto ToDto(Customer c) => new(c.CustomerId, c.Code, c.Name, c.IsActive);

    /// <summary>Active customers by default (for dropdowns); pass includeInactive=true for the master page.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<CustomerDto>>> List([FromQuery] bool includeInactive = false)
    {
        var q = db.Customers.AsQueryable();
        if (!includeInactive) q = q.Where(c => c.IsActive);
        var items = await q.OrderBy(c => c.Code).ToListAsync();
        return Ok(items.Select(ToDto));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<CustomerDto>> Get(int id)
    {
        var c = await db.Customers.FindAsync(id);
        return c is null ? NotFound() : Ok(ToDto(c));
    }

    [HttpPost]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<CustomerDto>> Create(CustomerUpsert req)
    {
        if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "ต้องมี Code และ Name" });
        if (await db.Customers.AnyAsync(c => c.Code == req.Code))
            return Conflict(new { message = $"Customer code '{req.Code}' มีอยู่แล้ว" });

        var c = new Customer { Code = req.Code.Trim(), Name = req.Name.Trim(), IsActive = req.IsActive, CreatedAt = DateTime.UtcNow };
        db.Customers.Add(c);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = c.CustomerId }, ToDto(c));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<ActionResult<CustomerDto>> Update(int id, CustomerUpsert req)
    {
        var c = await db.Customers.FindAsync(id);
        if (c is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.Code) || string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "ต้องมี Code และ Name" });
        if (req.Code != c.Code && await db.Customers.AnyAsync(x => x.Code == req.Code))
            return Conflict(new { message = $"Customer code '{req.Code}' มีอยู่แล้ว" });

        c.Code = req.Code.Trim();
        c.Name = req.Name.Trim();
        c.IsActive = req.IsActive;
        c.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(ToDto(c));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var c = await db.Customers.FindAsync(id);
        if (c is null) return NotFound();

        // Customers referenced by projects can't be hard-deleted (FK) — deactivate instead.
        if (await db.Projects.AnyAsync(p => p.CustomerId == id))
            return Conflict(new { message = "ลูกค้านี้ถูกใช้ในโปรเจกต์แล้ว ลบไม่ได้ — ให้ปิดใช้งาน (Inactive) แทน" });

        db.Customers.Remove(c);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
