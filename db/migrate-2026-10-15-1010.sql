/* ================================================================
   Migration 2026-10-15 10:10 — Billing KPI: Posted Sales Invoice lines, BC job cache,
                                Resource.IsBillingKpi and per-resource allocation

   Adds dbo.BillingInvoiceLine — one row per line of the BC "Posted Sales
   Invoice Lines" export, imported on the Billing Manday Allocate screen.
   Rows whose Type is blank (BC's text/comment lines) are not stored.

   The export carries no per-line key (Contract Entry No. repeats and can be
   blank), so a line is identified by its Document No. plus its position in
   that document (LineSeq). Posted invoices never change in BC, so an import
   only adds documents the table has not seen; documents already present —
   confirmed, pending or deleted — are left exactly as they are.

   Deliberately no FK to dbo.Project: Project No. is matched by code at read
   time, because invoices reference jobs the local project master may not have.

   Idempotent — safe to run repeatedly.
   Run:  sqlcmd -S <DBSERVER> -d QtmManday -C -i db\migrate-2026-10-15-1010.sql
         (SQL auth: add -U <user> -P <pwd>;  Windows auth: add -E)
   ================================================================ */
:on error exit
/* Azure SQL ไม่รองรับ USE — ต้องระบุฐานข้อมูลตอนเรียก (sqlcmd -d QtmManday) */
IF DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50000, N'รันผิดฐานข้อมูล — ใส่ -d QtmManday ตอนเรียก sqlcmd', 1;
GO

PRINT 'BillingInvoiceLine';
GO
IF OBJECT_ID(N'dbo.BillingInvoiceLine', N'U') IS NULL
BEGIN
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

        SourceFileName     NVARCHAR(260) NULL,
        ImportedAt         DATETIME2(0)  NOT NULL
            CONSTRAINT DF_BillingInvoiceLine_ImportedAt DEFAULT (SYSUTCDATETIME()),
        ImportedBy         NVARCHAR(200) NULL,

        CONSTRAINT UQ_BillingInvoiceLine_DocLine UNIQUE (DocumentNo, LineSeq)
    );
    CREATE INDEX IX_BillingInvoiceLine_PostingDate ON dbo.BillingInvoiceLine(PostingDate);
    CREATE INDEX IX_BillingInvoiceLine_ProjectNo   ON dbo.BillingInvoiceLine(ProjectNo);
END
GO

/* Soft delete. Lines removed on the Import screen are kept as tombstones so a later (cumulative)
   export cannot bring them back: import only adds documents the table has never seen, deleted
   lines included. Posted invoices are immutable in BC, so skipping a known document loses nothing. */
PRINT 'BillingInvoiceLine.IsDeleted';
GO
IF COL_LENGTH(N'dbo.BillingInvoiceLine', N'IsDeleted') IS NULL
BEGIN
    ALTER TABLE dbo.BillingInvoiceLine ADD
        IsDeleted BIT NOT NULL CONSTRAINT DF_BillingInvoiceLine_IsDeleted DEFAULT (0),
        DeletedAt DATETIME2(0)  NULL,
        DeletedBy NVARCHAR(200) NULL;
END
GO

/* Resource.IsBillingKpi — marks the people whose billed manday counts toward the Billing KPI.
   They become the columns of the allocation matrix on the Billing Manday Allocate screen. */
PRINT 'Resource.IsBillingKpi';
GO
IF COL_LENGTH(N'dbo.Resource', N'IsBillingKpi') IS NULL
    ALTER TABLE dbo.Resource ADD
        IsBillingKpi BIT NOT NULL CONSTRAINT DF_Resource_IsBillingKpi DEFAULT (0);
GO

/* BillingAllocation — how much of one invoice line's Quantity each KPI resource gets.
   One row per (line, resource); a blank/zero cell is simply no row. Signed, because credit lines
   carry a negative Quantity. The line goes when the line goes; a resource that has allocations
   cannot be hard-deleted (Resource rows are deactivated instead, as elsewhere). */
PRINT 'BillingAllocation';
GO
IF OBJECT_ID(N'dbo.BillingAllocation', N'U') IS NULL
BEGIN
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
    CREATE INDEX IX_BillingAllocation_Resource ON dbo.BillingAllocation(ResourceId);
END
GO

/* Allocation lock — a fully allocated line can be locked so its matrix cells can't change by
   accident. Only lines whose allocations add up to their Quantity may be locked (enforced in the
   API); a locked line can't be un-confirmed either, until it is unlocked. */
PRINT 'BillingInvoiceLine.IsAllocLocked';
GO
IF COL_LENGTH(N'dbo.BillingInvoiceLine', N'IsAllocLocked') IS NULL
BEGIN
    ALTER TABLE dbo.BillingInvoiceLine ADD
        IsAllocLocked BIT NOT NULL CONSTRAINT DF_BillingInvoiceLine_IsAllocLocked DEFAULT (0),
        AllocLockedAt DATETIME2(0)  NULL,
        AllocLockedBy NVARCHAR(200) NULL;
END
GO

/* BillingMandayRate — baht per manday, one rate per year. A line's Billing Manday is
   ROUND(Line Amount / the rate of its posting year, 3); allocation is checked against that figure.
   Computed on read, never stored, so a rate change reaches every line of the year at once — and
   the API rescales the allocations of locked lines so they still add up. */
PRINT 'BillingMandayRate';
GO
IF OBJECT_ID(N'dbo.BillingMandayRate', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.BillingMandayRate (
        [Year]    INT           NOT NULL CONSTRAINT PK_BillingMandayRate PRIMARY KEY,
        Rate      DECIMAL(18,2) NOT NULL,
        UpdatedAt DATETIME2(0)  NOT NULL
            CONSTRAINT DF_BillingMandayRate_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedBy NVARCHAR(200) NULL,
        CONSTRAINT CK_BillingMandayRate_Rate CHECK (Rate > 0)
    );
END
GO

/* "Other" allocation — manday given to someone outside the resource master (another department,
   etc.). Lives on the line rather than in BillingAllocation, which needs a real ResourceId. It
   counts toward the line's allocated total like any matrix cell (lock, rate rescale, KPI). */
PRINT 'BillingInvoiceLine.OtherQuantity';
GO
IF COL_LENGTH(N'dbo.BillingInvoiceLine', N'OtherQuantity') IS NULL
BEGIN
    ALTER TABLE dbo.BillingInvoiceLine ADD
        OtherQuantity DECIMAL(18,4) NULL,
        OtherNote     NVARCHAR(200) NULL;      -- who / which department the Other manday is for
END
GO

/* BcJobInfo — a local copy of every BC job's name and Project Manager, refreshed on demand from the
   Billing screen. Invoices reference a thousand-odd jobs, far more than the Project master or the
   D365 job staging hold, and asking BC per page view would be far too slow. */
PRINT 'BcJobInfo';
GO
IF OBJECT_ID(N'dbo.BcJobInfo', N'U') IS NULL
BEGIN
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
END
GO

PRINT 'migrate-2026-10-15-1010: done.';
GO
