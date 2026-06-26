# CLAUDE.md

This file guides Claude Code (and developers) when working in this repository.

## Project Overview

**Quick Project Manday Tracking** — a Web Application for defining Projects, assigning a **Manday quota** (estimate/budget), and tracking **Actual Manday** usage, so that work can be controlled and tracked: how many mandays were planned vs. how many have been used.

Core data hierarchy:

```
Project → Task → Estimate & Actual
```

### Screens / Navigation

- **Project list** — top-level list of projects.
- **Project Detail** — contains two tabs:
  - **Task** tab — manage tasks under the project.
  - **Estimate & Actual** tab — manage manday entries (Budget, Actual, Adjust) per task/resource.
- **Config** page — because the database is SQL, the Web Application includes a configuration page for DB/connection settings.

## Manday Data Model

Each task accumulates manday rows. Row types:

| Type   | Meaning                                  |
|--------|------------------------------------------|
| Budget | Planned/estimated manday quota           |
| Actual | Manday actually used                     |
| Adjust | Manual adjustment to mandays             |

Example (Project `SOJ0001`, Task `Planning`):

| Project | Task     | Type   | Resource | Manday |
|---------|----------|--------|----------|--------|
| SOJ0001 | Planning | Budget | Kavee    | 1.0    |
|         |          | Budget | Bhavit   | 1.5    |
|         |          | Actual | Kavee    | 2.0    |
|         |          | Adjust | Adjust   | 1.0    |

Tracking logic per task/project: **Adjust** adds to the quota, so
**Remaining = (Sum Budget + Sum Adjust) − Sum Actual**. The project list shows Sum Budget,
Sum Adjust, Sum Actual and Remaining per project.

## Technology Stack

- **Frontend:** React + TypeScript
- **Backend:** C# / .NET Core 10 — REST API under `/api/v1`
- **Database:** SQL Server
- **Auth:** JWT with Role-Based Access Control (RBAC)
- **Styling:** SCSS + Design Tokens
- **Font:** Sarabun (Thai support)

## Import / Export (Excel)

The Web Application must support **Excel Import/Export** for:

- **Project** data
- **Task** data
- **Estimate & Actual** (manday) data

Use the `.xlsx` format so users can bulk-load and extract Project/Task/Manday records. Exported columns should mirror the manday data model (Project, Task, Type, Resource, Manday).

## API Feature — D365BC Integration

The system must provide functions to **GET data from D365 Business Central via API**.
For now, build a **mockup** of this integration first; the real integration will be implemented later.

## Development Ports

- **Frontend:** `4207`
- **Backend:** `3007`

## Conventions

- All REST endpoints are versioned under `/api/v1`.
- Use Design Tokens for styling values (colors, spacing, typography) rather than hard-coded SCSS values.
- Thai text must render with the **Sarabun** font.
- Protect endpoints with JWT; enforce access by role (RBAC).
- DB connection / settings are configurable through the in-app **Config** page.

## Notes for Claude

- This project is in early/setup stage. The D365BC API should be stubbed/mocked until further notice.
- Keep frontend (React/TS) and backend (.NET) concerns separated.
- Source of truth for requirements: `Quick Project Manday Tacking SOW.docx`.
