using Microsoft.EntityFrameworkCore;
using Qtm.Api.Data.Entities;
using Qtm.Api.Services;

namespace Qtm.Api.Data;

/// <summary>
/// DB-first context. Mappings mirror db/schema.sql exactly — EF does not own the schema and
/// no migrations are generated. schema.sql remains the single source of truth.
///
/// The connection string is resolved per-context from <see cref="DbSettingsProvider"/> in
/// OnConfiguring, so it can be changed at runtime via the Config page without a restart.
/// </summary>
public class QtmDbContext(DbContextOptions<QtmDbContext> options, DbSettingsProvider dbSettings)
    : DbContext(options)
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured)
            optionsBuilder.UseSqlServer(dbSettings.GetConnectionString());
    }

    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<MandayEntry> MandayEntries => Set<MandayEntry>();
    public DbSet<ResourceItem> Resources => Set<ResourceItem>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<TaskMandaySummary> TaskMandaySummaries => Set<TaskMandaySummary>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Project>(e =>
        {
            e.ToTable("Project");
            e.HasKey(x => x.ProjectId);
            e.Property(x => x.Code).HasMaxLength(50);
            e.Property(x => x.Name).HasMaxLength(300);
            e.Property(x => x.Type).HasMaxLength(20);
            e.Property(x => x.Status).HasMaxLength(30);
            e.Property(x => x.Progress).HasColumnType("decimal(5,2)");
            e.Property(x => x.Revenue).HasColumnType("decimal(18,2)");
            e.HasIndex(x => x.Code).IsUnique();
            e.HasOne(x => x.Customer)
                .WithMany(c => c.Projects)
                .HasForeignKey(x => x.CustomerId);
        });

        b.Entity<Customer>(e =>
        {
            e.ToTable("Customer");
            e.HasKey(x => x.CustomerId);
            e.Property(x => x.Code).HasMaxLength(50);
            e.Property(x => x.Name).HasMaxLength(300);
            e.HasIndex(x => x.Code).IsUnique();
        });

        b.Entity<TaskItem>(e =>
        {
            e.ToTable("Task");
            e.HasKey(x => x.TaskId);
            e.Property(x => x.Name).HasMaxLength(300);
            e.Property(x => x.Status).HasMaxLength(30);
            e.HasOne(x => x.Project)
                .WithMany(p => p.Tasks)
                .HasForeignKey(x => x.ProjectId);
            e.HasIndex(x => new { x.ProjectId, x.Name }).IsUnique();
        });

        b.Entity<MandayEntry>(e =>
        {
            e.ToTable("MandayEntry");
            e.HasKey(x => x.MandayEntryId);
            e.Property(x => x.EntryType).HasMaxLength(10);
            e.Property(x => x.Manday).HasColumnType("decimal(9,2)");
            e.Property(x => x.Note).HasMaxLength(500);
            e.HasOne(x => x.Task)
                .WithMany(t => t.MandayEntries)
                .HasForeignKey(x => x.TaskId);
            e.HasOne(x => x.Resource)
                .WithMany()
                .HasForeignKey(x => x.ResourceId);
        });

        b.Entity<ResourceItem>(e =>
        {
            e.ToTable("Resource");
            e.HasKey(x => x.ResourceId);
            e.Property(x => x.Code).HasMaxLength(50);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Position).HasMaxLength(20);
            e.HasIndex(x => x.Code).IsUnique();
        });

        b.Entity<User>(e =>
        {
            e.ToTable("User");
            e.HasKey(x => x.UserId);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.DisplayName).HasMaxLength(200);
            e.Property(x => x.PasswordHash).HasMaxLength(512);
            e.HasIndex(x => x.Email).IsUnique();
            e.HasMany(x => x.Roles)
                .WithMany(r => r.Users)
                .UsingEntity(j =>
                {
                    j.ToTable("UserRole");
                    j.Property<int>("UsersUserId").HasColumnName("UserId");
                    j.Property<int>("RolesRoleId").HasColumnName("RoleId");
                });
        });

        b.Entity<Role>(e =>
        {
            e.ToTable("Role");
            e.HasKey(x => x.RoleId);
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Description).HasMaxLength(400);
            e.HasIndex(x => x.Name).IsUnique();
        });

        b.Entity<TaskMandaySummary>(e =>
        {
            e.HasNoKey();
            e.ToView("vTaskMandaySummary");
            foreach (var prop in new[] { nameof(TaskMandaySummary.TotalBudget), nameof(TaskMandaySummary.TotalActual),
                nameof(TaskMandaySummary.TotalAdjust), nameof(TaskMandaySummary.Remaining) })
                e.Property(prop).HasColumnType("decimal(9,2)");
        });
    }
}
