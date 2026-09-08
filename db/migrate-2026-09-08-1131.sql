/* ================================================================
   Migration 2026-09-08 11:31 — Revenue Monthly: manual % override

   Adds to dbo.RevenueMonthSnapshot:
     OverrideProgressStd / OverrideProgressAct — this month's % corrected by
                                 hand on the Revenue Monthly screen. Kept beside
                                 the imported value so the original stays visible;
                                 re-importing the side drops the row, so the file
                                 always wins over an old edit.
     OverrideAt / OverrideBy   — when, and by whom (several people use the app).

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-08-1131.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'RevenueMonthSnapshot: OverrideProgressStd / OverrideProgressAct / OverrideAt / OverrideBy';
GO
IF COL_LENGTH(N'dbo.RevenueMonthSnapshot', N'OverrideProgressStd') IS NULL
    ALTER TABLE dbo.RevenueMonthSnapshot ADD OverrideProgressStd DECIMAL(9,4) NULL;
GO
IF COL_LENGTH(N'dbo.RevenueMonthSnapshot', N'OverrideProgressAct') IS NULL
    ALTER TABLE dbo.RevenueMonthSnapshot ADD OverrideProgressAct DECIMAL(9,4) NULL;
GO
IF COL_LENGTH(N'dbo.RevenueMonthSnapshot', N'OverrideAt') IS NULL
    ALTER TABLE dbo.RevenueMonthSnapshot ADD OverrideAt DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.RevenueMonthSnapshot', N'OverrideBy') IS NULL
    ALTER TABLE dbo.RevenueMonthSnapshot ADD OverrideBy NVARCHAR(200) NULL;
GO

PRINT 'migrate-2026-09-08-1131: done.';
GO
