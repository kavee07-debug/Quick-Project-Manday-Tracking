# Deploy Guide — Quick Project Manday Tracking (On-Prem Windows + IIS)

โครงสร้างปลายทาง:
```
Browser (LAN) → IIS "QtmWeb" :80 (React static)
                   │  /api/* ──reverse proxy (ARR)──▶ IIS "QtmApi" :3007 (.NET 10)
                   └─ อื่นๆ ──fallback──▶ index.html
                                                       .NET ──TCP 1433──▶ SQL Server (อีกเครื่อง) DB: QtmManday
```
- **App server** (Windows + IIS): โฮสต์ทั้ง FE (:80) และ BE (:3007)
- **DB server** (อีกเครื่อง): SQL Server + ฐาน `QtmManday`
- เข้าใช้ผ่าน `http://<APPSERVER>/` ภายในองค์กร (ไม่ต้อง SSL)

ค่าที่ต้องเตรียม (เติมแทนที่ตลอดคู่มือ): `<APPSERVER>`, `<DBSERVER>`, SQL user/password, JWT key, admin password

---

## ขั้นที่ 1 — เตรียม App server (ติดตั้งครั้งเดียว)

รัน PowerShell **as Administrator**:

```powershell
# 1.1 เปิด IIS + ฟีเจอร์ที่ต้องใช้
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, `
  IIS-StaticContent, IIS-DefaultDocument, IIS-HttpErrors, IIS-RequestFiltering, `
  IIS-ManagementConsole -All
```

1.2 ติดตั้งโมดูลเพิ่ม (ดาวน์โหลดจาก microsoft.com — ติดตั้งบนเครื่อง server):
- **URL Rewrite 2.1** — https://www.iis.net/downloads/microsoft/url-rewrite
- **Application Request Routing (ARR) 3.0** — https://www.iis.net/downloads/microsoft/application-request-routing
- **.NET 10 Hosting Bundle** — https://dotnet.microsoft.com/download/dotnet/10.0 (มี ASP.NET Core Module + runtime)

```powershell
# 1.3 เปิด ARR proxy (จำเป็นต่อ reverse-proxy /api)
Import-Module WebAdministration
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "system.webServer/proxy" -Name "enabled" -Value "True"

# 1.4 เปิด firewall ขาเข้า port 80 (ผู้ใช้เข้าผ่านพอร์ตนี้; 3007 ปล่อยเป็น localhost ไม่ต้องเปิด)
New-NetFirewallRule -DisplayName "QtmWeb HTTP 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
```

---

## ขั้นที่ 2 — เตรียม DB server (ติดตั้งครั้งเดียว)

2.1 รัน schema ลงเครื่อง DB (สร้าง `QtmManday` + ตาราง + view + seed):
```powershell
sqlcmd -S <DBSERVER> -E -C -i db\schema.sql
# หรือถ้าใช้ SQL login: sqlcmd -S <DBSERVER> -U sa -P <pwd> -C -i db\schema.sql
```

2.2 สร้าง login สำหรับแอป + ให้สิทธิ์ (รันบน DB server):
```sql
USE QtmManday;
CREATE LOGIN qtmapp WITH PASSWORD = '<STRONG_PASSWORD>';
CREATE USER  qtmapp FOR LOGIN qtmapp;
ALTER ROLE db_datareader ADD MEMBER qtmapp;
ALTER ROLE db_datawriter ADD MEMBER qtmapp;
```

2.3 เปิดให้ต่อจากเครื่องอื่นได้:
- SQL Server Configuration Manager → **เปิด TCP/IP protocol** → restart SQL service
- เปิด firewall **port 1433** ให้ `<APPSERVER>` เข้าได้
- ตรวจว่า SQL รองรับ SQL Authentication (Mixed Mode) ถ้าใช้ `qtmapp`

---

## ขั้นที่ 3 — Build (ทำบนเครื่อง dev ที่มีโค้ด)

```powershell
# 3.1 Backend → โฟลเดอร์ publish-api
dotnet publish backend\Qtm.Api -c Release -o publish-api
# ⚠️ ถ้าเครื่อง server ยังไม่มี .NET 10 Hosting Bundle ให้ publish แบบ self-contained แทน:
# dotnet publish backend\Qtm.Api -c Release -r win-x64 --self-contained true -o publish-api

# 3.2 Frontend → โฟลเดอร์ dist (มี web.config ติดไปด้วย)
cd frontend
npm ci
npm run build
cd ..
```
> `dbsettings.json` (dev creds) ถูกตั้งให้ **ไม่ติดไป publish** แล้ว — ใน publish-api จะไม่มีไฟล์นี้ (ถูกต้อง)
> หมายเหตุ: web.config ฝั่ง FE ตั้ง proxy ไป `http://localhost:3007` อยู่แล้ว (FE/BE เครื่องเดียวกัน) — ไม่ต้องแก้

---

## ขั้นที่ 4 — Deploy ขึ้น App server

