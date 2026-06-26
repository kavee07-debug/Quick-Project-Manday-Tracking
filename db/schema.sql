/* ============================================================
   Quick Project Manday Tracking — SQL Server schema
   Target: SQL Server 2019+
   Hierarchy: Project -> Task -> Manday (Estimate & Actual)
   Includes: RBAC (Users/Roles), in-app Config, D365BC mock log
   ============================================================ */

IF DB_ID(N'QtmManday') IS NULL
    CREATE DATABASE QtmManday;
GO
USE QtmManday;
GO

/* ---------- Drop in dependency order (for re-runs) ---------- */
IF OBJECT_ID(N'dbo.MandayEntry', N'U')  IS NOT NULL DROP TABLE dbo.MandayEntry;
IF OBJECT_ID(N'dbo.Task', N'U')         IS NOT NULL DROP TABLE dbo.Task;
IF OBJECT_ID(N'dbo.Project', N'U')      IS NOT NULL DROP TABLE dbo.Project;
IF OBJECT_ID(N'dbo.Resource', N'U')     IS NOT NULL DROP TABLE dbo.Resource;
IF OBJECT_ID(N'dbo.UserRole', N'U')     IS NOT NULL DROP TABLE dbo.UserRole;
IF OBJECT_ID(N'dbo.[Role]', N'U')       IS NOT NULL DROP TABLE dbo.[Role];
IF OBJECT_ID(N'dbo.[User]', N'U')       IS NOT NULL DROP TABLE dbo.[User];
IF OBJECT_ID(N'dbo.AppConfig', N'U')    IS NOT NULL DROP TABLE dbo.AppConfig;
IF OBJECT_ID(N'dbo.D365SyncLog', N'U')  IS NOT NULL DROP TABLE dbo.D365SyncLog;
GO

/* ============================================================
   RBAC: Users / Roles
   ============================================================ */
CREATE TABLE dbo.[User] (
    UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_User PRIMARY KEY,
    Email         NVARCHAR(256) NOT NULL,
    DisplayName   NVARCHAR(200) NOT NULL,
    PasswordHash  NVARCHAR(512) NULL,         -- null when auth is external/SSO
    IsActive      BIT NOT NULL CONSTRAINT DF_User_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_User_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT UQ_User_Email UNIQUE (Email)
);
GO

CREATE TABLE dbo.[Role] (
    RoleId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Role PRIMARY KEY,
    Name          NVARCHAR(100) NOT NULL,     -- e.g. Admin, ProjectManager, Member, Viewer
    Description   NVARCHAR(400) NULL,
    CONSTRAINT UQ_Role_Name UNIQUE (Name)
);
GO

CREATE TABLE dbo.UserRole (
    UserId        INT NOT NULL,
    RoleId        INT NOT NULL,
    CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleId),
    CONSTRAINT FK_UserRole_User FOREIGN KEY (UserId) REFERENCES dbo.[User](UserId) ON DELETE CASCADE,
    CONSTRAINT FK_UserRole_Role FOREIGN KEY (RoleId) REFERENCES dbo.[Role](RoleId) ON DELETE CASCADE
);
GO

/* ============================================================
   Resource master (people who consume mandays)
   ============================================================ */
CREATE TABLE dbo.Resource (
    ResourceId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Resource PRIMARY KEY,
    Code          NVARCHAR(50) NOT NULL,      -- short code, e.g. KAVEE
    Name          NVARCHAR(200) NOT NULL,     -- display name, e.g. Kavee
    Position      NVARCHAR(20) NULL,          -- Dev | SA | PM
    IsActive      BIT NOT NULL CONSTRAINT DF_Resource_IsActive DEFAULT (1),
    CONSTRAINT UQ_Resource_Code UNIQUE (Code),
    CONSTRAINT CK_Resource_Position CHECK (Position IS NULL OR Position IN (N'Dev', N'SA', N'PM'))
);
GO

/* ============================================================
   Project -> Task -> MandayEntry
   ============================================================ */
CREATE TABLE dbo.Project (
    ProjectId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Project PRIMARY KEY,
    Code          NVARCHAR(50) NOT NULL,      -- business key, e.g. SOJ0001
    Name          NVARCHAR(300) NOT NULL,
    Description   NVARCHAR(MAX) NULL,
    Type          NVARCHAR(20) NULL,          -- Implement | Customize | Training | Other
    Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_Project_Status DEFAULT (N'Open'),
    Revenue       DECIMAL(18,2) NULL,         -- project value / revenue
    StartDate     DATE NULL,
    EndDate       DATE NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Project_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT UQ_Project_Code   UNIQUE (Code),
    CONSTRAINT CK_Project_Type   CHECK (Type IS NULL OR Type IN (N'Implement', N'Customize', N'Training', N'Other')),
    CONSTRAINT CK_Project_Status CHECK (Status IN (N'Open', N'Hold', N'Completed', N'Cancel'))
);
GO

CREATE TABLE dbo.Task (
    TaskId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Task PRIMARY KEY,
    ProjectId     INT NOT NULL,
    Name          NVARCHAR(300) NOT NULL,     -- e.g. Planning
    Description   NVARCHAR(MAX) NULL,
    Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_Task_Status DEFAULT (N'Open'),
    SortOrder     INT NOT NULL CONSTRAINT DF_Task_SortOrder DEFAULT (0),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Task_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT FK_Task_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Project(ProjectId) ON DELETE CASCADE,
    CONSTRAINT UQ_Task_Project_Name UNIQUE (ProjectId, Name)
);
GO

