/* ============================================================
   Quick Project Manday Tracking — SQL Server schema
   Target: SQL Server 2019+ and Azure SQL Database
   Hierarchy: Project -> Task -> Manday (Estimate & Actual)
   Includes: RBAC (Users/Roles), in-app Config, D365BC mock log

   ⚠️ DESTRUCTIVE — drops every table and re-seeds sample rows. Fresh installs only;
      never run it against a database that already holds real data.

   The database must already exist (Azure SQL has no usable CREATE DATABASE from a user
   database, and no USE), so name it on the command line:
     on-prem : sqlcmd -S <DBSERVER> -d QtmManday -C -E -i db\schema.sql
               (create it once first: CREATE DATABASE QtmManday;)
     Azure   : create the database in the portal, then
               sqlcmd -S <server>.database.windows.net -d QtmManday -U <user> -P <pwd> -C -i db\schema.sql
   ============================================================ */

:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

/* ---------- Drop in dependency order (for re-runs) ---------- */
IF OBJECT_ID(N'dbo.BillingAllocation', N'U')  IS NOT NULL DROP TABLE dbo.BillingAllocation;   -- FK -> BillingInvoiceLine, Resource
IF OBJECT_ID(N'dbo.BillingMandayRate', N'U')  IS NOT NULL DROP TABLE dbo.BillingMandayRate;
IF OBJECT_ID(N'dbo.BillingInvoiceLine', N'U') IS NOT NULL DROP TABLE dbo.BillingInvoiceLine;
IF OBJECT_ID(N'dbo.BcJobInfo', N'U')          IS NOT NULL DROP TABLE dbo.BcJobInfo;
IF OBJECT_ID(N'dbo.RevenueMonthArchive', N'U') IS NOT NULL DROP TABLE dbo.RevenueMonthArchive;  -- FK -> RevenueMonth
IF OBJECT_ID(N'dbo.RevenueMonthSetting', N'U') IS NOT NULL DROP TABLE dbo.RevenueMonthSetting;
IF OBJECT_ID(N'dbo.RevenueMonthManualLine', N'U') IS NOT NULL DROP TABLE dbo.RevenueMonthManualLine;  -- FK -> RevenueMonth
IF OBJECT_ID(N'dbo.RevenueMonthSnapshot', N'U') IS NOT NULL DROP TABLE dbo.RevenueMonthSnapshot;  -- FK -> RevenueMonth
IF OBJECT_ID(N'dbo.RevenueMonth', N'U')  IS NOT NULL DROP TABLE dbo.RevenueMonth;
IF OBJECT_ID(N'dbo.MeetingLine', N'U')  IS NOT NULL DROP TABLE dbo.MeetingLine;   -- FK -> MeetingRecord, Project
IF OBJECT_ID(N'dbo.MeetingRecord', N'U') IS NOT NULL DROP TABLE dbo.MeetingRecord;
IF OBJECT_ID(N'dbo.MeetingSetting', N'U') IS NOT NULL DROP TABLE dbo.MeetingSetting;
IF OBJECT_ID(N'dbo.MandayEntry', N'U')  IS NOT NULL DROP TABLE dbo.MandayEntry;
IF OBJECT_ID(N'dbo.Task', N'U')         IS NOT NULL DROP TABLE dbo.Task;
IF OBJECT_ID(N'dbo.Project', N'U')      IS NOT NULL DROP TABLE dbo.Project;   -- FK -> Customer, drop before Customer
IF OBJECT_ID(N'dbo.Customer', N'U')     IS NOT NULL DROP TABLE dbo.Customer;
IF OBJECT_ID(N'dbo.PositionLevelTarget', N'U') IS NOT NULL DROP TABLE dbo.PositionLevelTarget;  -- FK -> PositionLevel
IF OBJECT_ID(N'dbo.Resource', N'U')     IS NOT NULL DROP TABLE dbo.Resource;   -- FK -> PositionLevel
IF OBJECT_ID(N'dbo.PositionLevel', N'U') IS NOT NULL DROP TABLE dbo.PositionLevel;
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
   Position Level master (levels within each Position) + manday target per level per year
   ============================================================ */
CREATE TABLE dbo.PositionLevel (
    Position NVARCHAR(20)  NOT NULL,     -- Dev | SA | PM
    Code     NVARCHAR(20)  NOT NULL,     -- e.g. JR, SR, LEAD
    Name     NVARCHAR(100) NOT NULL,     -- e.g. Senior SA
    CONSTRAINT PK_PositionLevel PRIMARY KEY (Position, Code),
    CONSTRAINT CK_PositionLevel_Position CHECK (Position IN (N'Dev', N'SA', N'PM'))
);
GO

