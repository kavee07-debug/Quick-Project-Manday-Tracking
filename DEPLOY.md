# Deploy Guide — Quick Project Manday Tracking (On-Prem Windows + IIS)

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
sqlcmd -S <DBSERVER> -E -C -i db\schema.sql   # สร้าง QtmManday + ตาราง + view + seed
```
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
