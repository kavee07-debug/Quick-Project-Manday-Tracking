/* ================================================================
   Migration 2026-09-25 09:31 — Revenue Monthly: Archive Version

   Adds dbo.RevenueMonthArchive — an immutable snapshot of a whole period,
   numbered per period (VersionNo 1, 2, 3 …) and stamped with who archived it
   and when.

   The archived figures live in PayloadJson as the fully-computed detail
   (header + every line, imported and hand-keyed alike) rather than as
   foreign keys into the live tables. That is deliberate: a version has to keep
   reading the same forever, even after the period is re-imported, re-edited,
   or the calculation itself changes. Nothing writes to a row of this table
   after the INSERT — there is no update path in the API.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-25-0931.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'RevenueMonthArchive';
GO
IF OBJECT_ID(N'dbo.RevenueMonthArchive', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RevenueMonthArchive (
        RevenueMonthArchiveId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_RevenueMonthArchive PRIMARY KEY,
        RevenueMonthId INT NOT NULL,
        VersionNo      INT NOT NULL,                  -- 1, 2, 3 … per period
        ArchivedAt     DATETIME2(0) NOT NULL
            CONSTRAINT DF_RevenueMonthArchive_ArchivedAt DEFAULT (SYSUTCDATETIME()),
        ArchivedBy     NVARCHAR(200) NULL,
        Reason         NVARCHAR(300) NULL,            -- why it was kept, free text
        IsAuto         BIT NOT NULL                   -- 1 = taken automatically on Confirm
            CONSTRAINT DF_RevenueMonthArchive_IsAuto DEFAULT (0),

        -- Denormalised so the version list can be rendered without parsing the payload.
        JobCount       INT NOT NULL
            CONSTRAINT DF_RevenueMonthArchive_JobCount DEFAULT (0),
        TotalStd       DECIMAL(18,2) NULL,
        TotalAct       DECIMAL(18,2) NULL,
        TargetAmount   DECIMAL(18,2) NULL,
        WasConfirmed   BIT NOT NULL
            CONSTRAINT DF_RevenueMonthArchive_WasConfirmed DEFAULT (0),

        PayloadJson    NVARCHAR(MAX) NOT NULL,        -- frozen RevenueMonthDetailDto

        CONSTRAINT FK_RevenueMonthArchive_Month FOREIGN KEY (RevenueMonthId)
            REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
        CONSTRAINT UQ_RevenueMonthArchive_Version UNIQUE (RevenueMonthId, VersionNo)
    );
END
GO

PRINT 'migrate-2026-09-25-0931: done.';
GO