CREATE TABLE dbo.PositionLevelTarget (
    Position     NVARCHAR(20)  NOT NULL,
    LevelCode    NVARCHAR(20)  NOT NULL,
    [Year]       INT           NOT NULL,
    TargetManday DECIMAL(9,3)  NOT NULL,   -- manday target per person at this level (Billing KPI)
    UpdatedAt    DATETIME2(0)  NOT NULL
        CONSTRAINT DF_PositionLevelTarget_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedBy    NVARCHAR(200) NULL,
    CONSTRAINT PK_PositionLevelTarget PRIMARY KEY (Position, LevelCode, [Year]),
    CONSTRAINT FK_PositionLevelTarget_Level FOREIGN KEY (Position, LevelCode)
        REFERENCES dbo.PositionLevel(Position, Code) ON DELETE CASCADE,
    CONSTRAINT CK_PositionLevelTarget_Target CHECK (TargetManday >= 0)
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
    PositionLevelCode NVARCHAR(20) NULL,      -- level within Position (dbo.PositionLevel)
    IsActive      BIT NOT NULL CONSTRAINT DF_Resource_IsActive DEFAULT (1),
    IsBillingKpi  BIT NOT NULL CONSTRAINT DF_Resource_IsBillingKpi DEFAULT (0),  -- counts toward Billing KPI
    CONSTRAINT UQ_Resource_Code UNIQUE (Code),
    CONSTRAINT CK_Resource_Position CHECK (Position IS NULL OR Position IN (N'Dev', N'SA', N'PM')),
    CONSTRAINT FK_Resource_PositionLevel FOREIGN KEY (Position, PositionLevelCode)
        REFERENCES dbo.PositionLevel(Position, Code)
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
    Type          NVARCHAR(20) NULL,          -- Implement | Customize | Training | Internal | MA | Other
    Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_Project_Status DEFAULT (N'Open'),
    Progress      DECIMAL(5,2) NULL,          -- completion %, e.g. 70.01 (0..100)
    Revenue       DECIMAL(18,2) NULL,         -- project value / revenue
    TimesheetMapping NVARCHAR(200) NULL,      -- D365 timesheet map key(s) "JobNo,TaskNo" (default = Code)
    TrainingDate  NVARCHAR(200) NULL,         -- free text; appended to name in UI when Type = Training
    StartDate     DATE NULL,
    EndDate       DATE NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Project_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL,
    CONSTRAINT UQ_Project_Code     UNIQUE (Code),
    CONSTRAINT FK_Project_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customer(CustomerId),
    CONSTRAINT CK_Project_Type     CHECK (Type IS NULL OR Type IN (N'Implement', N'Customize', N'Training', N'Internal', N'MA', N'Other')),
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
    BillingManday DECIMAL(9,3) NULL,          -- Budget rows only: estimated manday to be billed for this person/task
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
    CONSTRAINT CK_Manday_Value    CHECK (Manday >= 0),
    CONSTRAINT CK_Manday_Billing  CHECK (BillingManday IS NULL OR (EntryType = N'Budget' AND BillingManday >= 0))
);
GO

CREATE INDEX IX_Task_ProjectId        ON dbo.Task(ProjectId);
CREATE INDEX IX_Manday_TaskId         ON dbo.MandayEntry(TaskId);
CREATE INDEX IX_Manday_Task_Type      ON dbo.MandayEntry(TaskId, EntryType);
CREATE INDEX IX_Manday_SourceSystemId ON dbo.MandayEntry(SourceSystemId);
GO

/* ============================================================
   Meeting Record: weekly project-status meeting (header -> lines)
   ============================================================ */
