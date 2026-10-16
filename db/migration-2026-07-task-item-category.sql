/* ============================================================
   Migration: add ItemCategoryCode to Task + D365TaskStaging.
   Idempotent — safe to run repeatedly.
   ============================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

IF COL_LENGTH(N'dbo.Task', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.Task ADD ItemCategoryCode NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.D365TaskStaging', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD ItemCategoryCode NVARCHAR(50) NULL;
GO
