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
    public DbSet<MasterItem> MasterItems => Set<MasterItem>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<TaskMandaySummary> TaskMandaySummaries => Set<TaskMandaySummary>();
    public DbSet<D365BcSetting> D365BcSettings => Set<D365BcSetting>();
    public DbSet<D365ProjectStaging> D365ProjectStagings => Set<D365ProjectStaging>();
    public DbSet<D365TaskStaging> D365TaskStagings => Set<D365TaskStaging>();
    public DbSet<D365TimesheetStaging> D365TimesheetStagings => Set<D365TimesheetStaging>();
    public DbSet<D365SyncLog> D365SyncLogs => Set<D365SyncLog>();
    public DbSet<MeetingRecord> Meetings => Set<MeetingRecord>();
    public DbSet<MeetingLine> MeetingLines => Set<MeetingLine>();
    public DbSet<MeetingSetting> MeetingSettings => Set<MeetingSetting>();

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
            e.Property(x => x.TimesheetMapping).HasMaxLength(200);
            e.Property(x => x.TrainingDate).HasMaxLength(200);
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
            e.Property(x => x.ItemCategoryCode).HasMaxLength(50);
            e.Property(x => x.Revenue).HasColumnType("decimal(18,2)");
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
            e.Property(x => x.Manday).HasColumnType("decimal(11,4)");
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.SourceSystemId).HasMaxLength(100);
            e.HasIndex(x => x.SourceSystemId);
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

        b.Entity<MasterItem>(e =>
        {
            e.ToTable("MasterItem");
            e.HasKey(x => x.ItemId);
            e.Property(x => x.Number).HasMaxLength(50);
            e.Property(x => x.DisplayName).HasMaxLength(300);
            e.Property(x => x.ItemCategoryCode).HasMaxLength(50);
            e.HasIndex(x => x.Number).IsUnique();
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

        b.Entity<D365BcSetting>(e =>
        {
            e.ToTable("D365BcSetting");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.TenantId).HasMaxLength(100);
            e.Property(x => x.EnvironmentId).HasMaxLength(100);
            e.Property(x => x.CompanyId).HasMaxLength(100);
            e.Property(x => x.ClientId).HasMaxLength(200);
            e.Property(x => x.ClientSecret).HasMaxLength(400);
            e.Property(x => x.ApiPublisher).HasMaxLength(100);
            e.Property(x => x.ApiGroup).HasMaxLength(100);
            e.Property(x => x.ApiVersion).HasMaxLength(20);
            e.Property(x => x.ProjectManagerCodes).HasMaxLength(200);
        });

        b.Entity<D365ProjectStaging>(e =>
        {
            e.ToTable("D365ProjectStaging");
            e.HasKey(x => x.StagingId);
            e.Property(x => x.JobNo).HasMaxLength(50);
            e.Property(x => x.ProjectName).HasMaxLength(300);
            e.Property(x => x.BcJobId).HasMaxLength(100);
            e.Property(x => x.ProjectManagerCode).HasMaxLength(50);
            e.Property(x => x.CustomerNo).HasMaxLength(50);
            e.Property(x => x.CustomerName).HasMaxLength(300);
            e.Property(x => x.Type).HasMaxLength(20);
            e.Property(x => x.Revenue).HasColumnType("decimal(18,2)");
            e.HasIndex(x => x.JobNo).IsUnique();
            e.HasMany(x => x.Tasks)
                .WithOne(t => t.Staging)
                .HasForeignKey(t => t.StagingId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<D365TaskStaging>(e =>
        {
            e.ToTable("D365TaskStaging");
            e.HasKey(x => x.TaskStagingId);
            e.Property(x => x.JobNo).HasMaxLength(50);
            e.Property(x => x.TaskNo).HasMaxLength(50);
            e.Property(x => x.TaskDescription).HasMaxLength(300);
            e.Property(x => x.ItemCategoryCode).HasMaxLength(50);
            e.Property(x => x.Revenue).HasColumnType("decimal(18,2)");
            e.HasIndex(x => new { x.StagingId, x.TaskNo }).IsUnique();
        });

        b.Entity<D365TimesheetStaging>(e =>
        {
            e.ToTable("D365TimesheetStaging");
            e.HasKey(x => x.TimesheetStagingId);
            e.Property(x => x.SystemId).HasMaxLength(100);
            e.Property(x => x.JobNo).HasMaxLength(50);
            e.Property(x => x.JobTaskNo).HasMaxLength(50);
            e.Property(x => x.ResourceNo).HasMaxLength(50);
            e.Property(x => x.QuantityHour).HasColumnType("decimal(18,2)");
            e.Property(x => x.QuantityMD).HasColumnType("decimal(18,4)");
            e.Property(x => x.Comment).HasMaxLength(500);
            e.Property(x => x.ProjectManager).HasMaxLength(50);
            e.Property(x => x.TimesheetStatus).HasMaxLength(30);
            e.Property(x => x.NewJobNo).HasMaxLength(50);
            e.Property(x => x.NewTaskNo).HasMaxLength(50);
            e.HasIndex(x => x.SystemId).IsUnique();
        });

        b.Entity<D365SyncLog>(e =>
        {
            e.ToTable("D365SyncLog");
            e.HasKey(x => x.SyncId);
            e.Property(x => x.EntityName).HasMaxLength(100);
            e.Property(x => x.Direction).HasMaxLength(10);
            e.Property(x => x.Status).HasMaxLength(20);
        });

        b.Entity<MeetingRecord>(e =>
        {
            e.ToTable("MeetingRecord");
            e.HasKey(x => x.MeetingId);
            e.Property(x => x.Topic).HasMaxLength(300);
            e.Property(x => x.PreparedBy).HasMaxLength(200);
            e.Property(x => x.CertifiedBy).HasMaxLength(200);
            e.Property(x => x.NextMeetingPreparedBy).HasMaxLength(200);
            e.Property(x => x.ClosedBy).HasMaxLength(200);
        });

        b.Entity<MeetingLine>(e =>
        {
            e.ToTable("MeetingLine");
            e.HasKey(x => x.MeetingLineId);
            e.Property(x => x.StatusSnapshot).HasMaxLength(30);
            e.Property(x => x.ProgressSnapshot).HasColumnType("decimal(5,2)");
            e.HasIndex(x => new { x.MeetingId, x.ProjectId }).IsUnique();
            e.HasOne(x => x.Meeting)
                .WithMany(m => m.Lines)
                .HasForeignKey(x => x.MeetingId);
            e.HasOne(x => x.Project)
                .WithMany()
                .HasForeignKey(x => x.ProjectId)
                .OnDelete(DeleteBehavior.Restrict);   // lookup FK — must not cascade (schema has no cascade here)
        });

        b.Entity<MeetingSetting>(e =>
        {
            e.ToTable("MeetingSetting");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.DefaultPreparedBy).HasMaxLength(200);
        });
    }
}