CREATE TABLE dbo.MeetingRecord (
    MeetingId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MeetingRecord PRIMARY KEY,
    MeetingDate   DATE NOT NULL,
    Topic         NVARCHAR(300) NOT NULL,
    Notes         NVARCHAR(MAX) NULL,
    Agenda        NVARCHAR(MAX) NULL,             -- one agenda item per line
    Attendees     NVARCHAR(MAX) NULL,             -- one attendee per line, e.g. "ชื่อ (PM)"
    PreparedBy    NVARCHAR(200) NULL,             -- ผู้บันทึกการประชุม
    CertifiedBy   NVARCHAR(200) NULL,             -- ผู้รับรองการประชุม
    NextMeetingDate DATE NULL,
    NextMeetingPreparedBy NVARCHAR(200) NULL,
    OtherTopics   NVARCHAR(MAX) NULL,             -- "สรุปการประชุมอื่นๆ" — one topic per line
    IsClosed      BIT NOT NULL CONSTRAINT DF_MeetingRecord_IsClosed DEFAULT (0),
    ClosedAt      DATETIME2(0) NULL,
    ClosedBy      NVARCHAR(200) NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_MeetingRecord_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt     DATETIME2(0) NULL
);
GO

CREATE TABLE dbo.MeetingLine (
    MeetingLineId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MeetingLine PRIMARY KEY,
    MeetingId        INT NOT NULL,
    ProjectId        INT NOT NULL,
    StatusSnapshot   NVARCHAR(30) NULL,          -- project Status frozen at load time
    ProgressSnapshot DECIMAL(5,2) NULL,          -- project Progress frozen at load time
    UpdateDetail     NVARCHAR(MAX) NULL,
    NextAction       NVARCHAR(MAX) NULL,
    SortOrder        INT NOT NULL CONSTRAINT DF_MeetingLine_SortOrder DEFAULT (0),
    CreatedAt        DATETIME2(0) NOT NULL CONSTRAINT DF_MeetingLine_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt        DATETIME2(0) NULL,
    CONSTRAINT FK_MeetingLine_Meeting FOREIGN KEY (MeetingId) REFERENCES dbo.MeetingRecord(MeetingId) ON DELETE CASCADE,
    CONSTRAINT FK_MeetingLine_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Project(ProjectId),   -- lookup, no cascade
    CONSTRAINT UQ_MeetingLine_Meeting_Project UNIQUE (MeetingId, ProjectId)
);
GO

CREATE INDEX IX_MeetingLine_MeetingId ON dbo.MeetingLine(MeetingId);
CREATE INDEX IX_MeetingLine_ProjectId ON dbo.MeetingLine(ProjectId);
GO

/* Single-row defaults applied when creating a new meeting. */
CREATE TABLE dbo.MeetingSetting (
    Id                INT NOT NULL CONSTRAINT PK_MeetingSetting PRIMARY KEY,   -- fixed = 1
    DefaultAgenda     NVARCHAR(MAX) NULL,
    DefaultAttendees  NVARCHAR(MAX) NULL,
    DefaultPreparedBy NVARCHAR(200) NULL,
    UpdatedAt         DATETIME2(0) NULL
);
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
    JobDescription  NVARCHAR(250) NULL,          -- BC job name (shown even without a local master)
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
   Revenue Monthly — recognise revenue from the month-over-month
   progress delta of the QERP "Standard Progress vs Actual
   Progress Summary" report. Deliberately NOT linked to dbo.Project:
   the report carries jobs that do not exist in the project master.
   ============================================================ */
CREATE TABLE dbo.RevenueMonth (
    RevenueMonthId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RevenueMonth PRIMARY KEY,
    PeriodYear     INT NOT NULL,
    PeriodMonth    INT NOT NULL,
    Note           NVARCHAR(300) NULL,
    -- "Prev" = snapshot as of the end of the previous month, "Curr" = end of this month.
    PrevFileName   NVARCHAR(260) NULL,
    PrevReportInfo NVARCHAR(500) NULL,        -- the "Report : ..." filter line from the sheet
    PrevImportedAt DATETIME2(0)  NULL,
    PrevJobCount   INT NOT NULL CONSTRAINT DF_RevenueMonth_PrevJobCount DEFAULT (0),
    CurrFileName   NVARCHAR(260) NULL,
    CurrReportInfo NVARCHAR(500) NULL,
    CurrImportedAt DATETIME2(0)  NULL,
    CurrJobCount   INT NOT NULL CONSTRAINT DF_RevenueMonth_CurrJobCount DEFAULT (0),
    TargetAmount   DECIMAL(18,2) NULL,        -- revenue the month is aiming at
    -- Confirm = the month is closed: figures final, period read-only until reopened.
    -- Until then the screen labels the revenue "Est Revenue".
    IsConfirmed    BIT NOT NULL CONSTRAINT DF_RevenueMonth_IsConfirmed DEFAULT (0),
    ConfirmedAt    DATETIME2(0)  NULL,
    ConfirmedBy    NVARCHAR(200) NULL,
    CreatedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_RevenueMonth_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt      DATETIME2(0) NULL,
    CONSTRAINT UQ_RevenueMonth_Period UNIQUE (PeriodYear, PeriodMonth),
    CONSTRAINT CK_RevenueMonth_Month  CHECK (PeriodMonth BETWEEN 1 AND 12)
);
GO

