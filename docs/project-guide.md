# DPDP RAF Project Guide

This is a private npm-workspaces monorepo with a React single-page client and an Express JSON API backed by SQL Server. This document records the current repository shape and configuration. Package names are listed without versions; the workspace `package.json` files and root lockfile are the dependency source of truth.

## Runtime and Entry Points

- The client is a Vite-built React SPA under `apps/client`.
- The API is an Express application under `apps/server`; it initializes the SQL Server schema before listening when started as the process entry point.
- The Vite development server proxies `/api` calls to the configured API target.
- The API binds to loopback by default. Production should use HTTPS directly or a trusted TLS-terminating proxy.
- The root workspace targets Node.js 22.22 or later and npm 11 or later.

## Repository Structure

```text
.
|-- apps/
|   |-- client/
|   |   |-- package.json
|   |   |-- vite.config.js
|   |   |-- .env.example
|   |   `-- src/
|   |       |-- App.jsx                 Route tree and session query
|   |       |-- main.jsx                React entry point
|   |       |-- styles.css              Global and page styles
|   |       |-- components/
|   |       |   `-- DashboardLayout.jsx Shared navigation and signed-in shell
|   |       `-- routes/
|   |           |-- LoginPage.jsx       Employee sign-in
|   |           |-- ProfilePage.jsx     First-time registration
|   |           |-- ProfileSettingsPage.jsx Profile editing
|   |           |-- WelcomePage.jsx     User dashboard
|   |           `-- AdminPage.jsx       Admin search and role management
|   |-- server/
|   |   |-- package.json
|   |   |-- .env.example
|   |   |-- src/
|   |   |   |-- server.js              Express API, validation, sessions
|   |   |   |-- db/
|   |   |   |   |-- pool.js             SQL Server pool
|   |   |   |   `-- initializeDatabase.js Startup schema initialization
|   |   |   `-- repositories/
|   |   |       `-- profileRepository.js Parameterized profile and consent writes
|   |   `-- test/
|   |       `-- server.test.js          Node test runner and Supertest
|-- docs/
|   |-- implementation-roadmap.md       Delivery checklist
|   |-- database-bootstrap.sql          Target SQL Server bootstrap
|   `-- project-guide.md                This project inventory
|-- scripts/
|   `-- dev.mjs                         Starts client and watched API processes
|-- .github/workflows/ci.yml             CI verification steps
|-- eslint.config.js                     ESLint configuration
|-- oxlint.config.json                  Oxlint configuration
|-- package.json                        Root workspace and commands
`-- README.md                            Setup and application behavior
```

Some server directories (`config`, `routes`, `services`, `utils`) currently exist but are empty; the current API is implemented in `server.js` and the data-access layer in `repositories/profileRepository.js`. Move code into those areas only when it improves a concrete ownership boundary.

## Application Flow

1. The client checks `GET /api/me` using the HttpOnly session cookie.
2. The sign-in form posts E-code and password to `POST /api/login`.
3. The API sends credentials to the server-configured HTTPS authentication service. A successful 2xx response authenticates the user; if the response includes an E-code, it must match the submitted E-code. The API does not accept an authentication URL from the browser.
4. An existing profile receives an application session with no role claims; active roles are loaded from SQL Server. A first-time user receives a short-lived setup session and goes to `/profile/setup`.
5. The profile form posts JSON to `POST /api/profile`; the API takes E-code from the signed setup cookie. Users record already-approved permissions and evidence separately in `/approvals`, after confirming the risk acknowledgement. The API stores its UTC acceptance timestamp; acknowledgement does not grant access.
6. `GET /api/me` returns the current profile and active roles; `POST /api/logout` clears session cookies.
7. Admins use `/admin` for paginated client/WBS permission search, the current administrator list, and private evidence viewing. Admin managers can provision employee profiles individually or from a bounded `.xlsx` workbook, and assign or revoke the `ADMIN` role with a reason. Every admin API checks active roles in the database; navbar visibility is not authorization.

