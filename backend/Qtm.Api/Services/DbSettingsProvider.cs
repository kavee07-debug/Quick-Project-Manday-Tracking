using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace Qtm.Api.Services;

/// <summary>
/// Singleton source of truth for the live DB connection. Persists structured settings to
/// dbsettings.json (so they survive restarts and are editable while the DB is down — the
/// connection can't be stored in the DB itself). Falls back to the appsettings bootstrap
/// connection string ("ConnectionStrings:Qtm") on first run.
///
/// Note: the password is stored in plaintext in dbsettings.json — acceptable for local/dev;
/// encrypt at rest (e.g. DPAPI / Key Vault) before production.
/// </summary>
public class DbSettingsProvider
{
    private readonly string _filePath;
    private readonly object _lock = new();
    private DbConnectionSettings _current;

    public DbSettingsProvider(IConfiguration config, IHostEnvironment env)
    {
        _filePath = Path.Combine(env.ContentRootPath, "dbsettings.json");

        if (File.Exists(_filePath))
        {
            _current = JsonSerializer.Deserialize<DbConnectionSettings>(File.ReadAllText(_filePath))
                       ?? FromBootstrap(config);
        }
        else
        {
            _current = FromBootstrap(config);
        }
    }

    /// <summary>Connection string the DbContext should use right now.</summary>
    public string GetConnectionString() => Build(Current);

    /// <summary>A copy of the current settings (caller is responsible for masking the password).</summary>
    public DbConnectionSettings Current
    {
        get { lock (_lock) return _current.Clone(); }
    }

    /// <summary>Persists new settings and makes them live for subsequently-created DbContexts.</summary>
    public void Update(DbConnectionSettings settings)
    {
        lock (_lock)
        {
            _current = settings.Clone();
            File.WriteAllText(_filePath, JsonSerializer.Serialize(_current,
                new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    /// <summary>Builds a connection string from arbitrary settings (used by Test before saving).</summary>
    public static string Build(DbConnectionSettings s)
    {
        var b = new SqlConnectionStringBuilder
        {
            DataSource = s.Server,
            InitialCatalog = s.Database,
            TrustServerCertificate = s.TrustServerCertificate,
            Encrypt = s.Encrypt,
            ConnectTimeout = 5,
        };
        if (s.IntegratedSecurity)
        {
            b.IntegratedSecurity = true;
        }
        else
        {
            b.UserID = s.Username ?? "";
            b.Password = s.Password ?? "";
        }
        return b.ConnectionString;
    }

    private static DbConnectionSettings FromBootstrap(IConfiguration config)
    {
        var raw = config.GetConnectionString("Qtm") ?? "";
        var csb = new SqlConnectionStringBuilder(raw);
        return new DbConnectionSettings
        {
            Server = csb.DataSource,
            Database = string.IsNullOrEmpty(csb.InitialCatalog) ? "QtmManday" : csb.InitialCatalog,
            IntegratedSecurity = csb.IntegratedSecurity,
            Username = string.IsNullOrEmpty(csb.UserID) ? null : csb.UserID,
            Password = string.IsNullOrEmpty(csb.Password) ? null : csb.Password,
            TrustServerCertificate = csb.TrustServerCertificate,
            Encrypt = csb.Encrypt,
        };
    }
}