CREATE TABLE dbo.RevenueMonthSnapshot (
    RevenueSnapshotId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_RevenueMonthSnapshot PRIMARY KEY,
    RevenueMonthId  INT NOT NULL,
    Side            NVARCHAR(4)  NOT NULL,     -- Prev | Curr
    JobNo           NVARCHAR(50) NOT NULL,
    JobName         NVARCHAR(300) NULL,
    Customer        NVARCHAR(300) NULL,
    Pm              NVARCHAR(200) NULL,
    StdGroup        NVARCHAR(50)  NULL,        -- "Std. Progress" group code, e.g. CUT-MANUAL
    Stage           NVARCHAR(100) NULL,        -- "Progress" stage text, e.g. Sign go live
    Revenue         DECIMAL(18,2) NULL,        -- project value from the report
    ProgressStd     DECIMAL(9,4)  NULL,        -- "% Progress by Std." (0..100)
    ProgressAct     DECIMAL(9,4)  NULL,        -- "% Progress by Act. Time sheet" (0..100)
    RevenueProgress DECIMAL(18,2) NULL,        -- report's own recognised-to-date amount
    MergedRowCount  INT NOT NULL CONSTRAINT DF_RevenueMonthSnapshot_Merged DEFAULT (1),
    -- This month's % corrected by hand on screen; the imported value above stays untouched.
    -- Re-importing the side drops the row, so the file always wins over an old edit.
    OverrideProgressStd DECIMAL(9,4)  NULL,
    OverrideProgressAct DECIMAL(9,4)  NULL,
    OverrideAt      DATETIME2(0)  NULL,
    OverrideBy      NVARCHAR(200) NULL,
    CreatedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_RevenueMonthSnapshot_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_RevenueMonthSnapshot_Month FOREIGN KEY (RevenueMonthId)
        REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
    CONSTRAINT UQ_RevenueMonthSnapshot_Job UNIQUE (RevenueMonthId, Side, JobNo),
    CONSTRAINT CK_RevenueMonthSnapshot_Side CHECK (Side IN (N'Prev', N'Curr'))
);
GO
CREATE INDEX IX_RevenueMonthSnapshot_MonthSide ON dbo.RevenueMonthSnapshot(RevenueMonthId, Side);
GO

/* Jobs typed in by hand on the screen (mainly to estimate revenue the report does not
   carry yet). Separate from the snapshots on purpose: re-importing either Excel file
   must leave these rows alone. Amount, when filled in, wins over the % calculation. */
/* Single-row defaults applied when creating a new Revenue Monthly period. */
CREATE TABLE dbo.RevenueMonthSetting (
    Id                  INT NOT NULL CONSTRAINT PK_RevenueMonthSetting PRIMARY KEY,   -- fixed = 1
    DefaultTargetAmount DECIMAL(18,2) NULL,
    UpdatedAt           DATETIME2(0)  NULL,
    CONSTRAINT CK_RevenueMonthSetting_Id CHECK (Id = 1)
);
GO

CREATE TABLE dbo.RevenueMonthManualLine (
    RevenueMonthManualLineId INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_RevenueMonthManualLine PRIMARY KEY,
    RevenueMonthId INT NOT NULL,
    JobNo          NVARCHAR(50)  NOT NULL,
    JobName        NVARCHAR(300) NULL,
    Customer       NVARCHAR(300) NULL,
    Revenue        DECIMAL(18,2) NULL,       -- project value
    PrevProgress   DECIMAL(9,4)  NULL,       -- % at the end of last month
    CurrProgress   DECIMAL(9,4)  NULL,       -- % at the end of this month
    Amount         DECIMAL(18,2) NULL,       -- typed straight in; wins over the % calc
    Note           NVARCHAR(300) NULL,
    CreatedAt      DATETIME2(0) NOT NULL
        CONSTRAINT DF_RevenueMonthManualLine_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CreatedBy      NVARCHAR(200) NULL,
    UpdatedAt      DATETIME2(0) NULL,
    CONSTRAINT FK_RevenueMonthManualLine_Month FOREIGN KEY (RevenueMonthId)
        REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
    CONSTRAINT UQ_RevenueMonthManualLine_Job UNIQUE (RevenueMonthId, JobNo)
);
GO

