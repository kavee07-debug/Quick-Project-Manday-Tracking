/* ============================================================
   Migration: Timesheet staging + MandayEntry apply-traceability.
   Idempotent — safe to run repeatedly.
   ============================================================ */
USE QtmManday;
GO

/* ---- D365TimesheetStaging ---- */
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

/* ---- MandayEntry: apply-from-timesheet traceability + finer Manday precision ---- */
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
