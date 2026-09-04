using System.Globalization;
using ClosedXML.Excel;

namespace Qtm.Api.Services;

// Flat row shapes used for both export and import. The controller resolves these
// against the database (codes/names -> ids) so the service stays persistence-free.
public record ProjectRow(string Code, string Name, string? CustomerCode, string? CustomerName, string? Description, string? Type, string Status, decimal? Progress, decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate);
public record TaskRow(string ProjectCode, string TaskName, string? Description, string Status, int SortOrder);
public record MandayRow(string ProjectCode, string TaskName, string EntryType, string? ResourceName, decimal Manday, DateOnly? StartDate, DateOnly? EndDate, string? Note);
// Progress update sheet — only Project No (Code), Name, Progress, Status.
public record ProgressRow(string Code, string Name, decimal? Progress, string Status);
public record CustomerRow(string Code, string Name, bool IsActive);

// ---- QERP "Standard Progress vs Actual Progress Summary" report (Revenue Monthly import source) ----
// Layout differs from the sheets this app generates: the header sits on row 7 and column A holds
// "JOBNO : Job name" in a single cell, so it gets its own reader (see ReadStdProgressReport).
public record StdProgressReportRow(string JobNo, string? JobName, string? Customer, string? Pm,
    string? StdGroup, string? Stage, decimal? Revenue, decimal? ProgressStd, decimal? ProgressAct,
    decimal? RevenueProgress, int ExcelRow);
public record StdProgressReport(string? ReportInfo, List<StdProgressReportRow> Rows);
// One computed Revenue Monthly line, ready for export.
public record RevenueMonthlyExportRow(string JobNo, string? JobName, string? Customer, decimal? Revenue,
    decimal PrevStd, decimal CurrStd, decimal DeltaStd, decimal AmountStd,
    decimal PrevAct, decimal CurrAct, decimal DeltaAct, decimal AmountAct, string Status);

/// <summary>Builds and parses .xlsx workbooks for Project / Task / Manday data.</summary>
public class ExcelService
{
    private const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    public const string ContentTypeXlsx = ContentType;

