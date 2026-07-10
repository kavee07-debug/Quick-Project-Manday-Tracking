/* ============================================================
   Migration: add MasterItem (D365BC item master).
   Idempotent — safe to run on an existing QtmManday DB.
   schema.sql (full rebuild) already includes this table.
   ============================================================ */
USE QtmManday;
GO

IF OBJECT_ID(N'dbo.MasterItem', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MasterItem (
        ItemId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MasterItem PRIMARY KEY,
        Number           NVARCHAR(50)  NOT NULL,
        DisplayName      NVARCHAR(300) NOT NULL CONSTRAINT DF_MasterItem_Name DEFAULT (N''),
        ItemCategoryCode NVARCHAR(50)  NULL,
        CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_MasterItem_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt        DATETIME2(0)  NULL,
        CONSTRAINT UQ_MasterItem_Number UNIQUE (Number)
    );
END
GO
