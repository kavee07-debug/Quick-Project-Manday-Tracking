/* ============================================================
   Migration: add Revenue to Task (per-task revenue carried from D365).
   Idempotent — safe to run repeatedly.
   ============================================================ */
USE QtmManday;
GO

IF COL_LENGTH(N'dbo.Task', N'Revenue') IS NULL
    ALTER TABLE dbo.Task ADD Revenue DECIMAL(18,2) NULL;
GO
