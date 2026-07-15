/* ================================================================
   Migration 2026-07-15 21:39 — MeetingRecord: close/lock + report header fields

   Adds to dbo.MeetingRecord:
     Report header : Agenda, Attendees, PreparedBy, NextMeetingDate, NextMeetingPreparedBy
     Close/lock    : IsClosed, ClosedAt, ClosedBy

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-15-2139.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'MeetingRecord: report header + close columns';
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'Agenda') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD Agenda NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'Attendees') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD Attendees NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'PreparedBy') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD PreparedBy NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'NextMeetingDate') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD NextMeetingDate DATE NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'NextMeetingPreparedBy') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD NextMeetingPreparedBy NVARCHAR(200) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'IsClosed') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD IsClosed BIT NOT NULL CONSTRAINT DF_MeetingRecord_IsClosed DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'ClosedAt') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD ClosedAt DATETIME2(0) NULL;
GO
IF COL_LENGTH(N'dbo.MeetingRecord', N'ClosedBy') IS NULL
    ALTER TABLE dbo.MeetingRecord ADD ClosedBy NVARCHAR(200) NULL;
GO

PRINT 'migrate-2026-07-15-2139: done.';
GO
