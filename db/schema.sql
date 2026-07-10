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
IF OBJECT_ID(N'dbo.Project', N'U')      IS NOT NULL DROP TABLE dbo.Project;   -- FK -> Customer, drop before Customer
IF OBJECT_ID(N'dbo.Customer', N'U')     IS NOT NULL DROP TABLE dbo.Customer;
IF OBJECT_ID(N'dbo.Resource', N'U')     IS NOT NULL DROP TABLE dbo.Resource;
IF OBJECT_ID(N'dbo.MasterItem', N'U')   IS NOT NULL DROP TABLE dbo.MasterItem;
IF OBJECT_ID(N'dbo.UserRole', N'U')     IS NOT NULL DROP TABLE dbo.UserRole;
IF OBJECT_ID(N'dbo.[Role]', N'U')       IS NOT NULL DROP TABLE dbo.[Role];
IF OBJECT_ID(N'dbo.[User]', N'U')       IS NOT NULL DROP TABLE dbo.[User];
IF OBJECT_ID(N'dbo.AppConfig', N'U')        IS NOT NULL DROP TABLE dbo.AppConfig;
IF OBJECT_ID(N'dbo.D365SyncLog', N'U')       IS NOT NULL DROP TABLE dbo.D365SyncLog;
IF OBJECT_ID(N'dbo.D365TimesheetStaging', N'U') IS NOT NULL DROP TABLE dbo.D365TimesheetStaging;
IF OBJECT_ID(N'dbo.D365TaskStaging', N'U')    IS NOT NULL DROP TABLE dbo.D365TaskStaging;   -- FK -> D365ProjectStaging
IF OBJECT_ID(N'dbo.D365ProjectStaging', N'U') IS NOT NULL DROP TABLE dbo.D365ProjectStaging;
IF OBJECT_ID(N'dbo.D365BcSetting', N'U')      IS NOT NULL DROP TABLE dbo.D365BcSetting;
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
   Customer master (owns projects)
   ============================================================ */
CREATE TABLE dbo.Customer (
    CustomerId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customer PRIMARY KEY,
    Code          NVARCHAR(50) NOT NULL,      -- business key, e.g. CUST001
    Name          NVARCHAR(300) NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_Customer_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Customer_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT UQ_Customer_Code UNIQUE (Code)
);
GO

/* ============================================================
   Master Item (synced from D365BC — number/displayName/itemCategoryCode).
   Used to map jobPlanningLines.number -> itemCategoryCode when computing revenue.
   ============================================================ */
CREATE TABLE dbo.MasterItem (
    ItemId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MasterItem PRIMARY KEY,
    Number           NVARCHAR(50)  NOT NULL,      -- BC item "number", business key
    DisplayName      NVARCHAR(300) NOT NULL CONSTRAINT DF_MasterItem_Name DEFAULT (N''),
    ItemCategoryCode NVARCHAR(50)  NULL,          -- e.g. IMPLEMENT / CUSTOMIZE
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_MasterItem_Created DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(0)  NULL,
    CONSTRAINT UQ_MasterItem_Number UNIQUE (Number)
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
    CustomerId    INT NULL,                   -- owning customer (nullable)
    Type          NVARCHAR(20) NULL,          -- Implement | Customize | Training | Other
    Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_Project_Status DEFAULT (N'Open'),
    Progress      DECIMAL(5,2) NULL,          -- completion %, e.g. 70.01 (0..100)
    Revenue       DECIMAL(18,2) NULL,         -- project value / revenue
    StartDate     DATE NULL,
    EndDate       DATE NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Project_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT UQ_Project_Code     UNIQUE (Code),
    CONSTRAINT FK_Project_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customer(CustomerId),
    CONSTRAINT CK_Project_Type     CHECK (Type IS NULL OR Type IN (N'Implement', N'Customize', N'Training', N'Other')),
    CONSTRAINT CK_Project_Status   CHECK (Status IN (N'Open', N'Hold', N'Completed', N'Cancel')),
    CONSTRAINT CK_Project_Progress CHECK (Progress IS NULL OR (Progress >= 0 AND Progress <= 100))
);
GO
CREATE INDEX IX_Project_CustomerId ON dbo.Project(CustomerId);
GO

