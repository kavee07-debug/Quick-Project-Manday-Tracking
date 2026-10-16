using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Qtm.Api.Auth;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- Configuration ----
var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>()
    ?? throw new InvalidOperationException("Missing Jwt configuration.");
builder.Services.AddSingleton(jwtSettings);

// The repo ships development defaults for the signing key and the seeded admin password so that
// `dotnet run` works out of the box. appsettings.Production.json is gitignored and therefore does
// NOT travel with the build artifact — on a host that supplies configuration through environment
// variables instead (Azure App Service), forgetting to set them would silently publish an app
// signing tokens with a public key and an admin account whose password is in this repository.
// Refuse to start on a public signing key. The seeded admin password is handled by DbSeeder
// instead (it only matters when the admin does not exist yet, so an existing install that never
// overrode it must keep starting) — in Production it simply won't create an admin with it.
if (builder.Environment.IsProduction())
{
    // Both the appsettings.json dev value and the appsettings.Production.json template
    // placeholder — every one of these strings is published in the repository.
    string[] knownJwtKeys = [
        "CHANGE_THIS_DEV_ONLY_super_secret_signing_key_at_least_32_chars_long",
        "CHANGE_THIS_TO_A_STRONG_RANDOM_SECRET_AT_LEAST_32_CHARS_LONG",
    ];

    if (string.IsNullOrWhiteSpace(jwtSettings.Key) || knownJwtKeys.Contains(jwtSettings.Key))
        throw new InvalidOperationException(
            "Jwt:Key is still a placeholder from the repository. Set a real secret " +
            "(App Service: Jwt__Key) before starting in Production.");
}

const string CorsPolicy = "frontend";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:3007"];

// Entra ID (Azure AD) — used to validate the Microsoft ID token at /auth/ms-login.
var aad = builder.Configuration.GetSection("AzureAd");
var aadInstance = (aad["Instance"] ?? "https://login.microsoftonline.com/").TrimEnd('/');
var aadTenant = aad["TenantId"] ?? "common";
var aadClientId = aad["ClientId"] ?? "";

// ---- Services ----
// Connection string is resolved at runtime in QtmDbContext.OnConfiguring via DbSettingsProvider,
// so it can be reconfigured from the in-app Config page without a restart.
builder.Services.AddSingleton<DbSettingsProvider>();
builder.Services.AddDbContext<QtmDbContext>();

builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddSingleton<ExcelService>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

// D365 Business Central integration (Admin-only API screens).
// Explicit timeout: the sync endpoints page through D365 in a loop inside a single request, and
// App Service cuts an idle request at 230s. Failing a slow page fast beats losing the whole call.
builder.Services.AddHttpClient<D365BcClient>(c => c.Timeout = TimeSpan.FromSeconds(60));
builder.Services.AddScoped<D365JobService>();
builder.Services.AddScoped<D365TimesheetService>();

builder.Services.AddCors(o => o.AddPolicy(CorsPolicy, p =>
    p.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    // Default scheme: the app's own JWT (issued by /auth/login and /auth/ms-login).
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    })
    // Second scheme: validates the Microsoft (Entra ID) ID token, used only by /auth/ms-login.
    // ID token: issuer = {tenant}/v2.0, audience = ClientId. (TenantId/ClientId from "AzureAd".)
    .AddJwtBearer(AuthSchemes.EntraId, opt =>
    {
        opt.Authority = $"{aadInstance}/{aadTenant}/v2.0";
        opt.Audience = aadClientId;
        opt.TokenValidationParameters.NameClaimType = "name";
    });
builder.Services.AddAuthorization();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Quick Project Manday Tracking API", Version = "v1" });
    var scheme = new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" },
    };
    c.AddSecurityDefinition("Bearer", scheme);
    c.AddSecurityRequirement(new OpenApiSecurityRequirement { [scheme] = Array.Empty<string>() });
});

var app = builder.Build();

// Off in Production by default: on-prem the API is LAN-only, but on Azure it is reachable from
// the internet and there is no reason to publish the full endpoint surface there. Set
// "Swagger:Enabled" to override either way (e.g. to bring it back on a LAN-only prod host).
if (app.Configuration.GetValue("Swagger:Enabled", !app.Environment.IsProduction()))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Serve the built React app (wwwroot) from the same origin as the API, so no
// reverse-proxy/CORS is needed: /api/* hits the controllers, everything else
// falls back to index.html for client-side (SPA) routing.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors(CorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
// SPA fallback: any non-API, non-file route returns index.html (so refreshing /projects works).
app.MapFallbackToFile("index.html");

// Bootstrap admin login account (roles themselves come from db/schema.sql).
// Resilient: a bad/unreachable DB must not stop the app from starting — the Config page
// (which reads/writes dbsettings.json, not the DB) needs to stay reachable to fix it.
try
{
    await DbSeeder.SeedAdminAsync(app.Services, app.Configuration, app.Environment.IsProduction(), app.Logger);
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Admin seeding skipped — database not reachable/initialized yet.");
}

app.Run();
