/* ============================================================
   Migration: add ItemCategoryCode to Task + D365TaskStaging.
   Idempotent — safe to run repeatedly.
   ============================================================ */
USE QtmManday;
GO

IF COL_LENGTH(N'dbo.Task', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.Task ADD ItemCategoryCode NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.D365TaskStaging', N'ItemCategoryCode') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD ItemCategoryCode NVARCHAR(50) NULL;
GO
