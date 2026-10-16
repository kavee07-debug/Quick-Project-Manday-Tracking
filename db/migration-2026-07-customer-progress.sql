/* ============================================================
   Migration: add Customer master + Project.CustomerId + Project.Progress
   Idempotent — safe to run on an existing QtmManday DB that predates
   these columns. schema.sql (full rebuild) already includes them.
   ============================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

/* ---- Customer table ---- */
IF OBJECT_ID(N'dbo.Customer', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Customer (
        CustomerId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customer PRIMARY KEY,
        Code          NVARCHAR(50) NOT NULL,
        Name          NVARCHAR(300) NOT NULL,
        IsActive      BIT NOT NULL CONSTRAINT DF_Customer_IsActive DEFAULT (1),
        CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_Customer_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt     DATETIME2(0) NULL,
        CONSTRAINT UQ_Customer_Code UNIQUE (Code)
    );
END
GO

/* ---- Project.CustomerId ---- */
IF COL_LENGTH(N'dbo.Project', N'CustomerId') IS NULL
BEGIN
    ALTER TABLE dbo.Project ADD CustomerId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Project_Customer')
BEGIN
    ALTER TABLE dbo.Project
        ADD CONSTRAINT FK_Project_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customer(CustomerId);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Project_CustomerId' AND object_id = OBJECT_ID(N'dbo.Project'))
BEGIN
    CREATE INDEX IX_Project_CustomerId ON dbo.Project(CustomerId);
END
GO

/* ---- Project.Progress ---- */
IF COL_LENGTH(N'dbo.Project', N'Progress') IS NULL
BEGIN
    ALTER TABLE dbo.Project ADD Progress DECIMAL(5,2) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Project_Progress')
BEGIN
    ALTER TABLE dbo.Project
        ADD CONSTRAINT CK_Project_Progress CHECK (Progress IS NULL OR (Progress >= 0 AND Progress <= 100));
END
GO
