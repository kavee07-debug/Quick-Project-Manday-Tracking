using System.Globalization;
using ClosedXML.Excel;

namespace Qtm.Api.Services;

// Flat row shapes used for both export and import. The controller resolves these
// against the database (codes/names -> ids) so the service stays persistence-free.
public record ProjectRow(string Code, string Name, string? Description, string? Type, string Status, decimal? Revenue, DateOnly? StartDate, DateOnly? EndDate);
public record TaskRow(string ProjectCode, string TaskName, string? Description, string Status, int SortOrder);
public record MandayRow(string ProjectCode, string TaskName, string EntryType, string? ResourceName, decimal Manday, DateOnly? StartDate, DateOnly? EndDate, string? Note);

/// <summary>Builds and parses .xlsx workbooks for Project / Task / Manday data.</summary>
public class ExcelService
{
    private const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    public const string ContentTypeXlsx = ContentType;

    // ---------- Projects ----------
    public byte[] WriteProjects(IEnumerable<ProjectRow> rows)
    {
        var headers = new[] { "Code", "Name", "Description", "Type", "Status", "Revenue", "StartDate", "EndDate" };
        return Build("Projects", headers, rows, (ws, r, row) =>
        {
            ws.Cell(r, 1).Value = row.Code;
            ws.Cell(r, 2).Value = row.Name;
            ws.Cell(r, 3).Value = row.Description ?? "";
            ws.Cell(r, 4).Value = row.Type ?? "";
            ws.Cell(r, 5).Value = row.Status;
            if (row.Revenue is decimal rev) ws.Cell(r, 6).Value = rev;
            SetDate(ws.Cell(r, 7), row.StartDate);
            SetDate(ws.Cell(r, 8), row.EndDate);
        });
    }

    public List<ProjectRow> ReadProjects(Stream stream)
    {
        return ReadRows(stream, cells => new ProjectRow(
            Code: cells(1),
            Name: cells(2),
            Description: NullIfEmpty(cells(3)),
            Type: NullIfEmpty(cells(4)),
            Status: Default(cells(5), "Open"),
            Revenue: ParseDecimalNullable(cells(6)),
            StartDate: ParseDate(cells(7)),
            EndDate: ParseDate(cells(8))),
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
    private static string Default(string s, string fallback) => string.IsNullOrWhiteSpace(s) ? fallback : s;

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
