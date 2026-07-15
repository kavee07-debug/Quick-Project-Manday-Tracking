/* ================================================================
   Migration 2026-07-14 09:58 — Meeting Record (header + lines)

   Adds the Meeting Record feature tables:
     dbo.MeetingRecord — weekly meeting header (date + topic + notes)
     dbo.MeetingLine   — one project line per meeting (status snapshot,
                         Update Detail, Next Action)

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-07-14-0958.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
USE QtmManday;
GO

PRINT 'MeetingRecord';
GO
IF OBJECT_ID(N'dbo.MeetingRecord', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MeetingRecord (
        MeetingId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MeetingRecord PRIMARY KEY,
        MeetingDate   DATE NOT NULL,
        Topic         NVARCHAR(300) NOT NULL,
        Notes         NVARCHAR(MAX) NULL,
        CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_MeetingRecord_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt     DATETIME2(0) NULL
    );
END
GO

PRINT 'MeetingLine';
GO
IF OBJECT_ID(N'dbo.MeetingLine', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MeetingLine (
        MeetingLineId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MeetingLine PRIMARY KEY,
        MeetingId        INT NOT NULL,
        ProjectId        INT NOT NULL,
        StatusSnapshot   NVARCHAR(30) NULL,
        ProgressSnapshot DECIMAL(5,2) NULL,
        UpdateDetail     NVARCHAR(MAX) NULL,
        NextAction       NVARCHAR(MAX) NULL,
        SortOrder        INT NOT NULL CONSTRAINT DF_MeetingLine_SortOrder DEFAULT (0),
        CreatedAt        DATETIME2(0) NOT NULL CONSTRAINT DF_MeetingLine_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt        DATETIME2(0) NULL,
        CONSTRAINT FK_MeetingLine_Meeting FOREIGN KEY (MeetingId) REFERENCES dbo.MeetingRecord(MeetingId) ON DELETE CASCADE,
        CONSTRAINT FK_MeetingLine_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Project(ProjectId),
        CONSTRAINT UQ_MeetingLine_Meeting_Project UNIQUE (MeetingId, ProjectId)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MeetingLine_MeetingId' AND object_id = OBJECT_ID(N'dbo.MeetingLine'))
    CREATE INDEX IX_MeetingLine_MeetingId ON dbo.MeetingLine(MeetingId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MeetingLine_ProjectId' AND object_id = OBJECT_ID(N'dbo.MeetingLine'))
    CREATE INDEX IX_MeetingLine_ProjectId ON dbo.MeetingLine(ProjectId);
GO

PRINT 'migrate-2026-07-14-0958: done.';
GO
