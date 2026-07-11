/* ================================================================
   Combined migration — 2026-07 release (D365 timesheet/task staging,
   master item, per-task revenue, item category, manday traceability).

   Idempotent — safe to run repeatedly on an existing QtmManday DB.
   Steps run in dependency-safe order (create tables, then add columns).
   A brand-new DB does NOT need this — db/schema.sql already has everything.

   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

/* ---- 1) MasterItem (D365BC item master) ---- */
PRINT '1/7  MasterItem';
GO
IF OBJECT_ID(N'dbo.MasterItem', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MasterItem (
        ItemId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MasterItem PRIMARY KEY,
        Number           NVARCHAR(50)  NOT NULL,
        DisplayName      NVARCHAR(300) NOT NULL CONSTRAINT DF_MasterItem_Name DEFAULT (N''),
        ItemCategoryCode NVARCHAR(50)  NULL,
        CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_MasterItem_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt        DATETIME2(0)  NULL,
        CONSTRAINT UQ_MasterItem_Number UNIQUE (Number)
    );
END
GO

/* ---- 2) D365TaskStaging (job tasks per staged project) ---- */
PRINT '2/7  D365TaskStaging';
GO
IF OBJECT_ID(N'dbo.D365TaskStaging', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.D365TaskStaging (
        TaskStagingId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365TaskStaging PRIMARY KEY,
        StagingId       INT NOT NULL,
        JobNo           NVARCHAR(50)  NOT NULL,
        TaskNo          NVARCHAR(50)  NOT NULL,
        TaskDescription NVARCHAR(300) NULL,
        SortOrder       INT NOT NULL CONSTRAINT DF_D365TaskStg_Sort DEFAULT (0),
        CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365TaskStg_Created DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_D365TaskStaging_Project FOREIGN KEY (StagingId)
            REFERENCES dbo.D365ProjectStaging(StagingId) ON DELETE CASCADE,
        CONSTRAINT UQ_D365TaskStaging_Staging_TaskNo UNIQUE (StagingId, TaskNo)
    );
END
GO

/* ---- 3) ItemCategoryCode on Task + D365TaskStaging ---- */
PRINT '3/7  ItemCategoryCode';
GO
IF COL_LENGTH(N'dbo.Task', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.Task ADD ItemCategoryCode NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.D365TaskStaging', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD ItemCategoryCode NVARCHAR(50) NULL;
GO

/* ---- 4) Revenue on Task ---- */
PRINT '4/7  Task.Revenue';
GO
IF COL_LENGTH(N'dbo.Task', N'Revenue') IS NULL
    ALTER TABLE dbo.Task ADD Revenue DECIMAL(18,2) NULL;
GO

/* ---- 5) Revenue on D365TaskStaging ---- */
PRINT '5/7  D365TaskStaging.Revenue';
GO
IF COL_LENGTH(N'dbo.D365TaskStaging', N'Revenue') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD Revenue DECIMAL(18,2) NULL;
GO

/* ---- 6) D365TimesheetStaging + MandayEntry apply-traceability ---- */
PRINT '6/7  D365TimesheetStaging + MandayEntry';
GO
IF OBJECT_ID(N'dbo.D365TimesheetStaging', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.D365TimesheetStaging (
        TimesheetStagingId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365TimesheetStaging PRIMARY KEY,
        SystemId        NVARCHAR(100) NOT NULL,
        JobNo           NVARCHAR(50)  NULL,
        JobTaskNo       NVARCHAR(50)  NULL,
        TimesheetDate   DATE          NULL,
        ResourceNo      NVARCHAR(50)  NULL,
        QuantityHour    DECIMAL(18,2) NULL,
        QuantityMD      DECIMAL(18,4) NULL,
        Comment         NVARCHAR(500) NULL,
        ProjectManager  NVARCHAR(50)  NULL,
        TimesheetStatus NVARCHAR(30)  NULL,
        NewJobNo        NVARCHAR(50)  NULL,
        NewTaskNo       NVARCHAR(50)  NULL,
        RawJson         NVARCHAR(MAX) NULL,
        FetchedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Ts_Fetched DEFAULT (SYSUTCDATETIME()),
        CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Ts_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt       DATETIME2(0)  NULL,
        CONSTRAINT UQ_D365TimesheetStaging_SystemId UNIQUE (SystemId)
    );
END
GO
IF COL_LENGTH(N'dbo.MandayEntry', N'SourceSystemId') IS NULL
    ALTER TABLE dbo.MandayEntry ADD SourceSystemId NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.MandayEntry', N'AppliedAt') IS NULL
    ALTER TABLE dbo.MandayEntry ADD AppliedAt DATETIME2(0) NULL;
GO
-- Widen Manday to hold finer timesheet MD (e.g. 0.375). Superset of the old DECIMAL(9,2).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.MandayEntry')
           AND name = N'Manday' AND (scale <> 4 OR precision <> 11))
    ALTER TABLE dbo.MandayEntry ALTER COLUMN Manday DECIMAL(11,4) NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Manday_SourceSystemId' AND object_id = OBJECT_ID(N'dbo.MandayEntry'))
    CREATE INDEX IX_Manday_SourceSystemId ON dbo.MandayEntry(SourceSystemId);
GO

/* ---- 7) Project.TimesheetMapping (D365 timesheet auto-map key) ---- */
PRINT '7/7  Project.TimesheetMapping';
GO
IF COL_LENGTH(N'dbo.Project', N'TimesheetMapping') IS NULL
    ALTER TABLE dbo.Project ADD TimesheetMapping NVARCHAR(200) NULL;
GO
-- Backfill existing rows so every project has a default mapping = its Code.
UPDATE dbo.Project SET TimesheetMapping = Code WHERE TimesheetMapping IS NULL;
GO

PRINT 'migrate-2026-07: done.';
GO