Application routes are `/`, `/profile/setup`, `/dashboard`, `/profile`, `/approvals`, and `/admin`. The client uses React Router for navigation and React Query for server state.

The registration form, API, repository, and startup schema do not require or read `location`. Existing databases may still have a legacy `location` column and values; the application does not drop or alter that data. Physical column removal requires a separately reviewed migration.

## Database Model

- `dbo.user_profiles`: one profile per E-code, with a unique office email.
- `dbo.project_contexts`: reusable WBS/client/LOB combinations.
- `dbo.user_permissions`: E-code-to-context permission mapping, represented by a permission type and latest `GRANTED`/`REVOKED` state, with a risk-acceptance timestamp for new records.
- `dbo.permission_proofs`: generated-file reference and content type linked to a permission. New uploads store a generic label instead of the user-supplied filename; existing filename values remain unchanged pending retention review.
- `dbo.user_roles`: active `ADMIN` and `ADMIN_MANAGER` assignments, with assigner and revocation metadata.
- `dbo.user_role_audit`: role assignment/revocation history with actor and reason.
- `dbo.evidence_access_audit`: administrator identity and timestamp for evidence-view attempts after authorization.
- `dbo.application_audit_events`: authentication, logout, profile, and admin bulk-provisioning events with actor/subject identifiers, outcome, request ID, and limited non-sensitive details.

Current repository writes use parameterized SQL and a transaction. The permission row represents the latest state; it is not a full append-only history of all grants and revocations. The roadmap tracks the decision and work required for the RoPA audit model. The startup schema is in `apps/server/src/db/initializeDatabase.js`; the target bootstrap script is `docs/database-bootstrap.sql`.

## Packages

### Client packages in use

- `react`, `react-dom`: SPA and browser rendering.
- `react-router`: client routes and navigation.
- `@tanstack/react-query`: session/profile server state.
- `react-hook-form`, `@hookform/resolvers`, `zod`: forms and client-side validation.
- `lucide-react`: interface icons.
- `vite`, `@vitejs/plugin-react`: development server and production client build.
- `@tailwindcss/vite`, `tailwindcss`: configured styling integration; the current page styles are primarily in `src/styles.css`.

### Server packages in use

- `express`: JSON API.
- `mssql`: SQL Server connection and parameterized queries.
- `zod`: server-side request validation.
- `jsonwebtoken`: signed setup and application sessions.
- `cookie-parser`: session cookie parsing.
- `cors`, `helmet`, `express-rate-limit`: request security and API controls.
- `multer`: multipart evidence upload.
- `dotenv`: local environment loading.
- Node built-ins provide file handling, UUID generation, HTTPS fetch, and test execution.
- `supertest`: API tests; the test runner itself is Node's built-in `node:test`.

### Declared packages not currently imported by application code

- Client: `ag-grid-community`, `ag-grid-react`, `@babel/core`, `@rolldown/plugin-babel`, `babel-plugin-react-compiler`, `@types/react`, and `@types/react-dom`.
- Server: `pdfkit`, `read-excel-file`, and `write-excel-file`.
- Test tooling: `jest` is declared, but the configured server test command uses `node --test`.

Review these packages before adding new features or removing dependencies; do not assume a declaration means the package is configured or used.

## Commands

Run commands from the repository root unless noted.

| Command | Purpose |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Run Vite and the API in watch mode via `scripts/dev.mjs` |
| `npm run dev:client` | Run only the Vite client |
| `npm run dev --workspace @dpdp-raf/client` | Run the client workspace dev script |
| `npm run dev --workspace @dpdp-raf/server` | Run the API with Node watch mode |
| `npm run dev:server` | Run the API workspace in watch mode |
| `npm run build` | Run available workspace builds; currently the client uses Vite |
| `npm test` | Run available workspace tests; server uses `node --test` |
| `npm run lint` | Run ESLint across the repository |
| `npm run lint:fast` | Run Oxlint |