    // ---------- Projects ----------
    public byte[] WriteProjects(IEnumerable<ProjectRow> rows)
    {
        var headers = new[] { "Code", "Name", "CustomerCode", "CustomerName", "Description", "Type", "Status", "Progress", "Revenue", "StartDate", "EndDate" };
        return Build("Projects", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.Code;
            ws.Cell(r, 2).Value = row.Name;
            ws.Cell(r, 3).Value = row.CustomerCode ?? "";
            ws.Cell(r, 4).Value = row.CustomerName ?? "";
            ws.Cell(r, 5).Value = row.Description ?? "";
            ws.Cell(r, 6).Value = row.Type ?? "";
            ws.Cell(r, 7).Value = row.Status;
            if (row.Progress is decimal pct) ws.Cell(r, 8).Value = pct;
            if (row.Revenue is decimal rev) ws.Cell(r, 9).Value = rev;
            SetDate(ws.Cell(r, 10), row.StartDate);
            SetDate(ws.Cell(r, 11), row.EndDate);
        });
    }

    public List<ProjectRow> ReadProjects(Stream stream)
    {
        return ReadRows(stream, cells => new ProjectRow(
            Code: cells(1),
            Name: cells(2),
            CustomerCode: NullIfEmpty(cells(3)),
            CustomerName: NullIfEmpty(cells(4)),
            Description: NullIfEmpty(cells(5)),
            Type: NullIfEmpty(cells(6)),
            Status: Default(cells(7), "Open"),
            Progress: ParseDecimalNullable(cells(8)),
            Revenue: ParseDecimalNullable(cells(9)),
            StartDate: ParseDate(cells(10)),
            EndDate: ParseDate(cells(11))),
            requiredFirstCol: true);
    }

    // ---------- Progress update (Project No, Name, Progress, Status) ----------
    public byte[] WriteProgress(IEnumerable<ProgressRow> rows)
    {
        var headers = new[] { "Project No", "Name", "Progress", "Status" };
        return Build("Progress", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.Code;
            ws.Cell(r, 2).Value = row.Name;
            if (row.Progress is decimal pct) ws.Cell(r, 3).Value = pct;
            ws.Cell(r, 4).Value = row.Status;
        });
    }

    public List<ProgressRow> ReadProgress(Stream stream)
    {
        return ReadRows(stream, cells => new ProgressRow(
            Code: cells(1),
            Name: cells(2),
            Progress: ParseDecimalNullable(cells(3)),
            Status: cells(4)),
            requiredFirstCol: true);
    }

    // ---------- Customers ----------
    public byte[] WriteCustomers(IEnumerable<CustomerRow> rows)
    {
        var headers = new[] { "Code", "Name", "IsActive" };
        return Build("Customers", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.Code;
            ws.Cell(r, 2).Value = row.Name;
            ws.Cell(r, 3).Value = row.IsActive ? "Yes" : "No";
        });
    }

    public List<CustomerRow> ReadCustomers(Stream stream)
    {
        return ReadRows(stream, cells => new CustomerRow(
            Code: cells(1),
            Name: cells(2),
            IsActive: ParseBool(cells(3), fallback: true)),
            requiredFirstCol: true);
    }

    // ---------- Tasks ----------
    public byte[] WriteTasks(IEnumerable<TaskRow> rows)
    {
        var headers = new[] { "Project", "Task", "Description", "Status", "SortOrder" };
        return Build("Tasks", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.ProjectCode;
            ws.Cell(r, 2).Value = row.TaskName;
            ws.Cell(r, 3).Value = row.Description ?? "";
            ws.Cell(r, 4).Value = row.Status;
            ws.Cell(r, 5).Value = row.SortOrder;
        });
    }

    public List<TaskRow> ReadTasks(Stream stream)
    {
        return ReadRows(stream, cells => new TaskRow(
            ProjectCode: cells(1),
            TaskName: cells(2),
            Description: NullIfEmpty(cells(3)),
            Status: Default(cells(4), "Open"),
            SortOrder: ParseInt(cells(5))),
            requiredFirstCol: true);
    }

    // ---------- Mandays (Estimate & Actual) ----------
    public byte[] WriteMandays(IEnumerable<MandayRow> rows)
    {
        var headers = new[] { "Project", "Task", "Type", "Resource", "Manday", "StartDate", "EndDate", "Note" };
        return Build("EstimateActual", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.ProjectCode;
            ws.Cell(r, 2).Value = row.TaskName;
            ws.Cell(r, 3).Value = row.EntryType;
            ws.Cell(r, 4).Value = row.ResourceName ?? "";
            ws.Cell(r, 5).Value = row.Manday;
            SetDate(ws.Cell(r, 6), row.StartDate);
            SetDate(ws.Cell(r, 7), row.EndDate);
            ws.Cell(r, 8).Value = row.Note ?? "";
        });
    }

    public List<MandayRow> ReadMandays(Stream stream)
    {
        return ReadRows(stream, cells => new MandayRow(
            ProjectCode: cells(1),
            TaskName: cells(2),
            EntryType: cells(3),
            ResourceName: NullIfEmpty(cells(4)),
            Manday: ParseDecimal(cells(5)),
            StartDate: ParseDate(cells(6)),
            EndDate: ParseDate(cells(7)),
            Note: NullIfEmpty(cells(8))),
            requiredFirstCol: true);
    }

    // ---------- Revenue Monthly ----------

    /// <summary>
    /// Parses a QERP "Standard Progress vs Actual Progress Summary" export. The header row is found by
    /// scanning for a first cell starting with "Job No", and columns are then mapped by header text
    /// (not position) so extra/reordered columns do not break the import.
    /// </summary>
    public StdProgressReport ReadStdProgressReport(Stream stream)
    {
        using var wb = new XLWorkbook(stream);
        var ws = wb.Worksheet(1);
        var used = ws.RangeUsed() ?? throw new InvalidOperationException("ไฟล์ Excel ว่าง ไม่พบข้อมูล");
        var firstRow = used.FirstRow().RowNumber();
        var lastRow = used.LastRow().RowNumber();
        var lastCol = used.LastColumn().ColumnNumber();

        var headerRow = 0;
        string? reportInfo = null;
        for (var r = firstRow; r <= Math.Min(lastRow, firstRow + 30); r++)
        {
            var a = ws.Cell(r, 1).GetString().Trim();
            if (reportInfo is null && a.StartsWith("Report", StringComparison.OrdinalIgnoreCase) && a.Contains(':'))
                reportInfo = Truncate(a, 500);
            if (a.StartsWith("Job No", StringComparison.OrdinalIgnoreCase)) { headerRow = r; break; }
        }
        if (headerRow == 0)
            throw new InvalidOperationException(
                "ไม่พบหัวตาราง \"Job No.\" ในไฟล์ — กรุณาใช้ไฟล์ Standard Progress vs Actual Progress Summary จาก QERP");

        var byHeader = new Dictionary<string, int>();
        for (var c = 1; c <= lastCol; c++)
        {
            var h = NormalizeHeader(ws.Cell(headerRow, c).GetString());
            if (h.Length > 0) byHeader.TryAdd(h, c);
        }
        int Col(params string[] names)
        {
            foreach (var n in names)
                if (byHeader.TryGetValue(n, out var c)) return c;
            return 0;
        }

        var cJob = Col("job no.", "job no");
        var cCustomer = Col("customer");
        var cPm = Col("pm");
        var cStdGroup = Col("std. progress", "std progress");
        var cStage = Col("progress");
        var cRevenue = Col("revenue");
        var cStd = Col("% progress by std.", "% progress by std");
        var cAct = Col("% progress by act. time sheet", "% progress by act time sheet");
        var cRevProg = Col("revenue progress");

        var missing = new List<string>();
        if (cJob == 0) missing.Add("Job No.");
        if (cRevenue == 0) missing.Add("Revenue");
        if (cStd == 0) missing.Add("% Progress by Std.");
        if (cAct == 0) missing.Add("% Progress by Act. Time sheet");
        if (missing.Count > 0)
            throw new InvalidOperationException($"ไฟล์ขาดคอลัมน์ที่จำเป็น: {string.Join(", ", missing)}");

        var rows = new List<StdProgressReportRow>();
        for (var r = headerRow + 1; r <= lastRow; r++)
        {
            var a = ws.Cell(r, cJob).GetString().Trim();
            if (a.Length == 0) continue;
            var sep = a.IndexOf(':');
            if (sep < 0) continue;                     // grand-total / footer lines carry no "JOBNO : name"
            var jobNo = a[..sep].Trim();
            if (jobNo.Length == 0) continue;

            string? Str(int c, int max) => c == 0 ? null : Truncate(NullIfEmpty(ws.Cell(r, c).GetString().Trim()), max);
            decimal? Num(int c) => c == 0 ? null : CellDecimal(ws.Cell(r, c));

            rows.Add(new StdProgressReportRow(
                JobNo: Truncate(jobNo, 50)!,
                JobName: Truncate(NullIfEmpty(a[(sep + 1)..].Trim()), 300),
                Customer: Str(cCustomer, 300),
                Pm: Str(cPm, 200),
                StdGroup: Str(cStdGroup, 50),
                Stage: Str(cStage, 100),
                Revenue: Num(cRevenue),
                ProgressStd: Num(cStd),
                ProgressAct: Num(cAct),
                RevenueProgress: Num(cRevProg),
                ExcelRow: r));
        }
        return new StdProgressReport(reportInfo, rows);
    }

    public byte[] WriteRevenueMonthly(string sheetName, IEnumerable<RevenueMonthlyExportRow> rows)
    {
        var headers = new[]
        {
            "Job No.", "Job Name", "Customer", "มูลค่าโครงการ",
            "% Std. เดือนก่อน", "% Std. เดือนนี้", "Δ% Std.", "รายได้ (Std.)",
            "% Act. เดือนก่อน", "% Act. เดือนนี้", "Δ% Act.", "รายได้ (Act.)", "สถานะ",
        };
        return Build(sheetName, headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.JobNo;
            ws.Cell(r, 2).Value = row.JobName ?? "";
            ws.Cell(r, 3).Value = row.Customer ?? "";
            if (row.Revenue is decimal rev) ws.Cell(r, 4).Value = rev;
            ws.Cell(r, 5).Value = row.PrevStd;
            ws.Cell(r, 6).Value = row.CurrStd;
            ws.Cell(r, 7).Value = row.DeltaStd;
            ws.Cell(r, 8).Value = row.AmountStd;
            ws.Cell(r, 9).Value = row.PrevAct;
            ws.Cell(r, 10).Value = row.CurrAct;
            ws.Cell(r, 11).Value = row.DeltaAct;
            ws.Cell(r, 12).Value = row.AmountAct;
            ws.Cell(r, 13).Value = row.Status;
        });
    }

    // ---------- Helpers ----------
    private static byte[] Build<T>(string sheetName, string[] headers, IEnumerable<T> rows,
        Action<IXLWorksheet, int, T> writeRow)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(sheetName);
        for (var c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
        }

        var r = 2;
        foreach (var row in rows)
            writeRow(ws, r++, row);

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(1);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // Reads data rows (skipping the header). `cells(col)` returns a trimmed string for 1-based column.
    private static List<TRow> ReadRows<TRow>(Stream stream, Func<Func<int, string>, TRow> map, bool requiredFirstCol)
    {
        using var wb = new XLWorkbook(stream);
        var ws = wb.Worksheet(1);
        var used = ws.RangeUsed();
        var result = new List<TRow>();
        if (used is null) return result;

        foreach (var row in used.RowsUsed().Skip(1)) // skip header
        {
            string Cell(int col) => row.Cell(col).GetString().Trim();
            if (requiredFirstCol && string.IsNullOrWhiteSpace(Cell(1)))
                continue; // ignore blank rows
            result.Add(map(Cell));
        }
        return result;
    }

    private static void SetDate(IXLCell cell, DateOnly? d)
    {
        if (d is null) return;
        cell.Value = d.Value.ToDateTime(TimeOnly.MinValue);
        cell.Style.DateFormat.Format = "yyyy-MM-dd";
    }

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;

    private static string? Truncate(string? s, int max) =>
        s is not null && s.Length > max ? s[..max] : s;

    // Header text as written in the sheet can wrap ("% Progress \nby Std.") — flatten it for lookup.
    private static string NormalizeHeader(string s) =>
        string.Join(' ', s.Replace('\n', ' ').Replace('\r', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .ToLowerInvariant();

    // Reads a cell from a foreign workbook: numeric cells go through the typed accessor (never
    // culture-formatted text), anything else falls back to invariant string parsing. Empty -> null,
    // so "no value" stays distinguishable from a real 0.
    private static decimal? CellDecimal(IXLCell cell)
    {
        if (cell.IsEmpty()) return null;
        if (cell.DataType == XLDataType.Number) return (decimal)cell.GetDouble();
        return ParseDecimalNullable(cell.GetString().Trim().Replace(",", ""));
    }
    private static string Default(string s, string fallback) => string.IsNullOrWhiteSpace(s) ? fallback : s;

    // Accepts Yes/No, True/False, 1/0, Active/Inactive (case-insensitive). Empty -> fallback.
    private static bool ParseBool(string s, bool fallback)
    {
        if (string.IsNullOrWhiteSpace(s)) return fallback;
        var v = s.Trim().ToLowerInvariant();
        return v is "yes" or "y" or "true" or "1" or "active";
    }

    private static int ParseInt(string s) =>
        int.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;

    private static decimal ParseDecimal(string s) =>
        decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0m;

    private static decimal? ParseDecimalNullable(string s) =>
        decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : null;

    private static DateOnly? ParseDate(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        return DateOnly.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    }
}
