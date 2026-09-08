/* ================================================================
   Migration 2026-09-08 13:27 — Revenue Monthly: manual lines + monthly target

   Adds:
     dbo.RevenueMonth.TargetAmount — revenue the month is aiming at, so the
                    screen can show how far off the actual figure is.
     dbo.RevenueMonthManualLine    — jobs typed in by hand on the screen, mainly
                    to estimate revenue the QERP report does not carry yet. Kept
                    in its own table rather than on a snapshot side so that
                    re-importing either Excel file leaves these rows untouched.
                    Amount, when filled in, wins over the figure derived from
                    PrevProgress/CurrProgress.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-08-1327.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT '1/2  RevenueMonth: TargetAmount';
GO
IF COL_LENGTH(N'dbo.RevenueMonth', N'TargetAmount') IS NULL
    ALTER TABLE dbo.RevenueMonth ADD TargetAmount DECIMAL(18,2) NULL;
GO

PRINT '2/2  RevenueMonthManualLine';
GO
IF OBJECT_ID(N'dbo.RevenueMonthManualLine', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RevenueMonthManualLine (
        RevenueMonthManualLineId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_RevenueMonthManualLine PRIMARY KEY,
        RevenueMonthId INT NOT NULL,
        JobNo          NVARCHAR(50)  NOT NULL,
        JobName        NVARCHAR(300) NULL,
        Customer       NVARCHAR(300) NULL,
        Revenue        DECIMAL(18,2) NULL,       -- project value
        PrevProgress   DECIMAL(9,4)  NULL,       -- % at the end of last month
        CurrProgress   DECIMAL(9,4)  NULL,       -- % at the end of this month
        Amount         DECIMAL(18,2) NULL,       -- typed straight in; wins over the % calc
        Note           NVARCHAR(300) NULL,
        CreatedAt      DATETIME2(0) NOT NULL
            CONSTRAINT DF_RevenueMonthManualLine_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy      NVARCHAR(200) NULL,
        UpdatedAt      DATETIME2(0) NULL,
        CONSTRAINT FK_RevenueMonthManualLine_Month FOREIGN KEY (RevenueMonthId)
            REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
        CONSTRAINT UQ_RevenueMonthManualLine_Job UNIQUE (RevenueMonthId, JobNo)
    );
END
GO

PRINT 'migrate-2026-09-08-1327: done.';
GO
