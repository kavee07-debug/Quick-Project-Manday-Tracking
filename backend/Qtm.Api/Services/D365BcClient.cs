using System.Text.Json;
using Qtm.Api.Data.Entities;

namespace Qtm.Api.Services;

/// <summary>A job record pulled from the D365BC qerpentitySetJob entity set.</summary>
public record D365Job(string No, string? Id, string? ProjectManager,
    string? CustomerNo, string? CustomerName, string RawJson);

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
    public async Task<List<D365Job>> GetJobsAsync(D365BcSetting s, string token, string maxCode, CancellationToken ct)
    {
        var pmFilter = BuildPmFilter(s.ProjectManagerCodes);
        var filter = $"({pmFilter}) and startswith(no,'SOJ') and no gt '{maxCode}'";
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

    private static string Trim(string body) => body.Length > 400 ? body[..400] : body;
}
