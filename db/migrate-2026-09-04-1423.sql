/* ================================================================
   Migration 2026-09-04 14:23 — Revenue Monthly

   Adds the two tables behind the new "Revenue Monthly" screen:
     dbo.RevenueMonth          — one monthly period (e.g. 2026-08) plus
                                 the import status of its two snapshots.
     dbo.RevenueMonthSnapshot  — one job per imported snapshot side
                                 (Prev = end of previous month,
                                  Curr = end of this month), parsed from the
                                 QERP "Standard Progress vs Actual Progress
                                 Summary" report. Not linked to dbo.Project on
                                 purpose — the report carries jobs that do not
                                 exist in the local project master.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-04-1423.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT '1/3  RevenueMonth';
GO
IF OBJECT_ID(N'dbo.RevenueMonth', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RevenueMonth (
        RevenueMonthId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RevenueMonth PRIMARY KEY,
        PeriodYear     INT NOT NULL,
        PeriodMonth    INT NOT NULL,
        Note           NVARCHAR(300) NULL,
        PrevFileName   NVARCHAR(260) NULL,
        PrevReportInfo NVARCHAR(500) NULL,
        PrevImportedAt DATETIME2(0)  NULL,
        PrevJobCount   INT NOT NULL CONSTRAINT DF_RevenueMonth_PrevJobCount DEFAULT (0),
        CurrFileName   NVARCHAR(260) NULL,
        CurrReportInfo NVARCHAR(500) NULL,
        CurrImportedAt DATETIME2(0)  NULL,
        CurrJobCount   INT NOT NULL CONSTRAINT DF_RevenueMonth_CurrJobCount DEFAULT (0),
        CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_RevenueMonth_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt      DATETIME2(0) NULL,
        CONSTRAINT UQ_RevenueMonth_Period UNIQUE (PeriodYear, PeriodMonth),
        CONSTRAINT CK_RevenueMonth_Month  CHECK (PeriodMonth BETWEEN 1 AND 12)
    );
END
GO

PRINT '2/3  RevenueMonthSnapshot';
GO
IF OBJECT_ID(N'dbo.RevenueMonthSnapshot', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RevenueMonthSnapshot (
        RevenueSnapshotId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RevenueMonthSnapshot PRIMARY KEY,
        RevenueMonthId  INT NOT NULL,
        Side            NVARCHAR(4)  NOT NULL,     -- Prev | Curr
        JobNo           NVARCHAR(50) NOT NULL,
        JobName         NVARCHAR(300) NULL,
        Customer        NVARCHAR(300) NULL,
        Pm              NVARCHAR(200) NULL,
        StdGroup        NVARCHAR(50)  NULL,
        Stage           NVARCHAR(100) NULL,
        Revenue         DECIMAL(18,2) NULL,
        ProgressStd     DECIMAL(9,4)  NULL,
        ProgressAct     DECIMAL(9,4)  NULL,
        RevenueProgress DECIMAL(18,2) NULL,
        MergedRowCount  INT NOT NULL CONSTRAINT DF_RevenueMonthSnapshot_Merged DEFAULT (1),
        CreatedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_RevenueMonthSnapshot_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_RevenueMonthSnapshot_Month FOREIGN KEY (RevenueMonthId)
            REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
        CONSTRAINT UQ_RevenueMonthSnapshot_Job UNIQUE (RevenueMonthId, Side, JobNo),
        CONSTRAINT CK_RevenueMonthSnapshot_Side CHECK (Side IN (N'Prev', N'Curr'))
    );
END
GO

PRINT '3/3  IX_RevenueMonthSnapshot_MonthSide';
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = N'IX_RevenueMonthSnapshot_MonthSide'
                 AND object_id = OBJECT_ID(N'dbo.RevenueMonthSnapshot'))
    CREATE INDEX IX_RevenueMonthSnapshot_MonthSide ON dbo.RevenueMonthSnapshot(RevenueMonthId, Side);
GO

PRINT 'migrate-2026-09-04-1423: done.';
GO
