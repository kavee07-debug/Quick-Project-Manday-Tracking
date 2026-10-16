/* ================================================================
   Migration 2026-09-08 11:53 — Revenue Monthly: Confirm Revenue

   Adds to dbo.RevenueMonth:
     IsConfirmed  — the month is closed: its figures are final and the period
                    is read-only (no import, no manual %, no delete) until it
                    is reopened. Until then the screen labels the revenue
                    "Est Revenue".
     ConfirmedAt / ConfirmedBy — when, and by whom.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-08-1153.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'RevenueMonth: IsConfirmed / ConfirmedAt / ConfirmedBy';
GO
IF COL_LENGTH(N'dbo.RevenueMonth', N'IsConfirmed') IS NULL
    ALTER TABLE dbo.RevenueMonth ADD IsConfirmed BIT NOT NULL
        CONSTRAINT DF_RevenueMonth_IsConfirmed DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.RevenueMonth', N'ConfirmedAt') IS NULL
    ALTER TABLE dbo.RevenueMonth ADD ConfirmedAt DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.RevenueMonth', N'ConfirmedBy') IS NULL
    ALTER TABLE dbo.RevenueMonth ADD ConfirmedBy NVARCHAR(200) NULL;
GO

PRINT 'migrate-2026-09-08-1153: done.';
GO
