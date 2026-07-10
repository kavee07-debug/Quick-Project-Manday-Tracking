using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Dtos;

namespace Qtm.Api.Controllers;

/// <summary>
/// Item master synced from D365BC (number / displayName / itemCategoryCode). The BC pull lives in
/// D365Controller (Admin-only); this exposes the list + delete. The data is BC-owned, so there is no
/// manual create/update.
/// </summary>
[ApiController]
[Route("api/v1/master-items")]
[Authorize]
public class MasterItemsController(QtmDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<MasterItemDto>>> List()
    {
        var items = await db.MasterItems.OrderBy(i => i.Number).ToListAsync();
        return Ok(items.Select(i => new MasterItemDto(i.ItemId, i.Number, i.DisplayName, i.ItemCategoryCode, i.UpdatedAt)));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Managers)]
    public async Task<IActionResult> Delete(int id)
    {
        var item = await db.MasterItems.FindAsync(id);
        if (item is null) return NotFound();
        db.MasterItems.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
