# Profile, Permissions, and Admin Roadmap

Use this checklist in order. Items marked complete describe behavior already present in the repository; unchecked items are remaining implementation or release work. The project inventory is in [project-guide.md](project-guide.md), and the target SQL Server bootstrap is in [database-bootstrap.sql](database-bootstrap.sql).

**Legend:** `[ ] !` marks an unresolved item blocked on an owner decision, external environment, or deployment choice. It is not complete.

## 1. Confirm Scope and Consent Meaning

- [x] Use E-code from the authenticated profile-setup session; do not accept identity from the registration form.
- [x] Support first-time registration and send returning profiles directly to the application.
- [x] Keep first-time profile registration separate from permission/evidence entry.
- [x] Remove location from the form, API schema/response, repository queries, startup DDL, tests, and documentation. Existing database columns and values are preserved; assess physical removal separately.
- [x] Let users record a permission they already hold, identify the WBS/client/LOB context, and attach evidence; the new mapping is `GRANTED`, not a review request.
- [x] Return permission state and evidence references separately from profile data.
- [x] Confirm the application JWT contract: E-code is the only application-specific claim. Standard `iss`, `aud`, `iat`, and `exp` claims are also present; no profile or project data is included.
- [ ] ! Have the privacy/compliance owner approve the permission vocabulary and determine the applicable purpose/lawful-basis treatment. An uploaded document is evidence, not by itself proof of legally valid consent.
- [ ] ! Have the appropriate owners approve admin evidence-view access and evidence/record retention periods.

**Technical baseline complete. Compliance exit criteria remain open:** approved permission purpose, evidence policy, and retention schedule.

## 2. Align and Migrate the Database

- [x] Create profile, project-context, user-permission, and proof-reference tables at startup.
- [x] Create role assignment, role-change audit, and evidence-access audit tables at startup.
- [x] Normalize reusable WBS/client/LOB context separately from per-user permissions.
- [x] Parameterize repository writes and write profile, context, permission, and proof metadata in one SQL transaction.
- [x] Stop requiring or adding location in `initializeDatabase.js` and repository queries. Existing database columns/values are preserved; assess any physical column removal through a reviewed migration.
- [x] Document the current startup DDL requirements and do not recommend `db_owner`; schema-level `ALTER` is broader than row-level access.
- [x] Read-only inspection of the configured database confirms the application columns, unique-index keys, foreign keys, UTC timestamp defaults, and `GRANTED`/`REVOKED` check; no application rows were read.
- [x] Provide `ADMIN` and `ADMIN_MANAGER` roles with active-role uniqueness and an explicit initial-manager bootstrap script.
- [ ] ! Rehearse the migration against a copy of the current database. Preserve profile E-codes and references; inspect and resolve duplicate emails or contexts before unique indexes are applied.
- [ ] ! Decide whether permission status may be updated in place or whether RoPA/audit needs append-only grant, amendment, and revocation events. Add event tables and code only after this decision.
- [ ] ! Decide whether to keep startup DDL with a dedicated schema-capable identity or move schema changes to a deployment/migration identity, leaving the runtime identity DML-only.
- [ ] ! Run the bootstrap repeatedly on a disposable SQL Server database; compare its final schema with the application queries. The configured database is shared and was not modified for this check.

**Exit criteria:** reviewed migration succeeds on a copy of existing data, and a fresh database matches the application schema.

## 3. Complete Registration and Evidence Handling

- [x] Validate profile details and permission name, WBS, client, and LOB fields on the client and server.
- [x] Require one supported proof file; enforce the configured size limit and generate a non-user-controlled stored filename.
- [x] Remove an uploaded file when validation or the database write fails.
- [x] Remove location and confirm client/server validation and API payloads agree with the requested field list.
- [x] Verify proof contents against the supported PDF, Word, email, and text formats; do not rely only on filename extension or browser-supplied MIME type.
- [x] Store a generated private filename and retain sanitized display metadata for the permission evidence record.
- [ ] ! Define and deploy malware scanning requirements with the hosting environment. File signatures do not establish that content is safe to open.
- [ ] ! Select production storage with restricted access, encryption, persistence, backup/restore, and retention/deletion controls. The current local disk directory is an MVP, not a complete evidence-storage policy.
- [x] Add an admin-only evidence endpoint; it records the authorized viewer and does not expose the upload directory as static content.
- [x] Verify duplicate office-email writes return HTTP 409 and remove the uploaded proof. Current setup-token replay behavior upserts the profile, sets the existing permission back to `GRANTED` with a refreshed timestamp, and appends a new proof record.
- [ ] ! Have the appropriate owner approve replay behavior, evidence deduplication/retention, and the permission change audit history.

