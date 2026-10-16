/* ================================================================
   Migration 2026-08-01 10:21 — D365 Timesheet staging: JobDescription

   Adds to dbo.D365TimesheetStaging:
     JobDescription — BC job name pulled from the timesheet payload,
                      shown in the staging grid even when the Job has
                      no matching local Project master.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-08-01-1021.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'D365TimesheetStaging: JobDescription';
GO
IF COL_LENGTH(N'dbo.D365TimesheetStaging', N'JobDescription') IS NULL
    ALTER TABLE dbo.D365TimesheetStaging ADD JobDescription NVARCHAR(250) NULL;
GO

PRINT 'migrate-2026-08-01-1021: done.';
GO
