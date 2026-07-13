/* ================================================================
   Migration 2026-07-13 12:19 — Project.TrainingDate

   Adds a free-text TrainingDate column to Project. When Type = Training
   the UI appends this text to the project name (purple).

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-13-1219.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'Project.TrainingDate';
GO
IF COL_LENGTH(N'dbo.Project', N'TrainingDate') IS NULL
    ALTER TABLE dbo.Project ADD TrainingDate NVARCHAR(200) NULL;
GO

PRINT 'migrate-2026-07-13-1219: done.';
GO
