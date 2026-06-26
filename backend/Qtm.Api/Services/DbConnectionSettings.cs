namespace Qtm.Api.Services;

/// <summary>Structured SQL Server connection settings, editable via the in-app Config page.</summary>
public class DbConnectionSettings
{
    public string Server { get; set; } = "";          // e.g. localhost\SQLEXPRESS or 10.0.0.5,1433 or (localdb)\MSSQLLocalDB
    public string Database { get; set; } = "QtmManday";
    public bool IntegratedSecurity { get; set; }       // true = Windows auth; false = SQL login
    public string? Username { get; set; }
    public string? Password { get; set; }
    public bool TrustServerCertificate { get; set; } = true;
    public bool Encrypt { get; set; }

    public DbConnectionSettings Clone() => (DbConnectionSettings)MemberwiseClone();
}
