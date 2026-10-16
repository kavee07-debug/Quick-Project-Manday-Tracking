/* ============================================================
   Migration: add Revenue to D365TaskStaging (per-task revenue).
   Idempotent — safe to run repeatedly.
   ============================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

IF COL_LENGTH(N'dbo.D365TaskStaging', N'Revenue') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD Revenue DECIMAL(18,2) NULL;
GO
