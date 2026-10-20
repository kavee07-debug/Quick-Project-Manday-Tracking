/* ================================================================
   Migration 2026-10-20 11:46 — MandayEntry.BillingManday

   On a Budget row (Project Detail > Estimate & Actual), the estimate of how many manday that
   person is expected to be billed for on the task — up to 3 decimals. Budget rows only:
   Actual / Adjust rows always keep it NULL (CHECK below; the API clears it when a row's type
   changes away from Budget).

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-10-20-1146.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'MandayEntry.BillingManday';
GO
IF COL_LENGTH(N'dbo.MandayEntry', N'BillingManday') IS NULL
    ALTER TABLE dbo.MandayEntry ADD BillingManday DECIMAL(9,3) NULL;
GO
IF OBJECT_ID(N'dbo.CK_Manday_Billing', N'C') IS NULL
    ALTER TABLE dbo.MandayEntry ADD CONSTRAINT CK_Manday_Billing
        CHECK (BillingManday IS NULL OR (EntryType = N'Budget' AND BillingManday >= 0));
GO

PRINT 'migrate-2026-10-20-1146: done.';
GO
