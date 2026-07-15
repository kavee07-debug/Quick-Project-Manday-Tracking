/* ================================================================
   Migration 2026-07-15 22:54 — MeetingRecord: CertifiedBy + OtherTopics

   Adds to dbo.MeetingRecord:
     CertifiedBy  — ผู้รับรองการประชุม (signature block, pairs with PreparedBy)
     OtherTopics  — "สรุปการประชุมอื่นๆ" (one topic per line)

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-15-2254.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'MeetingRecord: CertifiedBy + OtherTopics';
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'CertifiedBy') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD CertifiedBy NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'OtherTopics') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD OtherTopics NVARCHAR(MAX) NULL;
GO

PRINT 'migrate-2026-07-15-2254: done.';
GO
