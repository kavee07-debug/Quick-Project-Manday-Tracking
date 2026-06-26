using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Qtm.Api.Auth;
using Qtm.Api.Dtos;
using Qtm.Api.Services;

namespace Qtm.Api.Controllers;

/// <summary>
/// In-app DB connection configuration. Admin-only. Reads/writes dbsettings.json via the
/// provider (not the database), so it stays usable even when the configured DB is unreachable.
/// </summary>
[ApiController]
[Route("api/v1/config")]
[Authorize(Roles = Roles.Admin)]
public class ConfigController(DbSettingsProvider provider) : ControllerBase
{
    [HttpGet("db")]
    public ActionResult<DbConfigDto> Get()
    {
        var s = provider.Current;
        return Ok(new DbConfigDto(
            s.Server, s.Database, s.IntegratedSecurity, s.Username,
            HasPassword: !string.IsNullOrEmpty(s.Password),
            s.TrustServerCertificate, s.Encrypt));
    }

    [HttpPost("db/test")]
    public async Task<ActionResult<DbTestResult>> Test(DbConfigUpsert req, CancellationToken ct)
    {
        var settings = Merge(req);
        try
        {
            await using var con = new SqlConnection(DbSettingsProvider.Build(settings));
            await con.OpenAsync(ct);
            await using var cmd = con.CreateCommand();
            cmd.CommandText = "SELECT 1";
            await cmd.ExecuteScalarAsync(ct);
            return Ok(new DbTestResult(true, $"เชื่อมต่อสำเร็จ ({settings.Server} / {settings.Database})"));
        }
        catch (Exception ex)
        {
            return Ok(new DbTestResult(false, ex.Message));
        }
    }

    [HttpPut("db")]
    public ActionResult<DbConfigDto> Save(DbConfigUpsert req)
    {
        var settings = Merge(req);
        provider.Update(settings);
        return Ok(new DbConfigDto(
            settings.Server, settings.Database, settings.IntegratedSecurity, settings.Username,
            HasPassword: !string.IsNullOrEmpty(settings.Password),
            settings.TrustServerCertificate, settings.Encrypt));
    }

    // Maps the request to settings, retaining the currently-stored password when the field is blank.
    private DbConnectionSettings Merge(DbConfigUpsert req)
    {
        var current = provider.Current;
        return new DbConnectionSettings
        {
            Server = req.Server.Trim(),
            Database = string.IsNullOrWhiteSpace(req.Database) ? "QtmManday" : req.Database.Trim(),
            IntegratedSecurity = req.IntegratedSecurity,
            Username = req.IntegratedSecurity ? null : req.Username?.Trim(),
            Password = req.IntegratedSecurity
                ? null
                : string.IsNullOrEmpty(req.Password) ? current.Password : req.Password,
            TrustServerCertificate = req.TrustServerCertificate,
            Encrypt = req.Encrypt,
        };
    }
}
