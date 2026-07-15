/* ================================================================
   Migration 2026-07-13 16:58 — Project.Type add 'Internal'

   Extends the CK_Project_Type check constraint to allow a new project
   type 'Internal' (in addition to Implement/Customize/Training/Other).

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-13-1658.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'Project.Type: rebuild CK_Project_Type to include Internal';
GO
IF OBJECT_ID(N'CK_Project_Type', N'C') IS NOT NULL
    ALTER TABLE dbo.Project DROP CONSTRAINT CK_Project_Type;
GO
ALTER TABLE dbo.Project WITH CHECK ADD CONSTRAINT CK_Project_Type
    CHECK (Type IS NULL OR Type IN (N'Implement', N'Customize', N'Training', N'Internal', N'Other'));
GO

PRINT 'migrate-2026-07-13-1658: done.';
GO
