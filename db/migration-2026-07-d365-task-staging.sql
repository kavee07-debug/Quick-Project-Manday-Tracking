/* ============================================================
   Migration: add D365TaskStaging (job tasks per staged project).
   Idempotent — safe to run on an existing QtmManday DB.
   schema.sql (full rebuild) already includes this table.
   ============================================================ */
USE QtmManday;
GO

IF OBJECT_ID(N'dbo.D365TaskStaging', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.D365TaskStaging (
        TaskStagingId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365TaskStaging PRIMARY KEY,
        StagingId       INT NOT NULL,
        JobNo           NVARCHAR(50)  NOT NULL,
        TaskNo          NVARCHAR(50)  NOT NULL,
        TaskDescription NVARCHAR(300) NULL,
        SortOrder       INT NOT NULL CONSTRAINT DF_D365TaskStg_Sort DEFAULT (0),
        CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365TaskStg_Created DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_D365TaskStaging_Project FOREIGN KEY (StagingId)
            REFERENCES dbo.D365ProjectStaging(StagingId) ON DELETE CASCADE,
        CONSTRAINT UQ_D365TaskStaging_Staging_TaskNo UNIQUE (StagingId, TaskNo)
    );
END
GO
