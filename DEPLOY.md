# Deploy Guide — Quick Project Manday Tracking

มี 2 เส้นทาง deploy ที่รองรับพร้อมกัน จากโค้ดชุดเดียวกัน:

| เส้นทาง | หน้าตา | ใช้เมื่อ |
|---|---|---|
| **On-Prem Windows + IIS** (ด้านล่าง) | single-origin — backend เสิร์ฟทั้ง SPA และ API | ระบบที่ใช้อยู่ปัจจุบัน |
| **[Azure](#deploy-ขึ้น-azure-static-web-apps--app-service--azure-sql)** | SPA อยู่ Static Web Apps, API อยู่ App Service, คนละ origin + CORS | เส้นทางใหม่ |

ทุกค่าที่เพิ่มเข้ามาเพื่อ Azure เป็น **opt-in** — ถ้าไม่ตั้ง พฤติกรรมจะเหมือน on-prem เดิมทุกอย่าง

---

## On-Prem Windows + IIS

**สถาปัตยกรรม: เว็บเดียว (single-origin)** — backend .NET เสิร์ฟทั้ง React SPA (`wwwroot`) และ API บนพอร์ตเดียว **ไม่ใช้ URL Rewrite / ARR / reverse-proxy / CORS**

```
Browser (LAN) → IIS "QtmApi" :80  (Kestrel ผ่าน ASP.NET Core Module)
                   /api/*          → controllers
                   อื่นๆ           → wwwroot (static) + fallback index.html (SPA routing)
                .NET ──TCP 1433──▶ SQL Server (เครื่องเดียวหรือแยก) DB: QtmManday
```
> โค้ดที่ทำให้เป็น single-origin: [Program.cs](backend/Qtm.Api/Program.cs) ใช้ `UseStaticFiles()` + `MapFallbackToFile("index.html")`
> `client.ts` ใช้ `/api/v1` แบบ relative → same-origin ทั้ง dev (Vite proxy) และ prod

ค่าที่ต้องเตรียม: `<APPSERVER>`, `<DBSERVER>`, SQL user/password, JWT key, admin password

---

## ขั้นที่ 1 — เตรียม App server (ครั้งเดียว)
```powershell
# เปิด IIS + management console
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, `
  IIS-StaticContent, IIS-DefaultDocument, IIS-ManagementConsole -All
```
- ติดตั้ง **.NET 10 Hosting Bundle** — ⚠️ **ไม่ใช่แค่ Runtime/SDK** (ดู Gotcha #1) โหลดจาก https://dotnet.microsoft.com/download/dotnet/10.0 → ASP.NET Core Runtime → **Hosting Bundle**
  - ตรวจ: `Test-Path "$env:windir\System32\inetsrv\aspnetcorev2.dll"` ต้องได้ **True**
- เปิด firewall ขาเข้า TCP 80

> ไม่ต้องติดตั้ง URL Rewrite / ARR อีกแล้ว (single-origin ไม่ใช้)

## ขั้นที่ 2 — เตรียม DB server (ครั้งเดียว)
```powershell
sqlcmd -S <DBSERVER> -E -C -Q "IF DB_ID(N'QtmManday') IS NULL CREATE DATABASE QtmManday;"
sqlcmd -S <DBSERVER> -E -C -d QtmManday -i db\schema.sql   # ตาราง + view + seed
```
> สคริปต์ทุกไฟล์ใน `db\` **ไม่มี `USE` แล้ว** (Azure SQL ไม่รองรับ) จึง**ต้องใส่ `-d QtmManday` ทุกครั้ง** —
> ถ้าลืม สคริปต์จะหยุดพร้อม error แทนที่จะไปสร้างตารางใน `master`
> ⚠️ `schema.sql` **ลบตารางทั้งหมดแล้วใส่ข้อมูลตัวอย่าง** — ใช้เฉพาะตอนติดตั้งใหม่ ห้ามรันทับ DB ที่มีข้อมูลจริง
```sql
USE QtmManday;
CREATE LOGIN qtmapp WITH PASSWORD = '<STRONG_PASSWORD>';
CREATE USER  qtmapp FOR LOGIN qtmapp;
ALTER ROLE db_datareader ADD MEMBER qtmapp;
ALTER ROLE db_datawriter ADD MEMBER qtmapp;
```
ถ้า DB อยู่คนละเครื่อง: เปิด TCP/IP + firewall 1433 + Mixed Mode auth

## ขั้นที่ 3 — Build (บนเครื่อง dev)
```powershell
cd frontend; npm ci; npm run build; cd ..
dotnet publish backend\Qtm.Api -c Release -o publish-web
# วาง SPA ลง wwwroot แล้วตัด web.config ที่ติดมากับ dist (ไม่ใช้)
New-Item -ItemType Directory -Force publish-web\wwwroot | Out-Null
Copy-Item frontend\dist\* publish-web\wwwroot\ -Recurse -Force
Remove-Item publish-web\wwwroot\web.config -ErrorAction SilentlyContinue
```
> framework-dependent (server ต้องมี Hosting Bundle) ถ้าจะ self-contained: เพิ่ม `-r win-x64 --self-contained true`

## ขั้นที่ 4 — Deploy ขึ้น App server
1. ก๊อป `publish-web\*` → `C:\inetpub\QtmApi\`
2. สร้าง `C:\inetpub\QtmApi\appsettings.Production.json` (ค่าจริง — gitignored ไม่มากับ artifact):
   ```json
   {
     "ConnectionStrings": { "Qtm": "Server=<DBSERVER>,1433;Database=QtmManday;User ID=qtmapp;Password=<PWD>;Encrypt=True;TrustServerCertificate=True;MultipleActiveResultSets=True" },
     "Jwt": { "Key": "<RANDOM_SECRET_>=32_CHARS>" },
     "Seed": { "AdminPassword": "<ADMIN_PASSWORD>" }
   }
   ```
3. สร้าง IIS site เดียว + **หยุดทุก site อื่นที่จองพอร์ต 80** (สำคัญ — ดู Gotcha #2):
   ```powershell
   Import-Module WebAdministration
   # ปล่อยพอร์ต 80: หยุด Default Web Site (และ site อื่นๆ บน :80) + ห้าม autostart
   Stop-Website "Default Web Site" -ErrorAction SilentlyContinue
   Set-ItemProperty 'IIS:\Sites\Default Web Site' -Name serverAutoStart -Value $false

   New-WebAppPool -Name QtmApi
   Set-ItemProperty IIS:\AppPools\QtmApi -Name managedRuntimeVersion -Value ''   # No Managed Code
   New-Website -Name QtmApi -PhysicalPath C:\inetpub\QtmApi -Port 80 -ApplicationPool QtmApi
   ```

## ขั้นที่ 5 — ตรวจสอบ
| ทดสอบ | คาดหวัง |
|------|---------|
| `http://localhost/health` | `{"status":"ok"}` |
| `http://<APPSERVER>/` | หน้า login |
| `http://<APPSERVER>/projects` แล้ว refresh | ไม่ 404 (SPA fallback) |
| login `Admin1@qtmtraining.com` / `<ADMIN_PASSWORD>` | เข้าได้ = FE+API+DB ครบสาย |

## อัปเดตเวอร์ชันใหม่
```powershell
# บน dev: npm run build + dotnet publish + copy dist->wwwroot (ขั้น 3) ใหม่
# บน server: ก๊อป publish-web\* ทับ C:\inetpub\QtmApi (อย่าทับ appsettings.Production.json)
Restart-WebAppPool QtmApi
```

---

## Microsoft (Entra ID) login + roles

ระบบล็อกอินได้ 2 ทาง: **Microsoft (Entra ID)** สำหรับผู้ใช้ทั่วไป + **password** สำหรับ admin เดิม (break-glass). Roles = **Admin / ProjectManager / User** (User = read-only). ผู้ใช้ต้องถูก admin เพิ่มในหน้า "จัดการผู้ใช้" ก่อน (หรืออยู่ใน `Auth:AdminEmails`) ถึงล็อกอินได้ — MS account อื่นถูกปฏิเสธ (403).

**ก. Entra app registration**
- App registration (single-tenant) → คัดลอก **Application (client) ID** + **Directory (tenant) ID**
- **Authentication → Single-page application → Redirect URI** = URL จริงที่ผู้ใช้เปิด **ต้องเป็น `https://`** (Entra บังคับ https สำหรับ host ที่ไม่ใช่ localhost)
  - ผ่าน **Cloudflare** ที่มี https อยู่แล้ว → ใส่ `https://<โดเมน-Cloudflare>` (โค้ดใช้ `redirectUri = window.location.origin` จึงตรงกับโดเมนที่เปิดอัตโนมัติ)
  - ⚠️ ผู้ใช้ต้องเข้าผ่านโดเมน https เท่านั้น — ถ้าเข้าตรง `http://<ip>` redirectUri จะเป็น http แล้ว MS login พัง

**ข. ใส่ค่า config**
- Backend [appsettings.json](backend/Qtm.Api/appsettings.json) → `AzureAd: { Instance, TenantId, ClientId }` (ไม่ใช่ secret, ติดไปกับ artifact ได้) + `Auth:AdminEmails` (bootstrap admin คนแรก)
- Frontend → `frontend/.env` (gitignored): `VITE_AAD_CLIENT_ID`, `VITE_AAD_TENANT_ID` — **ถูก bake ตอน `npm run build`** ดังนั้นเครื่องที่ build artifact ต้องมี `.env` ค่าถูก ไม่งั้นได้ค่า placeholder

**ค. Migrate roles บน DB prod** (ถ้า DB มีอยู่แล้วจาก schema เก่า 4 roles)
```sql
UPDATE dbo.[Role] SET Name=N'User', Description=N'Read-only' WHERE Name=N'Viewer';
-- ย้าย user ของ Member ไป User แล้วลบ role Member (ดูสคริปต์เต็มที่ทำกับ dev)
```
DB ติดตั้งใหม่ใช้ `db/schema.sql` ล่าสุด (3 roles) ได้เลย

**จ. Migrate Customer + Progress บน DB prod** (ถ้า DB มีอยู่แล้วก่อนมีฟีเจอร์ลูกค้า/Progress)
```powershell
sqlcmd -S <DBSERVER> -U <user> -P <pwd> -C -d QtmManday -i db\migration-2026-07-customer-progress.sql
```
สคริปต์นี้ idempotent (รันซ้ำได้) — เพิ่มตาราง `Customer` + คอลัมน์ `Project.CustomerId` และ `Project.Progress` (DB ติดตั้งใหม่จาก `schema.sql` มีให้ครบแล้ว ไม่ต้องรัน)

**ง. Cloudflare ↔ origin (IIS)**
- อย่าให้ IIS บังคับ redirect http→https ถ้า Cloudflare เป็นโหมด **Flexible** (จะ loop) · แนะนำ **Full** หรือ **Cloudflare Tunnel**
- ไม่ต้องตั้ง CORS (single-origin) · ใช้ localStorage ไม่ใช่ cookie (ไม่มีปัญหา SameSite)

---

## Troubleshooting — gotcha จริงจาก deploy ครั้งแรก (ต้นเหตุที่กินเวลาหลายชม.)

**Gotcha #1 — 500 ทุก endpoint รวม `/health`, ไม่มี stdout log, แต่ `dotnet Qtm.Api.dll` รันจาก console ได้**
เครื่อง server มี .NET **Runtime** แต่**ไม่มี Hosting Bundle** → IIS ไม่มี ASP.NET Core Module V2 (`aspnetcorev2.dll` หาย, มีแต่ V1 เก่า) → IIS โหลดแอปไม่ได้ทุก request (console รันได้เพราะใช้ runtime ตรง ไม่ผ่าน IIS module — นี่คือ tell)
**แก้:** ติดตั้ง **.NET 10 Hosting Bundle** แล้ว `net stop was /y; net start w3svc` · ตรวจ `aspnetcorev2.dll` ใน `System32\inetsrv`

**Gotcha #2 — site สตาร์ทไม่ขึ้น / `/`=200 แต่ `/projects` & `/api`=404 / QtmApi เป็น Stopped**
มี site อื่นแย่งพอร์ต 80 อยู่ — ส่วนใหญ่คือ **Default Web Site** ซึ่ง `iisreset` จะปลุกกลับมาทุกครั้ง → binding :80 ชน → QtmApi สตาร์ทไม่ขึ้นทั้ง site (`/` ที่ตอบ 200 คือ Default Web Site ไม่ใช่แอปเรา)
**แก้:** `Stop-Website "Default Web Site"` **และ** `Set-ItemProperty 'IIS:\Sites\Default Web Site' -Name serverAutoStart -Value $false` (กัน iisreset ปลุก) · เช็กด้วย `Get-Website | ft name,state,bindings`

**อื่นๆ:** 502.3/500.30 = backend start ไม่ขึ้น (เช็ก connection string / DB ต่อได้ไหม) · App Pool ต้องเป็น **No Managed Code**

> หมายเหตุ: `setup-iis.ps1` ในโปรเจกต์เขียนไว้สำหรับแนวทางเก่า (2 site + reverse-proxy) ซึ่ง**เลิกใช้แล้ว** — ใช้ขั้นตอน manual ด้านบนแทน

---

# Deploy ขึ้น Azure (Static Web Apps + App Service + Azure SQL)

```
Browser ──► https://<web>.azurestaticapps.net     Static Web Apps (Free) — SPA เท่านั้น
              │  fetch ข้าม origin + CORS
              ▼
            https://<api>.azurewebsites.net       App Service (Linux B1) — API
              │  TCP 1433 / Encrypt=True
              ▼
            <sql>.database.windows.net            Azure SQL — DB: QtmManday
```

> **ทำไมถึงแยก 2 origin:** SWA **Free ไม่รองรับ linked backend** (เชื่อม App Service มาเป็น `/api/*`) — เป็นฟีเจอร์ของ Standard เท่านั้น

## 1. สร้าง resource (region: Southeast Asia)

| Resource | ค่า |
|---|---|
| Resource group | `rg-qtm-prod` |
| SQL logical server | ตั้ง Entra admin + SQL admin login |
| Database | `QtmManday` — **Basic** · **collation ต้องตรงกับ on-prem** (เช็ค: `SELECT DATABASEPROPERTYEX('QtmManday','Collation')`) |
| App Service Plan | Linux **B1** |
| Web App (API) | .NET 10 · **Always On = เปิด** |
| Static Web App | **Free** · ผูก GitHub repo |

SQL firewall: เปิด **Allow Azure services** + เพิ่ม IP ออฟฟิศไว้รัน sqlcmd

## 2. ย้ายข้อมูลขึ้น Azure SQL

1. SSMS → คลิกขวา `QtmManday` → **Tasks → Export Data-tier Application** → ได้ `.bacpac`
2. Azure Portal → SQL server → **Import database** → เลือก bacpac → tier Basic
3. เทียบจำนวนแถวสองฝั่งให้ตรงกัน:
   ```sql
   SELECT t.name, SUM(p.rows) AS Rows FROM sys.tables t
   JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
   GROUP BY t.name ORDER BY t.name;
   ```
4. สร้าง user ของแอป — Azure SQL ใช้ `CREATE LOGIN` ไม่ได้ ต้องเป็น **contained user**:
   ```sql
   CREATE USER qtmapp WITH PASSWORD = '<pwd>';
   ALTER ROLE db_datareader ADD MEMBER qtmapp;
   ALTER ROLE db_datawriter ADD MEMBER qtmapp;
   ALTER ROLE db_ddladmin  ADD MEMBER qtmapp;   -- ถ้าจะรัน migration ด้วย user นี้
   ```

migration รอบถัดๆ ไปรันเหมือนเดิม แค่เปลี่ยน server:
```powershell
sqlcmd -S <sql>.database.windows.net -d QtmManday -U qtmapp -P <pwd> -C -i db\migrate-YYYY-MM-DD-HHmm.sql
```

## 3. Application settings ของ Web App

แทน `appsettings.Production.json` ทั้งไฟล์ (ไฟล์นั้นไม่ต้อง deploy ขึ้น Azure เลย):

```
ConnectionStrings__Qtm     = Server=tcp:<sql>.database.windows.net,1433;Initial Catalog=QtmManday;
                             User ID=qtmapp;Password=<pwd>;Encrypt=True;TrustServerCertificate=False;
                             MultipleActiveResultSets=True;Connect Timeout=30
Db__AllowRuntimeOverride   = false
Db__ConnectTimeoutSeconds  = 30
Jwt__Key                   = <สุ่ม ≥32 ตัวอักษร>
Seed__AdminPassword        = <รหัสผ่านที่แข็งแรง>
Cors__AllowedOrigins__0    = https://<web>.azurestaticapps.net
ASPNETCORE_ENVIRONMENT     = Production
```

- `Db__AllowRuntimeOverride=false` ทำให้หน้า **Config** เป็นแบบดูอย่างเดียว (ยังกด "ทดสอบการเชื่อมต่อ" ได้) เพราะบน App Service
  การเขียน `dbsettings.json` ใช้ไม่ได้จริง — read-only ถ้าเปิด run-from-package, ถูกทับทุกครั้งที่ deploy, และไม่ share ข้าม instance
- แอปจะ **ไม่ยอมสตาร์ท** ถ้า `Jwt__Key` หรือ `Seed__AdminPassword` ยังเป็นค่า default ของ dev

## 4. Entra ID

โค้ดใช้ `redirectUri = window.location.origin` จึงปรับตามโดเมนเอง — แค่ไปเพิ่มใน App registration →
**Authentication → Single-page application → Redirect URIs**: `https://<web>.azurestaticapps.net`
(**เก็บ URI ของ on-prem ไว้ด้วย** เพราะยังใช้งานคู่กัน)

## 5. CI/CD

| Workflow | ทำอะไร |
|---|---|
| [.github/workflows/azure-web.yml](.github/workflows/azure-web.yml) | build `frontend/` → Static Web Apps |
| [.github/workflows/azure-api.yml](.github/workflows/azure-api.yml) | `dotnet publish` → App Service + เช็ค `/health` |

**ต้องตั้งค่าใน GitHub ก่อน** (Settings → Secrets and variables → Actions):

| ชนิด | ชื่อ |
|---|---|
| Variables | `AZURE_DEPLOY_ENABLED` = `true` (until set, both workflows are skipped on push), `VITE_API_BASE_URL`, `VITE_AAD_CLIENT_ID`, `VITE_AAD_TENANT_ID`, `AZURE_API_APP_NAME` |
| Secrets | `AZURE_STATIC_WEB_APPS_API_TOKEN`, `AZURE_API_PUBLISH_PROFILE` |

> ⚠️ **จุดที่พลาดง่ายที่สุด:** `frontend/.env` ถูก gitignore ไว้ ค่า `VITE_AAD_*` จึงไม่ได้อยู่ใน repo
> และ Vite **bake ค่าเหล่านี้ตอน build** ถ้า workflow ไม่ตั้งให้ จะได้ค่า placeholder → **ปุ่ม Microsoft login พังโดยไม่มี error ตอน build**
> workflow จึงมี step ที่ fail ทันทีถ้าตัวแปรไม่ครบ

## 6. ตรวจสอบหลัง deploy

| ทดสอบ | คาดหวัง |
|---|---|
| `https://<api>.azurewebsites.net/health` | `{"status":"ok"}` (API ต่อ Azure SQL ได้) |
| `https://<api>.azurewebsites.net/swagger` | **404** (ปิดใน Production แล้ว) |
| เปิด SWA → login ด้วย **password** | เข้าได้ = CORS + base URL ถูก |
| login ด้วย **Microsoft** | redirect กลับมาแล้วเข้าได้ |
| เปิด `/revenue-monthly/<id>` ตรงๆ แล้ว refresh | ไม่ 404 (`staticwebapp.config.json`) |
| Import + Export Excel อย่างละ 1 ไฟล์ | ไฟล์เปิดได้ |
| ยอด Revenue Monthly งวดที่ปิดแล้ว | ตรงกับ on-prem เป๊ะ |
| login เป็น role `User` แล้วยิง `POST /api/v1/revenue-monthly` | 403 |

## ค่าใช้จ่ายโดยประมาณ

Static Web Apps Free $0 + App Service B1 ~$13 + Azure SQL Basic ~$5 ≈ **$18/เดือน** — ควรตั้ง Budget alert ที่ ~$30

## ข้อจำกัดที่ต้องรู้

- SWA Free: **ไม่มี SLA**, custom domain 2 โดเมน, staging 3 environment
- App Service ตัด request ที่ **230 วินาที** — endpoint ดึง D365 (`/d365/staging/fetch`, `/d365/items/fetch`) ที่วนดึงหลายหน้าอาจโดนตัดถ้าข้อมูลเยอะ
- Azure SQL **Basic จำกัด 2 GB / 5 DTU** — ถ้าไม่พอ อัปเป็น S0 ได้จาก portal โดยไม่ต้องย้ายข้อมูล
- `dbo.D365BcSetting.ClientSecret` เก็บเป็น plaintext ใน DB — เดิมอยู่ใน LAN ตอนนี้อยู่บน cloud ควรวางแผนย้ายไป Key Vault