4.1 ก๊อปไฟล์ไปเครื่อง server:
- `publish-api\*` → `C:\inetpub\QtmApi\`
- `frontend\dist\*` → `C:\inetpub\QtmWeb\`

4.2 สร้าง `C:\inetpub\QtmApi\appsettings.Production.json` (ใส่ค่าจริง — ไฟล์นี้ gitignored จึงไม่มากับ repo):
```json
{
  "ConnectionStrings": {
    "Qtm": "Server=<DBSERVER>,1433;Database=QtmManday;User ID=qtmapp;Password=<STRONG_PASSWORD>;Encrypt=True;TrustServerCertificate=True;MultipleActiveResultSets=True"
  },
  "Jwt": { "Key": "<RANDOM_SECRET_AT_LEAST_32_CHARS>" },
  "Seed": { "AdminPassword": "<ADMIN_PASSWORD>" }
}
```

4.3 สร้าง IIS sites (PowerShell as Admin บน server):
```powershell
Import-Module WebAdministration

# ปิด Default Web Site ที่จองพอร์ต 80 อยู่ (ถ้ามี)
Stop-Website -Name "Default Web Site" -ErrorAction SilentlyContinue

# Backend :3007  (App Pool = No Managed Code)
New-WebAppPool -Name "QtmApi"
Set-ItemProperty IIS:\AppPools\QtmApi -Name managedRuntimeVersion -Value ""
New-Website -Name "QtmApi" -PhysicalPath "C:\inetpub\QtmApi" -Port 3007 -ApplicationPool "QtmApi"

# Frontend :80   (static + reverse proxy ผ่าน web.config)
New-WebAppPool -Name "QtmWeb"
Set-ItemProperty IIS:\AppPools\QtmWeb -Name managedRuntimeVersion -Value ""
New-Website -Name "QtmWeb" -PhysicalPath "C:\inetpub\QtmWeb" -Port 80 -ApplicationPool "QtmWeb"
```

> `web.config` ของ backend ถูกสร้างโดย `dotnet publish` อัตโนมัติ (ตั้ง ASP.NET Core Module + `ASPNETCORE_ENVIRONMENT=Production`) → โหลด `appsettings.Production.json` ให้เอง ไม่ต้องตั้ง env เพิ่ม

---

## ขั้นที่ 5 — ตรวจสอบ (บน App server / เครื่องใน LAN)

| # | ทดสอบ | คาดหวัง |
|---|-------|---------|
| 1 | `sqlcmd -S <DBSERVER>,1433 -U qtmapp -P <pwd> -d QtmManday -Q "SELECT TOP 1 * FROM vTaskMandaySummary"` (จาก app server) | มีผลลัพธ์ = app server ต่อ DB ได้ |
| 2 | เปิด `http://localhost:3007/health` บน app server | `{"status":"ok"}` |
| 3 | เปิด `http://localhost:3007/swagger` | เห็น Swagger UI |
| 4 | จากเครื่องอื่นใน LAN เปิด `http://<APPSERVER>/` | เห็นหน้า login |
| 5 | login `Admin1@qtmtraining.com` / `<ADMIN_PASSWORD>` | เข้าได้ = FE→proxy→BE→DB ครบสาย |
| 6 | เข้า `http://<APPSERVER>/projects` แล้วกด refresh | ไม่ 404 (SPA fallback ทำงาน) |
| 7 | เปิดโปรเจกต์ → แท็บ Estimate & Actual → โหลดข้อมูล + Export Excel | ใช้งานได้ |

---

## อัปเดตเวอร์ชันใหม่ภายหลัง
1. บน dev: `dotnet publish ...` + `npm run build` ใหม่
2. ก๊อปทับ `C:\inetpub\QtmApi\` และ `C:\inetpub\QtmWeb\` (อย่าทับ `appsettings.Production.json`)
3. `iisreset` หรือ recycle app pool: `Restart-WebAppPool QtmApi`
4. ถ้า schema เปลี่ยน (เพิ่มคอลัมน์ ฯลฯ) ต้องรัน ALTER/`schema.sql` ส่วนที่เกี่ยวบน DB server ด้วย

## Troubleshooting
- **502.3 / 500.30** = backend start ไม่ขึ้น → ดู log `C:\inetpub\QtmApi\logs\` หรือเปิด stdout log ใน web.config; เช็ก connection string / .NET runtime
- **/api ตอบ 404 จาก IIS** = ARR proxy ยังไม่เปิด (ขั้น 1.3) หรือไม่ได้ติด URL Rewrite/ARR
- **login ไม่ได้ / 500** = ต่อ DB ไม่ได้ → เช็ก firewall 1433, TCP/IP, SQL login, ค่าใน appsettings.Production.json
- **หน้าเว็บขึ้นแต่เรียก API ไม่ได้** = web.config proxy target ไม่ตรง (ถ้า BE อยู่คนละเครื่องต้องแก้ `localhost:3007` เป็น host จริง)
