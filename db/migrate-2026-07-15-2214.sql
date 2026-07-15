/* ================================================================
   Migration 2026-07-15 22:14 — MeetingSetting (new-meeting defaults)

   Adds dbo.MeetingSetting: a single-row (Id = 1) table holding the
   default Agenda / Attendees / Prepared by prefilled into a new meeting.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-15-2214.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'MeetingSetting';
GO
IF OBJECT_ID(N'dbo.MeetingSetting', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MeetingSetting (
        Id                INT NOT NULL CONSTRAINT PK_MeetingSetting PRIMARY KEY,
        DefaultAgenda     NVARCHAR(MAX) NULL,
        DefaultAttendees  NVARCHAR(MAX) NULL,
        DefaultPreparedBy NVARCHAR(200) NULL,
        UpdatedAt         DATETIME2(0) NULL
    );
END
GO

PRINT 'migrate-2026-07-15-2214: done.';
GO
