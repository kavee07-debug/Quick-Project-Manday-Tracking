using System.Text.Json;
using Qtm.Api.Data.Entities;

namespace Qtm.Api.Services;

/// <summary>A job record pulled from the D365BC qerpentitySetJob entity set.</summary>
public record D365Job(string No, string? Id, string? ProjectManager,
    string? CustomerNo, string? CustomerName, string RawJson);

/// <summary>An item pulled from the standard D365BC items(v2.0) entity set.</summary>
public record D365Item(string Number, string? DisplayName, string? ItemCategoryCode);

/// <summary>A jobPlanningLines line — the item no, its job task, line type, and the LCY amount.</summary>
public record D365JobPlanLine(string? No, string? JobTaskNo, string? LineType, decimal LineAmountLcy);

/// <summary>A job task pulled from the analytics jobTasks entity set.</summary>
public record D365JobTask(string TaskNo, string? Description);

/// <summary>A timesheet line pulled from the QERP entitySetTimesheettoPowerBI entity set.</summary>
public record D365Timesheet(string SystemId, string? JobNo, string? JobTaskNo, DateOnly? StartDate,
    string? No, decimal? Quantity, decimal? QuantityMD, string? Comment, string? ProjectManager,
    string? TimesheetStatus, string RawJson);

/// <summary>Raised when a D365BC call fails; Message is safe to show to the user.</summary>
public class D365BcException(string message) : Exception(message);

