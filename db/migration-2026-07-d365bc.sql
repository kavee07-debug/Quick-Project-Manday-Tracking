/* ============================================================
   Migration: D365BC integration — connection settings + project staging
   Idempotent — safe to run on an existing QtmManday DB that predates
   these tables. schema.sql (full rebuild) already includes them.
   ============================================================ */
USE QtmManday;
GO

/* ---- D365BC connection settings (single row, Id = 1) ---- */
IF OBJECT_ID(N'dbo.D365BcSetting', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.D365BcSetting (
        Id                  INT NOT NULL CONSTRAINT PK_D365BcSetting PRIMARY KEY,
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
END
GO
IF NOT EXISTS (SELECT 1 FROM dbo.D365BcSetting WHERE Id = 1)
BEGIN
    INSERT INTO dbo.D365BcSetting (Id, ApiVersion) VALUES (1, N'v1.0');
END
GO

/* ---- D365BC project staging ---- */
IF OBJECT_ID(N'dbo.D365ProjectStaging', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.D365ProjectStaging (
        StagingId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_D365ProjectStaging PRIMARY KEY,
        JobNo               NVARCHAR(50)  NOT NULL,
        ProjectName         NVARCHAR(300) NULL,
        BcJobId             NVARCHAR(100) NULL,
        ProjectManagerCode  NVARCHAR(50)  NULL,
        CustomerNo          NVARCHAR(50)  NULL,
        CustomerName        NVARCHAR(300) NULL,
        RawJson             NVARCHAR(MAX) NULL,
        FetchedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Stg_Fetched DEFAULT (SYSUTCDATETIME()),
        CreatedAt           DATETIME2(0)  NOT NULL CONSTRAINT DF_D365Stg_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt           DATETIME2(0)  NULL,
        CONSTRAINT UQ_D365ProjectStaging_JobNo UNIQUE (JobNo)
    );
END
GO
-- Customer columns (added after initial release of the D365 staging table).
IF COL_LENGTH(N'dbo.D365ProjectStaging', N'CustomerNo') IS NULL
    ALTER TABLE dbo.D365ProjectStaging ADD CustomerNo NVARCHAR(50) NULL;
GO
IF COL_LENGTH(N'dbo.D365ProjectStaging', N'CustomerName') IS NULL
    ALTER TABLE dbo.D365ProjectStaging ADD CustomerName NVARCHAR(300) NULL;
GO
-- Type + Revenue (added after the customer columns).
IF COL_LENGTH(N'dbo.D365ProjectStaging', N'Type') IS NULL
    ALTER TABLE dbo.D365ProjectStaging ADD Type NVARCHAR(20) NULL;
GO
IF COL_LENGTH(N'dbo.D365ProjectStaging', N'Revenue') IS NULL
    ALTER TABLE dbo.D365ProjectStaging ADD Revenue DECIMAL(18,2) NULL;
GO