The workspace scripts live in the root and app-level `package.json` files. `scripts/dev.mjs` starts Vite with `apps/client` as its working directory and Node watch mode with `apps/server` as its working directory; relative environment and upload paths resolve from those workspace roots.

## Configuration Files

| File | Responsibility |
|---|---|
| `package.json` | npm workspaces, root scripts, runtime requirements, root lint dependencies |
| `apps/client/package.json` | Client dependencies and Vite scripts |
| `apps/server/package.json` | API dependencies and start/dev/test scripts |
| `apps/client/vite.config.js` | Vite/React/Tailwind plugins, development host/port, and `/api` proxy validation |
| `eslint.config.js` | JavaScript/JSX linting, browser/Node globals, React hooks and refresh rules |
| `oxlint.config.json` | Oxlint ignore patterns and correctness category |
| `.npmrc` | Strict npm engine enforcement |
| `apps/client/.env.example` | Public `VITE_` host, port, and API proxy target values |
| `apps/server/.env.example` | Private API, authentication, JWT, upload, and SQL Server settings |
| `.gitignore` | Ignores environment files, dependencies, build output, logs, and local files |
| `.github/workflows/ci.yml` | Installs dependencies, audits, lints, tests, and builds on pull requests and main pushes |
| `.github/copilot-instructions.md` | Repository coding and architecture rules for AI-assisted changes |

Copy each `.env.example` to the corresponding workspace `.env` for local development. Client `VITE_` values are public and bundled into the browser; never put secrets there. Production secrets belong in the deployment environment or a secret manager.

### Server environment groups

- API binding and limits: `HOST`, `PORT`, `JSON_BODY_LIMIT`, `API_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`.
- Authentication: `AUTH_API_URL`, `AUTH_API_TIMEOUT_MS`, `LOGIN_RATE_LIMIT_MAX`, `CORS_ORIGINS`.
- Session security: `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `PROFILE_SETUP_TTL_SECONDS`, `TRUST_PROXY`, `NODE_ENV`. `TRUST_PROXY` accepts explicit proxy IPs/subnets or named subnet aliases; blanket `true` is rejected.
- SQL Server: `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `DB_POOL_MAX`.
- Proof storage: `PROOF_UPLOAD_DIR`, `PROOF_UPLOAD_MAX_BYTES`.

Pino writes structured JSON logs to stdout using `LOG_LEVEL`. HTTP request records include a request ID, method, matched route template, status, and duration; raw query strings, request bodies, cookies, tokens, and employee identifiers are not included. Durable business events are recorded in `dbo.application_audit_events`; role changes and evidence views use their dedicated audit tables. `API_RATE_LIMIT_MAX` and `API_RATE_LIMIT_WINDOW_MS` limit all API endpoints, and login additionally has the stricter `LOGIN_RATE_LIMIT_MAX`. `TRUST_PROXY` is applied only when set to explicit trusted proxy IPs/subnets or named subnet aliases; blanket `true` is rejected to prevent spoofed client IPs from bypassing rate limits.

## Security and Operations Notes

- The SQL database must exist before the API starts. Startup initialization requires database-level `CREATE TABLE` and `ALTER` on `dbo`, plus DML access to application tables. Schema-level `ALTER` is broad; move DDL to a deployment identity before production if the runtime identity must be DML-only.
- The local upload directory is not a complete production evidence-storage policy. Use storage with appropriate access control, encryption, persistence, backup, and retention/deletion handling. Evidence is served through the authenticated admin API, not as static content.
- Run `docs/admin-bootstrap.sql` once with a controlled SQL identity after the initial admin-manager E-code has a user profile. Replace the placeholder E-code before executing it. There is no public admin self-registration path.
- Confirm that the configured authentication service uses a 2xx response only for successful authentication and a non-2xx response for rejected credentials.
- The development authentication URL is a placeholder and must be replaced with the approved fixed HTTPS endpoint.
- `TRUST_PROXY` should only be enabled behind a trusted proxy. Keep SQL certificate validation enabled in production.
- See [implementation-roadmap.md](implementation-roadmap.md) for outstanding decisions and release gates.