/* An immutable snapshot of a whole period, numbered per period. The figures live in
   PayloadJson as the fully-computed detail rather than as FKs into the live tables, so a
   version keeps reading the same forever — even after the period is re-imported, re-edited,
   or the calculation changes. Nothing updates a row here after the INSERT. */
CREATE TABLE dbo.RevenueMonthArchive (
    RevenueMonthArchiveId INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_RevenueMonthArchive PRIMARY KEY,
    RevenueMonthId INT NOT NULL,
    VersionNo      INT NOT NULL,                  -- 1, 2, 3 … per period
    ArchivedAt     DATETIME2(0) NOT NULL
        CONSTRAINT DF_RevenueMonthArchive_ArchivedAt DEFAULT (SYSUTCDATETIME()),
    ArchivedBy     NVARCHAR(200) NULL,
    Reason         NVARCHAR(300) NULL,            -- why it was kept, free text
    IsAuto         BIT NOT NULL                   -- 1 = taken automatically on Confirm
        CONSTRAINT DF_RevenueMonthArchive_IsAuto DEFAULT (0),
    -- Denormalised so the version list renders without parsing the payload.
    JobCount       INT NOT NULL
        CONSTRAINT DF_RevenueMonthArchive_JobCount DEFAULT (0),
    TotalStd       DECIMAL(18,2) NULL,
    TotalAct       DECIMAL(18,2) NULL,
    TargetAmount   DECIMAL(18,2) NULL,
    WasConfirmed   BIT NOT NULL
        CONSTRAINT DF_RevenueMonthArchive_WasConfirmed DEFAULT (0),
    PayloadJson    NVARCHAR(MAX) NOT NULL,        -- frozen RevenueMonthDetailDto
    CONSTRAINT FK_RevenueMonthArchive_Month FOREIGN KEY (RevenueMonthId)
        REFERENCES dbo.RevenueMonth(RevenueMonthId) ON DELETE CASCADE,
    CONSTRAINT UQ_RevenueMonthArchive_Version UNIQUE (RevenueMonthId, VersionNo)
);
GO

/* ============================================================
   Billing KPI — lines of the BC "Posted Sales Invoice Lines" export.
   No per-line key in the export, so a line = Document No. + its position (LineSeq).
   Posted invoices never change in BC: an import only adds unseen documents.
   Deleted lines stay as tombstones (IsDeleted) so a later export can't bring them back.
   No FK to Project: ProjectNo is matched by code at read time.
   ============================================================ */
CREATE TABLE dbo.BillingInvoiceLine (
    BillingInvoiceLineId INT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_BillingInvoiceLine PRIMARY KEY,
    DocumentNo         NVARCHAR(30)  NOT NULL,     -- IV2601-0001 (also TA…, DB…)
    LineSeq            INT           NOT NULL,     -- position of the line within its document
    PostingDate        DATE          NULL,
    CustomerNo         NVARCHAR(30)  NULL,
    CustomerName       NVARCHAR(300) NULL,
    CustomerSearchName NVARCHAR(150) NULL,
    LineType           NVARCHAR(20)  NOT NULL,     -- Item | Resource
    ItemNo             NVARCHAR(50)  NULL,         -- BC "No."
    ItemCategoryCode   NVARCHAR(50)  NULL,
    Description        NVARCHAR(250) NULL,
    Quantity           DECIMAL(18,4) NULL,         -- negative on credit/reversal lines
    UnitOfMeasure      NVARCHAR(20)  NULL,         -- MD | UNIT | TRIPS | …
    UnitPrice          DECIMAL(18,2) NULL,         -- Unit Price Excl. VAT
    LineDiscountPct    DECIMAL(9,4)  NULL,
    LineAmount         DECIMAL(18,2) NULL,         -- Line Amount Excl. VAT
    AmountInclVat      DECIMAL(18,2) NULL,
    BoiCode            NVARCHAR(20)  NULL,
    ProjectNo          NVARCHAR(50)  NULL,         -- job code, matched to Project.Code
    ProjectTaskNo      NVARCHAR(50)  NULL,
    ContractEntryNo    INT           NULL,
    JobPlanningLineNo  INT           NULL,
    JobPlanningDescription NVARCHAR(250) NULL,
    IsConfirmed        BIT NOT NULL
        CONSTRAINT DF_BillingInvoiceLine_IsConfirmed DEFAULT (0),
    ConfirmedAt        DATETIME2(0)  NULL,
    ConfirmedBy        NVARCHAR(200) NULL,
    IsDeleted          BIT NOT NULL
        CONSTRAINT DF_BillingInvoiceLine_IsDeleted DEFAULT (0),
    DeletedAt          DATETIME2(0)  NULL,
    DeletedBy          NVARCHAR(200) NULL,
    IsAllocLocked      BIT NOT NULL                -- allocation finished and locked
        CONSTRAINT DF_BillingInvoiceLine_IsAllocLocked DEFAULT (0),
    AllocLockedAt      DATETIME2(0)  NULL,
    AllocLockedBy      NVARCHAR(200) NULL,
    OtherQuantity      DECIMAL(18,4) NULL,         -- allocated outside the resource master (e.g. another dept)
    OtherNote          NVARCHAR(200) NULL,         -- who / which department that is
    SourceFileName     NVARCHAR(260) NULL,
    ImportedAt         DATETIME2(0)  NOT NULL
        CONSTRAINT DF_BillingInvoiceLine_ImportedAt DEFAULT (SYSUTCDATETIME()),
    ImportedBy         NVARCHAR(200) NULL,
    CONSTRAINT UQ_BillingInvoiceLine_DocLine UNIQUE (DocumentNo, LineSeq)
);
GO
CREATE INDEX IX_BillingInvoiceLine_PostingDate ON dbo.BillingInvoiceLine(PostingDate);
CREATE INDEX IX_BillingInvoiceLine_ProjectNo   ON dbo.BillingInvoiceLine(ProjectNo);
GO

