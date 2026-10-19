/* ================================================================
   Migration 2026-10-19 14:25 — Position Level master, Resource.PositionLevelCode,
                                Manday Target per Position Level per year

   PositionLevel — the levels within each Position (e.g. SA / SR = Senior SA). Keyed by
   (Position, Code): the same code may exist under several positions.

   Resource.PositionLevelCode — the resource's level. Composite FK (Position, PositionLevelCode)
   so a resource can only take a level of its own position; a NULL code (no level) is never
   checked. A level in use cannot be deleted.

   PositionLevelTarget — manday target per person at a level, per year. Shown against what each
   resource has been allocated on the Billing KPI Manday screen. Goes with its level.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-10-19-1425.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'PositionLevel';
GO
IF OBJECT_ID(N'dbo.PositionLevel', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PositionLevel (
        Position NVARCHAR(20)  NOT NULL,     -- Dev | SA | PM
        Code     NVARCHAR(20)  NOT NULL,     -- e.g. JR, SR, LEAD
        Name     NVARCHAR(100) NOT NULL,     -- e.g. Senior SA
        CONSTRAINT PK_PositionLevel PRIMARY KEY (Position, Code),
        CONSTRAINT CK_PositionLevel_Position CHECK (Position IN (N'Dev', N'SA', N'PM'))
    );
END
GO

PRINT 'Resource.PositionLevelCode';
GO
IF COL_LENGTH(N'dbo.Resource', N'PositionLevelCode') IS NULL
    ALTER TABLE dbo.Resource ADD PositionLevelCode NVARCHAR(20) NULL;
GO
IF OBJECT_ID(N'dbo.FK_Resource_PositionLevel', N'F') IS NULL
    ALTER TABLE dbo.Resource ADD CONSTRAINT FK_Resource_PositionLevel
        FOREIGN KEY (Position, PositionLevelCode) REFERENCES dbo.PositionLevel(Position, Code);
GO

PRINT 'PositionLevelTarget';
GO
IF OBJECT_ID(N'dbo.PositionLevelTarget', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PositionLevelTarget (
        Position     NVARCHAR(20)  NOT NULL,
        LevelCode    NVARCHAR(20)  NOT NULL,
        [Year]       INT           NOT NULL,
        TargetManday DECIMAL(9,3)  NOT NULL,   -- manday target per person at this level
        UpdatedAt    DATETIME2(0)  NOT NULL
            CONSTRAINT DF_PositionLevelTarget_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedBy    NVARCHAR(200) NULL,
        CONSTRAINT PK_PositionLevelTarget PRIMARY KEY (Position, LevelCode, [Year]),
        CONSTRAINT FK_PositionLevelTarget_Level FOREIGN KEY (Position, LevelCode)
            REFERENCES dbo.PositionLevel(Position, Code) ON DELETE CASCADE,
        CONSTRAINT CK_PositionLevelTarget_Target CHECK (TargetManday >= 0)
    );
END
GO

PRINT 'migrate-2026-10-19-1425: done.';
GO
