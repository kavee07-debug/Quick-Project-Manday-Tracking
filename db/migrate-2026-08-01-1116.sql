/* ================================================================
   Migration 2026-08-01 11:16 — Project.Type add 'MA'

   Extends the CK_Project_Type check constraint to allow a new project
   type 'MA' (in addition to Implement/Customize/Training/Internal/Other).

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-08-01-1116.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'Project.Type: rebuild CK_Project_Type to include MA';
GO
IF OBJECT_ID(N'CK_Project_Type', N'C') IS NOT NULL
    ALTER TABLE dbo.Project DROP CONSTRAINT CK_Project_Type;
GO
ALTER TABLE dbo.Project WITH CHECK ADD CONSTRAINT CK_Project_Type
    CHECK (Type IS NULL OR Type IN (N'Implement', N'Customize', N'Training', N'Internal', N'MA', N'Other'));
GO

PRINT 'migrate-2026-08-01-1116: done.';
GO