CREATE TABLE dbo.Task (
    TaskId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Task PRIMARY KEY,
    ProjectId     INT NOT NULL,
    Name          NVARCHAR(300) NOT NULL,     -- e.g. Planning
    Description   NVARCHAR(MAX) NULL,
    ItemCategoryCode NVARCHAR(50) NULL,        -- from D365 job task's planning-line item (IMPLEMENT/CUSTOMIZE/…)
    Revenue       DECIMAL(18,2) NULL,          -- from D365 (Σ Billable revenue-category lineAmountLCY for this task)
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
    Manday        DECIMAL(11,4) NOT NULL,     -- supports half-days e.g. 1.5, and finer MD from timesheets (0.375)
    EntryDate     DATE NULL,
    StartDate     DATE NULL,                  -- planned/actual start
    EndDate       DATE NULL,                  -- defaults to StartDate, editable
    Note          NVARCHAR(500) NULL,
    SourceSystemId NVARCHAR(100) NULL,        -- D365 timesheet systemId when applied from the Timesheet screen
    AppliedAt     DATETIME2(0) NULL,          -- when this Actual was applied from a timesheet
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
CREATE INDEX IX_Manday_SourceSystemId ON dbo.MandayEntry(SourceSystemId);
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
   D365BC integration — sync log (fetch attempts)
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

/* ------------------------------------------------------------
   D365BC connection settings — single row (Id = 1).
   ClientSecret stored plaintext (dev-acceptable; encrypt at rest for prod).
   Base URL / token scope / job entity-set / projects path are constants in code.
   ------------------------------------------------------------ */
CREATE TABLE dbo.D365BcSetting (
    Id                  INT NOT NULL CONSTRAINT PK_D365BcSetting PRIMARY KEY,   -- always 1
    TenantId            NVARCHAR(100)  NOT NULL CONSTRAINT DF_D365Set_Tenant   DEFAULT (N''),
    EnvironmentId       NVARCHAR(100)  NOT NULL CONSTRAINT DF_D365Set_Env      DEFAULT (N''),
    CompanyId           NVARCHAR(100)  NOT NULL CONSTRAINT DF_D365Set_Company  DEFAULT (N''),
    ClientId            NVARCHAR(200)  NOT NULL CONSTRAINT DF_D365Set_ClientId DEFAULT (N''),
    ClientSecret        NVARCHAR(400)  NOT NULL CONSTRAINT DF_D365Set_Secret   DEFAULT (N''),
    ApiPublisher        NVARCHAR(100)  NOT NULL CONSTRAINT DF_D365Set_Pub      DEFAULT (N''),
    ApiGroup            NVARCHAR(100)  NOT NULL CONSTRAINT DF_D365Set_Group    DEFAULT (N''),
    ApiVersion          NVARCHAR(20)   NOT NULL CONSTRAINT DF_D365Set_Ver      DEFAULT (N''),
    ProjectManagerCodes NVARCHAR(200)  NOT NULL CONSTRAINT DF_D365Set_PmCodes  DEFAULT (N'Q63-036,Q63-041'),
    UpdatedAt           DATETIME2(0)   NOT NULL CONSTRAINT DF_D365Set_Updated  DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_D365BcSetting_SingleRow CHECK (Id = 1)
);
GO
-- Seed the single settings row (empty — configure via the API Setup screen).
INSERT INTO dbo.D365BcSetting (Id, ApiVersion) VALUES (1, N'v1.0');
GO

/* ------------------------------------------------------------
   D365BC project staging — rows pulled from BC, editable before
   being promoted to dbo.Project. JobNo becomes Project.Code.
   ------------------------------------------------------------ */
CREATE TABLE dbo.D365ProjectStaging (
    StagingId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365ProjectStaging PRIMARY KEY,
    JobNo               NVARCHAR(50)  NOT NULL,      -- BC "no", becomes Project.Code
    ProjectName         NVARCHAR(300) NULL,
    BcJobId             NVARCHAR(100) NULL,          -- BC job id (GUID) used to fetch the name
    ProjectManagerCode  NVARCHAR(50)  NULL,
    CustomerNo          NVARCHAR(50)  NULL,          -- becomes Customer.Code (auto-created on promote)
    CustomerName        NVARCHAR(300) NULL,
    Type                NVARCHAR(20)  NULL,          -- Project.Type (auto-suggested from name)
    Revenue             DECIMAL(18,2) NULL,          -- Project.Revenue
    RawJson             NVARCHAR(MAX) NULL,
    FetchedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Stg_Fetched DEFAULT (SYSUTCDATETIME()),
    CreatedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Stg_Created DEFAULT (SYSUTCDATETIME()),
    UpdatedAt           DATETIME2(0)  NULL,
    CONSTRAINT UQ_D365ProjectStaging_JobNo UNIQUE (JobNo)
);
GO

/* ------------------------------------------------------------
   D365BC task staging — job tasks (Task No + Description) pulled per
   staged project. Removed with the parent (promoted or deleted).
   ------------------------------------------------------------ */
CREATE TABLE dbo.D365TaskStaging (
    TaskStagingId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365TaskStaging PRIMARY KEY,
    StagingId       INT NOT NULL,                -- parent D365ProjectStaging
    JobNo           NVARCHAR(50)  NOT NULL,      -- denormalised BC job "no"
    TaskNo          NVARCHAR(50)  NOT NULL,      -- BC jobTaskNo -> Task.Name
    TaskDescription NVARCHAR(300) NULL,          -- BC description -> Task.Description
    ItemCategoryCode NVARCHAR(50) NULL,          -- derived from the task's planning-line item category
    Revenue         DECIMAL(18,2) NULL,          -- Σ Billable lineAmountLCY (IMPLEMENT/CUSTOMIZE/MA) for this task
    SortOrder       INT NOT NULL CONSTRAINT DF_D365TaskStg_Sort DEFAULT (0),
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365TaskStg_Created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_D365TaskStaging_Project FOREIGN KEY (StagingId)
        REFERENCES dbo.D365ProjectStaging(StagingId) ON DELETE CASCADE,
    CONSTRAINT UQ_D365TaskStaging_Staging_TaskNo UNIQUE (StagingId, TaskNo)
);
GO

/* ------------------------------------------------------------
   D365BC timesheet staging — timesheet lines pulled for a date range,
   reviewed/remapped (New Job/Task) then applied as Actual mandays.
   SystemId (BC systemId) is the upsert/dedup key.
   ------------------------------------------------------------ */
CREATE TABLE dbo.D365TimesheetStaging (
    TimesheetStagingId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365TimesheetStaging PRIMARY KEY,
    SystemId        NVARCHAR(100) NOT NULL,      -- BC systemId (upsert key)
    JobNo           NVARCHAR(50)  NULL,
    JobTaskNo       NVARCHAR(50)  NULL,
    TimesheetDate   DATE          NULL,          -- API startDate
    ResourceNo      NVARCHAR(50)  NULL,          -- API "no" (resource code), shown as "No."
    QuantityHour    DECIMAL(18,2) NULL,          -- API quantity
    QuantityMD      DECIMAL(18,4) NULL,          -- API quantityMD
    Comment         NVARCHAR(500) NULL,
    ProjectManager  NVARCHAR(50)  NULL,
    TimesheetStatus NVARCHAR(30)  NULL,
    NewJobNo        NVARCHAR(50)  NULL,          -- default = JobNo, user-editable (map to Project)
    NewTaskNo       NVARCHAR(50)  NULL,          -- default = JobTaskNo, user-editable (map to Task)
    RawJson         NVARCHAR(MAX) NULL,
    FetchedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Ts_Fetched DEFAULT (SYSUTCDATETIME()),
    CreatedAt       DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Ts_Created DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2(0)  NULL,
    CONSTRAINT UQ_D365TimesheetStaging_SystemId UNIQUE (SystemId)
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
    (N'Admin', N'Full access + manage users'),
    (N'ProjectManager', N'Manage projects, tasks, mandays'),
    (N'User', N'Read-only');

INSERT INTO dbo.Resource (Code, Name) VALUES
    (N'KAVEE', N'Kavee'),
    (N'BHAVIT', N'Bhavit');

INSERT INTO dbo.Customer (Code, Name) VALUES
    (N'CUST001', N'Sample Customer Co., Ltd.');

DECLARE @CustomerId INT = (SELECT CustomerId FROM dbo.Customer WHERE Code = N'CUST001');

INSERT INTO dbo.Project (Code, Name, CustomerId, Type, Status, Progress) VALUES
    (N'SOJ0001', N'Sample Project SOJ0001', @CustomerId, N'Implement', N'Open', 70.01);

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
