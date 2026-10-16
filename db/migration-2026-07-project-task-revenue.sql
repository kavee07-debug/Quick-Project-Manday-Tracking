/* ============================================================
   Migration: add Revenue to Task (per-task revenue carried from D365).
   Idempotent — safe to run repeatedly.
   ============================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

IF COL_LENGTH(N'dbo.Task', N'Revenue') IS NULL
    ALTER TABLE dbo.Task ADD Revenue DECIMAL(18,2) NULL;
GO