**Exit criteria:** accepted evidence is durable and reviewable by authorized roles only; rejected evidence leaves no file or database record.

## 4. Implement Consent and Permission Lifecycle

- [x] Store named permission mappings from E-code to a WBS/client/LOB context, with a granted/revoked state and grant timestamp.
- [x] Add paginated admin search by client or WBS code, including user, permission status, and evidence metadata.
- [x] Add manager-authorized assignment/revocation of the `ADMIN` role, an active administrator list, and audit records with actor and reason.
- [ ] ! Agree the permission vocabulary and purpose/processing details required by the organization's RoPA.
- [ ] ! Implement the approved history model so amendments and revocations remain traceable, including actor and effective timestamp where required.
- [ ] ! Add permission revoke/amend endpoints and UI only after permission-owner and lifecycle rules are approved. Admins currently review records; permission state management is not exposed in the admin UI.
- [ ] ! Define how proof references relate to each grant or change event, and how evidence is retained or deleted when permission is revoked.
- [ ] ! Confirm the registration confirmation and stored permission accurately describe each other; do not treat an uploaded document alone as proof that a legal consent was valid.

**Exit criteria:** compliance can reconstruct who had which permission, for what context, when it changed, and which evidence supports the record.

## 5. Authentication, Authorization, and Privacy

- [x] Keep the upstream employee authentication URL server-configured and HTTPS-only.
- [x] Treat upstream 2xx as authentication success; when the response includes an E-code, require it to match the submitted identity.
- [x] Use short-lived HttpOnly, SameSite cookies for setup and application sessions; derive profile E-code from the signed setup token.
- [x] Keep roles out of application JWT claims and verify active roles from the database on every admin API request.
- [x] Avoid logging credentials and avoid returning the application token in JSON or browser-readable storage.
- [x] Apply a global API rate limit and only trust explicitly configured proxy networks; blanket proxy trust is rejected.
- [x] Review application logs: login logs status/flow only, and registration logs do not include profile fields, proof names, or E-codes.
- [x] Test that expired application JWTs return 401 and clear the access cookie; existing tests also cover origin rejection and cookie flags.
- [x] Keep evidence private and serve it only after admin authorization; audit each evidence-view attempt.
- [x] Separate admin read access from `ADMIN_MANAGER` role assignment; prevent self-revocation and require a reason for role changes.
- [ ] ! Confirm the real upstream authentication service returns 2xx only for successful authentication and non-2xx for rejected credentials.
- [ ] ! Verify cookie, CORS, origin-check, trusted proxy addresses/hops, rate-limit, and session-expiry settings in the target deployment.
- [x] Review logs, error responses, and new evidence metadata for unnecessary personal data. Existing legacy filename values remain subject to retention review.

**Exit criteria:** authorization is enforced server-side for every profile, permission, and proof operation, and deployment security settings are reviewed.

## 6. Test, Deploy, and Operate

- [x] Cover login branches, registration validation, required proof, unsupported file type, session cookie behavior, and origin rejection with Node's test runner.
- [x] Cover admin authorization denial, admin search/list access, manager-only role changes, self-revocation prevention, and evidence access auditing.
- [ ] ! Add database integration tests for idempotent initialization, constraints, transaction rollback, duplicate records, and migration from the current schema.
- [x] Test rejection of proof files above the default 10 MiB size limit.
- [x] Test malformed PDF rejection and cleanup after content rejection, database-write failure, and duplicate-email conflict.
- [x] Test that an unavailable upload destination returns a generic service error without registering the profile.
- [ ] ! Test database transaction rollback after partial SQL writes and verify production storage behavior.
- [ ] ! Add end-to-end staging tests using a non-production authentication endpoint and SQL Server database.
- [x] Keep CI configured for dependency audit, lint, tests, and build; all four commands pass locally.
- [ ] ! Confirm the actual pull-request/main CI run passes.
- [ ] ! Rehearse backup restoration, evidence retrieval, retention/deletion, and incident response before production release.
- [ ] ! Record the approved RoPA mapping, schema version, deployment owner, and operational runbook.

**Exit criteria:** staging passes the release checks, rollback is rehearsed, and operational ownership is documented.

## Release Gate

Do not mark the feature production-ready until the approved permission model, upstream authentication contract, role/schema migration, protected evidence storage and retention, permission lifecycle, and live SQL Server staging checks are complete.