/// <summary>
/// Thin HTTP client for D365 Business Central. Reproduces the Postman collection:
/// Get Token (client_credentials) → Get Job (filtered) → Job Name (project displayName).
/// No DB access — the orchestration lives in <see cref="D365JobService"/>.
/// </summary>
public class D365BcClient(HttpClient http)
{
    private const string BaseUrl = "https://api.businesscentral.dynamics.com";
    private const string Scope = "https://api.businesscentral.dynamics.com/.default";
    private const string JobEntitySet = "qerpentitySetJob";
    // Standard-API (v2.0) entity sets — change here if the BC tenant exposes different names.
    private const string ItemEntitySet = "items";
    // jobPlanningLines / jobTasks live in Microsoft's analytics API (not the standard v2.0 surface).
    // jobPlanningLines exposes jobNo / lineType / no / lineAmountLCY; jobTasks exposes jobNo / jobTaskNo / description.
    private const string JobPlanningLinesApiPath = "microsoft/analytics/v0.5";
    private const string JobPlanningLinesEntitySet = "jobPlanningLines";
    private const string JobTasksEntitySet = "jobTasks";
    // Timesheets live on the custom QERP surface (same publisher/group/version as Job).
    private const string TimesheetEntitySet = "entitySetTimesheettoPowerBI";
    private const string TimesheetResourceGroupFilter = "CD";   // resourceGroupNo contains 'CD'

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Get Token — OAuth2 client_credentials against Entra. Returns the access_token.</summary>
    public async Task<string> GetTokenAsync(D365BcSetting s, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.TenantId) || string.IsNullOrWhiteSpace(s.ClientId)
            || string.IsNullOrWhiteSpace(s.ClientSecret))
            throw new D365BcException("ยังไม่ได้ตั้งค่า Tenant / Client ID / Client Secret ในหน้า Setup");

        var url = $"https://login.microsoftonline.com/{s.TenantId}/oauth2/v2.0/token";
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["scope"] = Scope,
            ["client_id"] = s.ClientId,
            ["client_secret"] = s.ClientSecret,
        });

        HttpResponseMessage res;
        try { res = await http.PostAsync(url, form, ct); }
        catch (Exception ex) { throw new D365BcException($"เชื่อมต่อ Entra ไม่สำเร็จ: {ex.Message}"); }

        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new D365BcException($"ขอ Token ไม่สำเร็จ ({(int)res.StatusCode}): {Trim(body)}");

        var token = ReadString(body, "access_token");
        if (string.IsNullOrEmpty(token))
            throw new D365BcException("ไม่พบ access_token ในผลลัพธ์");
        return token;
    }

    /// <summary>Get Job — the qerpentitySetJob list, filtered by PM codes, SOJ prefix, and no gt maxCode.</summary>
    public Task<List<D365Job>> GetJobsAsync(D365BcSetting s, string token, string maxCode, CancellationToken ct)
    {
        var pmFilter = BuildPmFilter(s.ProjectManagerCodes);
        var filter = $"({pmFilter}) and startswith(no,'SOJ') and no gt '{maxCode}'";
        return GetJobsByFilterAsync(s, token, filter, ct);
    }

    /// <summary>Get a single Job by its exact number — PM filter still applies, but no "no gt"/SOJ-prefix filter.</summary>
    public Task<List<D365Job>> GetJobByNoAsync(D365BcSetting s, string token, string jobNo, CancellationToken ct)
    {
        var pmFilter = BuildPmFilter(s.ProjectManagerCodes);
        var filter = $"({pmFilter}) and no eq '{jobNo.Replace("'", "''")}'";
        return GetJobsByFilterAsync(s, token, filter, ct);
    }

    private async Task<List<D365Job>> GetJobsByFilterAsync(D365BcSetting s, string token, string filter, CancellationToken ct)
    {
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/{s.ApiPublisher}/{s.ApiGroup}/{s.ApiVersion}"
                + $"/companies({s.CompanyId})/{JobEntitySet}?$filter={Uri.EscapeDataString(filter)}";

        var body = await GetAsync(url, token, "ดึงรายการ Job", ct);

        var jobs = new List<D365Job>();
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("value", out var arr) || arr.ValueKind != JsonValueKind.Array)
            return jobs;

        foreach (var el in arr.EnumerateArray())
        {
            var no = FirstString(el, "no", "No", "number");
            if (string.IsNullOrWhiteSpace(no)) continue;
            jobs.Add(new D365Job(
                No: no!,
                Id: FirstString(el, "id", "systemId", "Id"),
                ProjectManager: FirstString(el, "qerpProjectManager", "projectManager"),
                CustomerNo: FirstString(el, "customerNo", "sellToCustomerNo", "billToCustomerNo", "customerNumber"),
                CustomerName: FirstString(el, "customerName", "sellToCustomerName", "billToName"),
                RawJson: el.GetRawText()));
        }
        return jobs;
    }

    /// <summary>Job Name — the standard projects({id}) endpoint; returns displayName (fallback name).</summary>
    public async Task<string?> GetProjectNameAsync(D365BcSetting s, string token, string jobId, CancellationToken ct)
    {
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/v2.0"
                + $"/companies({s.CompanyId})/projects({jobId})";
        var body = await GetAsync(url, token, "ดึงชื่อ Project", ct);
        return ReadString(body, "displayName") ?? ReadString(body, "name");
    }

    /// <summary>
    /// Items — the standard items(v2.0) entity set. Pulls number / displayName / itemCategoryCode,
    /// following @odata.nextLink so the whole catalogue is returned even when paged.
    /// </summary>
    public async Task<List<D365Item>> GetItemsAsync(D365BcSetting s, string token, CancellationToken ct)
    {
        var items = new List<D365Item>();
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/v2.0"
                + $"/companies({s.CompanyId})/{ItemEntitySet}?$select=number,displayName,itemCategoryCode";

        while (!string.IsNullOrEmpty(url))
        {
            var body = await GetAsync(url, token, "ดึงรายการ Item", ct);
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("value", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in arr.EnumerateArray())
                {
                    var number = FirstString(el, "number", "no", "No");
                    if (string.IsNullOrWhiteSpace(number)) continue;
                    items.Add(new D365Item(
                        Number: number!,
                        DisplayName: FirstString(el, "displayName", "name", "description"),
                        ItemCategoryCode: FirstString(el, "itemCategoryCode", "itemCategoryId")));
                }
            }
            // Follow server-driven paging.
            url = root.TryGetProperty("@odata.nextLink", out var next) && next.ValueKind == JsonValueKind.String
                ? next.GetString() : null;
        }
        return items;
    }

    /// <summary>
    /// jobPlanningLines — from Microsoft's analytics API, filtered server-side by jobNo. lineType and
    /// amount are read tolerantly; the caller filters lineType = Billable and maps the item category.
    /// </summary>
    public async Task<List<D365JobPlanLine>> GetJobPlanningLinesAsync(D365BcSetting s, string token, string jobNo, CancellationToken ct)
    {
        var filter = $"jobNo eq '{jobNo.Replace("'", "''")}'";
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/{JobPlanningLinesApiPath}"
                + $"/companies({s.CompanyId})/{JobPlanningLinesEntitySet}?$filter={Uri.EscapeDataString(filter)}";

        var body = await GetAsync(url, token, "ดึง jobPlanningLines", ct);

        var lines = new List<D365JobPlanLine>();
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("value", out var arr) || arr.ValueKind != JsonValueKind.Array)
            return lines;

        foreach (var el in arr.EnumerateArray())
        {
            lines.Add(new D365JobPlanLine(
                No: FirstString(el, "no", "No", "number"),
                JobTaskNo: FirstString(el, "jobTaskNo", "jobTaskNumber", "taskNo"),
                LineType: FirstString(el, "lineType", "type"),
                LineAmountLcy: FirstDecimal(el, "lineAmountLCY", "lineAmountLcy", "lineAmount")));
        }
        return lines;
    }

    /// <summary>
    /// jobTasks — from Microsoft's analytics API, filtered by jobNo. Returns each task's
    /// jobTaskNo + description (in BC order).
    /// </summary>
    public async Task<List<D365JobTask>> GetJobTasksAsync(D365BcSetting s, string token, string jobNo, CancellationToken ct)
    {
        var filter = $"jobNo eq '{jobNo.Replace("'", "''")}'";
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/{JobPlanningLinesApiPath}"
                + $"/companies({s.CompanyId})/{JobTasksEntitySet}?$filter={Uri.EscapeDataString(filter)}";

        var body = await GetAsync(url, token, "ดึง jobTasks", ct);

        var tasks = new List<D365JobTask>();
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("value", out var arr) || arr.ValueKind != JsonValueKind.Array)
            return tasks;

        foreach (var el in arr.EnumerateArray())
        {
            var no = FirstString(el, "jobTaskNo", "taskNo", "number", "no");
            if (string.IsNullOrWhiteSpace(no)) continue;
            tasks.Add(new D365JobTask(no!, FirstString(el, "description", "taskDescription")));
        }
        return tasks;
    }

    /// <summary>
    /// Timesheets — custom QERP entitySetTimesheettoPowerBI, filtered by year + startDate range +
    /// resourceGroupNo contains 'CD'. Follows @odata.nextLink. Dates are Edm.Date (unquoted).
    /// </summary>
    public async Task<List<D365Timesheet>> GetTimesheetsAsync(D365BcSetting s, string token, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var filter = $"year eq {start.Year} and startDate ge {start:yyyy-MM-dd} and startDate le {end:yyyy-MM-dd}"
                   + $" and contains(resourceGroupNo,'{TimesheetResourceGroupFilter}')";
        var url = $"{BaseUrl}/v2.0/{s.TenantId}/{s.EnvironmentId}/api/{s.ApiPublisher}/{s.ApiGroup}/{s.ApiVersion}"
                + $"/companies({s.CompanyId})/{TimesheetEntitySet}?$filter={Uri.EscapeDataString(filter)}";

        var rows = new List<D365Timesheet>();
        string? next = url;
        while (!string.IsNullOrEmpty(next))
        {
            var body = await GetAsync(next, token, "ดึง Timesheet", ct);
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("value", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var el in arr.EnumerateArray())
                {
                    var sysId = FirstString(el, "systemId", "id", "SystemId");
                    if (string.IsNullOrWhiteSpace(sysId)) continue;
                    rows.Add(new D365Timesheet(
                        SystemId: sysId!,
                        JobNo: FirstString(el, "jobNo"),
                        JobTaskNo: FirstString(el, "jobTaskNo"),
                        StartDate: FirstDate(el, "startDate"),
                        No: FirstString(el, "no", "resourceNo"),
                        Quantity: FirstDecimalN(el, "quantity"),
                        QuantityMD: FirstDecimalN(el, "quantityMD"),
                        Comment: FirstString(el, "comment"),
                        ProjectManager: FirstString(el, "projectManager"),
                        TimesheetStatus: FirstString(el, "timesheetStatus", "status"),
                        RawJson: el.GetRawText()));
                }
            }
            next = root.TryGetProperty("@odata.nextLink", out var nl) && nl.ValueKind == JsonValueKind.String
                ? nl.GetString() : null;
        }
        return rows;
    }

    // ---------- helpers ----------
    private async Task<string> GetAsync(string url, string token, string what, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add("Authorization", $"Bearer {token}");

        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (Exception ex) { throw new D365BcException($"{what}ไม่สำเร็จ: {ex.Message}"); }

        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new D365BcException($"{what}ไม่สำเร็จ ({(int)res.StatusCode}): {Trim(body)}");
        return body;
    }

    // (qerpProjectManager eq 'Q63-036' or qerpProjectManager eq 'Q63-041')
    private static string BuildPmFilter(string codes)
    {
        var parts = codes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(c => $"qerpProjectManager eq '{c.Replace("'", "''")}'");
        var joined = string.Join(" or ", parts);
        return string.IsNullOrEmpty(joined) ? "qerpProjectManager ne ''" : joined;
    }

    private static string? ReadString(string json, string prop)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() : null;
        }
        catch { return null; }
    }

    private static string? FirstString(JsonElement el, params string[] props)
    {
        foreach (var p in props)
            if (el.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String)
                return v.GetString();
        return null;
    }

    // First numeric-or-numeric-string property among the candidates; 0 when none present.
    private static decimal FirstDecimal(JsonElement el, params string[] props)
        => FirstDecimalN(el, props) ?? 0m;

    // Nullable variant — null when no candidate property is present/parseable.
    private static decimal? FirstDecimalN(JsonElement el, params string[] props)
    {
        foreach (var p in props)
        {
            if (!el.TryGetProperty(p, out var v)) continue;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
            if (v.ValueKind == JsonValueKind.String
                && decimal.TryParse(v.GetString(), System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var ds)) return ds;
        }
        return null;
    }

    // First date-string property parsed as a DateOnly (handles "yyyy-MM-dd" and ISO datetimes).
    private static DateOnly? FirstDate(JsonElement el, params string[] props)
    {
        foreach (var p in props)
        {
            if (!el.TryGetProperty(p, out var v) || v.ValueKind != JsonValueKind.String) continue;
            var str = v.GetString();
            if (string.IsNullOrWhiteSpace(str)) continue;
            if (DateOnly.TryParse(str, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var d)) return d;
            if (DateTime.TryParse(str, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var dt)) return DateOnly.FromDateTime(dt);
        }
        return null;
    }

    private static string Trim(string body) => body.Length > 400 ? body[..400] : body;
}
