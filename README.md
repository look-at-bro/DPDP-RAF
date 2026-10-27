# DPDP RAF

Private npm-workspaces application monorepo with a React single-page client and
an Express JSON API.

## Requirements

- Node.js `>=22.22.0`
- npm `>=11.0.0`

## Install and run

Run commands from the repository root:

```sh
npm install
npm run dev
```

The client is available at `http://127.0.0.1:5173` and the API at
`http://127.0.0.1:5000`. Vite proxies `/api` requests to the API during local
development. The API listens only on loopback by default.

To start both services for other devices on the same trusted network, run
`start-network.bat` on Windows or `npm run dev:network`. The launcher binds
Vite to the network, chooses an available port, prints the LAN URLs, and adds
those exact origins to the API allowlist for that run. Keep the terminal open
while the app is in use; stop both services with Ctrl+C. This development
launcher is not intended for public internet hosting.

## Project Documentation

- [Implementation roadmap](docs/implementation-roadmap.md) — delivery checklist and release gates.
- [Database bootstrap](docs/database-bootstrap.sql) — target SQL Server database and schema script.
- [Database inspection](docs/database-inspection.sql) — read-only schema and table-data inspection script.
- [Project report](docs/project-report.md) — technology stack, application architecture, database model, and project details.
- [Git setup report](docs/git-setup-report.md) — initial Git setup, private repository push issue, root cause, and resolution.
- [Project guide](docs/project-guide.md) — repository structure, packages, scripts, and configuration.

Each workspace has an ignored `.env` for local configuration and a committed
`.env.example` template. On a new checkout, copy the examples to create local
files (PowerShell):

```powershell
Copy-Item apps\client\.env.example apps\client\.env
Copy-Item apps\server\.env.example apps\server\.env
```

Client `VITE_` variables are public configuration and are embedded in client
builds; never put secrets in `apps/client/.env`. Server configuration such as
`HOST`, `PORT`, request-body limits, and API rate limits belongs in
`apps/server/.env`. Keep production secrets in the deployment environment or a
secret manager, not in committed files.

The server validates its required settings at startup. Replace the example
upstream URLs, JWT secret, and database credentials before starting the API.

Build the client and start the production API workspace:

```sh
npm run build
npm run start --workspace @dpdp-raf/server
```

The server starts the API and initializes the profile table before listening.
It does not serve the client build. Configure `HOST` and `PORT` in the server
environment to change its binding.

## Workspace commands

- `npm run dev:client` — start only the Vite client.
- `npm run dev --workspace @dpdp-raf/client` — start Vite.
- `npm run dev --workspace @dpdp-raf/server` — start the API with Node watch mode.
- `npm run build --workspace @dpdp-raf/client` — build the client.
- `npm run preview --workspace @dpdp-raf/client` — preview the client build.
- `npm run lint` / `npm run lint:fast` — run the configured ESLint / Oxlint checks.
- `npm test` — run the JavaScript server test suite.

## Employee Authentication

The login form posts `{ "username": "<E-code>", "password": "..." }` to
`POST /api/login`. The server forwards those fields to the fixed HTTPS
`AUTH_API_URL` configured in `apps/server/.env`; the URL cannot be supplied by
the browser. The server does not log credentials. An upstream non-2xx status
is returned as an error. After successful upstream authentication, the server
checks the profile table by E-code: an existing profile receives an application
JWT and `nextStep: "APPLICATION"`; a first-time E-code receives a short-lived
profile-setup JWT and `nextStep: "PROFILE_REQUIRED"`. Both tokens are set in
HttpOnly, SameSite=Strict cookies.

`POST /api/profile` accepts multipart form data for `fullname`, `officeEmail`,
`phonenumber`, `wbsCode`, `clientName`, `lobName`,
`consentConfirmed=true`, and a `proof` file. The E-code is derived from the
signed setup token, never from submitted form data. The server records the
`CLIENT_LOB_ACCESS` permission as `GRANTED` for that context and links the
uploaded evidence. On success, it issues an application JWT whose signed
payload contains the E-code. The JWT is returned only in an HttpOnly,
SameSite=Strict cookie, not in JSON or browser-readable storage. `GET /api/me`
uses the cookie to return the current profile, and `POST /api/logout` clears
the session cookie.

The setup token expires after 10 minutes by default; the application token
expires after 15 minutes by default. Configure `PROFILE_SETUP_TTL_SECONDS` and
`JWT_ACCESS_TTL_SECONDS` to change those lifetimes. The browser sends cookies
with API requests and logs response details with sensitive fields redacted.

This does not implement refresh tokens or retrieve additional employee data.

## Database and Deployment

At startup, the server connects to the configured SQL Server and idempotently
creates or extends `dbo.user_profiles`, `dbo.project_contexts`,
`dbo.user_permissions`, and `dbo.permission_proofs`, including their keys and
indexes. Profiles are linked to reusable client/WBS/LOB contexts; permission
records link an E-code to a context, and proof records retain a generated
storage key and content type. New uploads do not retain the user-supplied
filename; a generic label is written to the legacy non-null filename column.
Profile, context, permission, and proof metadata are written in one parameterized
SQL transaction.

Proof files are stored under `PROOF_UPLOAD_DIR` (default
`private-uploads/permission-proofs` relative to the server working directory),
outside static client serving, with randomized server-generated names. Only
PDF, Word, and email/text formats are accepted, up to 10 MB by default. Restrict
filesystem access to the API identity and use encrypted storage and backups
appropriate to the evidence sensitivity. The database stores the generated
filename, not an absolute filesystem path. Configure the folder and size with
`PROOF_UPLOAD_DIR` and `PROOF_UPLOAD_MAX_BYTES`.

The database must exist before starting the server. On startup, the configured
database principal needs database-level `CREATE TABLE` and `ALTER` on the `dbo`
schema to create tables and indexes, in addition to read/write access to the
four application tables. The schema-level `ALTER` permission is broader than
row-level access and remains required because initialization runs at every
startup. Do not grant `db_owner`. Before production, prefer moving schema
changes to a dedicated deployment/migration identity so the runtime identity
can be limited to application data operations. Configure DB connection values in
`apps/server/.env`. Production must terminate HTTPS at the API or a trusted
proxy. Set `TRUST_PROXY` to explicit trusted proxy IP addresses or CIDR subnets,
not `true`, only behind that proxy. Keep `DB_TRUST_SERVER_CERTIFICATE=false`,
and use a valid SQL Server certificate trusted by the application host.
