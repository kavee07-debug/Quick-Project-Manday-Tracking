using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Qtm.Api.Data;
using Qtm.Api.Data.Entities;
using Qtm.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- Configuration ----
var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>()
    ?? throw new InvalidOperationException("Missing Jwt configuration.");
builder.Services.AddSingleton(jwtSettings);

const string CorsPolicy = "frontend";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:3007"];

// ---- Services ----
// Connection string is resolved at runtime in QtmDbContext.OnConfiguring via DbSettingsProvider,
// so it can be reconfigured from the in-app Config page without a restart.
builder.Services.AddSingleton<DbSettingsProvider>();
builder.Services.AddDbContext<QtmDbContext>();

builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddSingleton<ExcelService>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();

builder.Services.AddCors(o => o.AddPolicy(CorsPolicy, p =>
    p.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
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

app.UseSwagger();
app.UseSwaggerUI();

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
    await DbSeeder.SeedAdminAsync(app.Services, app.Configuration);
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Admin seeding skipped — database not reachable/initialized yet.");
}

app.Run();