/* Manday rows. EntryType: Budget | Actual | Adjust */
CREATE TABLE dbo.MandayEntry (
    MandayEntryId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MandayEntry PRIMARY KEY,
    TaskId        INT NOT NULL,
    EntryType     NVARCHAR(10) NOT NULL,
    ResourceId    INT NULL,                   -- nullable: Adjust rows may not map to a person
    Manday        DECIMAL(9,2) NOT NULL,      -- supports half-days e.g. 1.5
    EntryDate     DATE NULL,
    Note          NVARCHAR(500) NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Manday_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT FK_Manday_Task     FOREIGN KEY (TaskId)     REFERENCES dbo.Task(TaskId) ON DELETE CASCADE,
    CONSTRAINT FK_Manday_Resource FOREIGN KEY (ResourceId) REFERENCES dbo.Resource(ResourceId),
    CONSTRAINT CK_Manday_Type     CHECK (EntryType IN (N'Budget', N'Actual', N'Adjust')),
    CONSTRAINT CK_Manday_Value    CHECK (Manday >= 0)
);
GO

CREATE INDEX IX_Task_ProjectId        ON dbo.Task(ProjectId);
CREATE INDEX IX_Manday_TaskId         ON dbo.MandayEntry(TaskId);
CREATE INDEX IX_Manday_Task_Type      ON dbo.MandayEntry(TaskId, EntryType);
GO

/* ============================================================
   In-app Config (DB connection / app settings, key-value)
   ============================================================ */
CREATE TABLE dbo.AppConfig (
    ConfigKey     NVARCHAR(100) NOT NULL CONSTRAINT PK_AppConfig PRIMARY KEY,
    ConfigValue   NVARCHAR(MAX) NULL,
    IsSecret      BIT NOT NULL CONSTRAINT DF_AppConfig_IsSecret DEFAULT (0),
    UpdatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_AppConfig_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ============================================================
   D365BC integration — mock sync log (real integration later)
   ============================================================ */
CREATE TABLE dbo.D365SyncLog (
    SyncId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365SyncLog PRIMARY KEY,
    EntityName    NVARCHAR(100) NOT NULL,     -- e.g. Project, Resource
    Direction     NVARCHAR(10) NOT NULL CONSTRAINT DF_D365_Direction DEFAULT (N'IN'),
    Status        NVARCHAR(20) NOT NULL,      -- Success | Failed | Mock
    Message       NVARCHAR(MAX) NULL,
    PayloadJson   NVARCHAR(MAX) NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_D365_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

/* ============================================================
   View: per-task manday rollup.
   Adjust adds to the quota → Remaining = (Budget + Adjust) - Actual
   ============================================================ */
IF OBJECT_ID(N'dbo.vTaskMandaySummary', N'V') IS NOT NULL DROP VIEW dbo.vTaskMandaySummary;
GO
CREATE VIEW dbo.vTaskMandaySummary AS
SELECT
    t.TaskId,
    t.ProjectId,
    t.Name AS TaskName,
    SUM(CASE WHEN m.EntryType = N'Budget' THEN m.Manday ELSE 0 END)               AS TotalBudget,
    SUM(CASE WHEN m.EntryType = N'Actual' THEN m.Manday ELSE 0 END)               AS TotalActual,
    SUM(CASE WHEN m.EntryType = N'Adjust' THEN m.Manday ELSE 0 END)               AS TotalAdjust,
    SUM(CASE WHEN m.EntryType IN (N'Budget', N'Adjust') THEN m.Manday ELSE 0 END)
        - SUM(CASE WHEN m.EntryType = N'Actual' THEN m.Manday ELSE 0 END)         AS Remaining
FROM dbo.Task t
LEFT JOIN dbo.MandayEntry m ON m.TaskId = t.TaskId
GROUP BY t.TaskId, t.ProjectId, t.Name;
GO

/* ============================================================
   Seed data (matches SOW example: SOJ0001 / Planning)
   ============================================================ */
INSERT INTO dbo.[Role] (Name, Description) VALUES
    (N'Admin', N'Full access'),
    (N'ProjectManager', N'Manage projects, tasks, mandays'),
    (N'Member', N'Record actual mandays'),
    (N'Viewer', N'Read-only');

INSERT INTO dbo.Resource (Code, Name) VALUES
    (N'KAVEE', N'Kavee'),
    (N'BHAVIT', N'Bhavit');

INSERT INTO dbo.Project (Code, Name, Type, Status) VALUES
    (N'SOJ0001', N'Sample Project SOJ0001', N'Implement', N'Open');

DECLARE @ProjectId INT = (SELECT ProjectId FROM dbo.Project WHERE Code = N'SOJ0001');

INSERT INTO dbo.Task (ProjectId, Name) VALUES (@ProjectId, N'Planning');

DECLARE @TaskId   INT = (SELECT TaskId FROM dbo.Task WHERE ProjectId = @ProjectId AND Name = N'Planning');
DECLARE @Kavee    INT = (SELECT ResourceId FROM dbo.Resource WHERE Code = N'KAVEE');
DECLARE @Bhavit   INT = (SELECT ResourceId FROM dbo.Resource WHERE Code = N'BHAVIT');

INSERT INTO dbo.MandayEntry (TaskId, EntryType, ResourceId, Manday, Note) VALUES
    (@TaskId, N'Budget', @Kavee,  1.0, NULL),
    (@TaskId, N'Budget', @Bhavit, 1.5, NULL),
    (@TaskId, N'Actual', @Kavee,  2.0, NULL),
    (@TaskId, N'Adjust', NULL,     1.0, N'Manual adjustment');
GO

/* Quick check */
SELECT * FROM dbo.vTaskMandaySummary;
GO
