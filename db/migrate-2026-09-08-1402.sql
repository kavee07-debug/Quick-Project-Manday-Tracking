/* ================================================================
   Migration 2026-09-08 14:02 — Revenue Monthly: default Target

   Adds dbo.RevenueMonthSetting — a single row (Id = 1) holding the Target
   prefilled into a new period. Each period still keeps its own TargetAmount
   and can be changed afterwards; this only seeds the value at creation.

   Same single-row shape as dbo.MeetingSetting.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-09-08-1402.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'RevenueMonthSetting';
GO
IF OBJECT_ID(N'dbo.RevenueMonthSetting', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RevenueMonthSetting (
        Id                  INT NOT NULL CONSTRAINT PK_RevenueMonthSetting PRIMARY KEY,   -- fixed = 1
        DefaultTargetAmount DECIMAL(18,2) NULL,
        UpdatedAt           DATETIME2(0)  NULL,
        CONSTRAINT CK_RevenueMonthSetting_Id CHECK (Id = 1)
    );
END
GO

PRINT 'migrate-2026-09-08-1402: done.';
GO