/* How much of one invoice line's Quantity each KPI resource gets (signed: credit lines are negative).
   A blank cell is no row. */
CREATE TABLE dbo.BillingAllocation (
    BillingInvoiceLineId INT NOT NULL,
    ResourceId           INT NOT NULL,
    Quantity             DECIMAL(18,4) NOT NULL,
    UpdatedAt            DATETIME2(0)  NOT NULL
        CONSTRAINT DF_BillingAllocation_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedBy            NVARCHAR(200) NULL,
    CONSTRAINT PK_BillingAllocation PRIMARY KEY (BillingInvoiceLineId, ResourceId),
    CONSTRAINT FK_BillingAllocation_Line FOREIGN KEY (BillingInvoiceLineId)
        REFERENCES dbo.BillingInvoiceLine(BillingInvoiceLineId) ON DELETE CASCADE,
    CONSTRAINT FK_BillingAllocation_Resource FOREIGN KEY (ResourceId)
        REFERENCES dbo.Resource(ResourceId)
);
GO
CREATE INDEX IX_BillingAllocation_Resource ON dbo.BillingAllocation(ResourceId);
GO

/* Baht per manday, one rate per year. Billing Manday = ROUND(Line Amount / rate of the posting
   year, 3) — computed on read; a rate change rescales the allocations of locked lines. */
CREATE TABLE dbo.BillingMandayRate (
    [Year]    INT           NOT NULL CONSTRAINT PK_BillingMandayRate PRIMARY KEY,
    Rate      DECIMAL(18,2) NOT NULL,
    UpdatedAt DATETIME2(0)  NOT NULL
        CONSTRAINT DF_BillingMandayRate_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedBy NVARCHAR(200) NULL,
    CONSTRAINT CK_BillingMandayRate_Rate CHECK (Rate > 0)
);
GO

/* Local copy of every BC job's name and PM, refreshed on demand from the Billing screen —
   invoices reference far more jobs than the Project master / D365 staging hold. */
CREATE TABLE dbo.BcJobInfo (
    JobNo          NVARCHAR(50)  NOT NULL CONSTRAINT PK_BcJobInfo PRIMARY KEY,
    JobName        NVARCHAR(300) NULL,     -- BC projects.displayName
    ProjectManager NVARCHAR(50)  NULL,     -- BC qerpProjectManager, e.g. Q63-036
    PmEmail        NVARCHAR(200) NULL,     -- BC qerpPMEmail
    CustomerName   NVARCHAR(300) NULL,
    Status         NVARCHAR(50)  NULL,
    FetchedAt      DATETIME2(0)  NOT NULL
        CONSTRAINT DF_BcJobInfo_FetchedAt DEFAULT (SYSUTCDATETIME())
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
