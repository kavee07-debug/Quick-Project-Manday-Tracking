/* ============================================================
   Migration: add Revenue to D365TaskStaging (per-task revenue).
   Idempotent — safe to run repeatedly.
   ============================================================ */
USE QtmManday;
GO

IF COL_LENGTH(N'dbo.D365TaskStaging', N'Revenue') IS NULL
    ALTER TABLE dbo.D365TaskStaging ADD Revenue DECIMAL(18,2) NULL;
GO
