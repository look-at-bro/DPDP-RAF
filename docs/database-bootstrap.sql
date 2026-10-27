/*
  DPDP RAF target SQL Server bootstrap.

  This creates the DPDPRAF database if absent and all profile/permission tables.
  Run with a SQL Server principal authorized to create the database and objects.
  Configure apps/server/.env with DB_NAME=DPDPRAF (or change the name below).

  The target schema intentionally omits location. Existing databases may still
  have a legacy location column and values; this script does not drop that
  column or erase existing data. The application no longer requires or reads it.

  The permission table stores the latest status. It is not an append-only audit
  history. Confirm the required RoPA history model in the roadmap before use.
*/

IF DB_ID(N'DPDPRAF') IS NULL
  EXEC(N'CREATE DATABASE [DPDPRAF]');
GO

USE [DPDPRAF];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.user_profiles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_profiles (
    id BIGINT IDENTITY(1,1) NOT NULL,
    ecode NVARCHAR(32) NOT NULL,
    fullname NVARCHAR(150) NOT NULL,
    office_email NVARCHAR(254) NOT NULL,
    phonenumber NVARCHAR(32) NOT NULL,
    created_at DATETIME2(3) NOT NULL
      CONSTRAINT DF_user_profiles_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL
      CONSTRAINT DF_user_profiles_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_user_profiles PRIMARY KEY (id)
  );
END;
GO

IF COL_LENGTH(N'dbo.user_profiles', N'id') IS NULL
  ALTER TABLE dbo.user_profiles ADD id BIGINT IDENTITY(1,1) NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_user_profiles_id'
    AND object_id = OBJECT_ID(N'dbo.user_profiles')
)
  CREATE UNIQUE INDEX UX_user_profiles_id ON dbo.user_profiles (id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_user_profiles_ecode'
    AND object_id = OBJECT_ID(N'dbo.user_profiles')
)
  CREATE UNIQUE INDEX UX_user_profiles_ecode ON dbo.user_profiles (ecode);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_user_profiles_office_email'
    AND object_id = OBJECT_ID(N'dbo.user_profiles')
)
  CREATE UNIQUE INDEX UX_user_profiles_office_email
    ON dbo.user_profiles (office_email);
GO

IF OBJECT_ID(N'dbo.project_contexts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.project_contexts (
    id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_project_contexts PRIMARY KEY,
    wbs_code NVARCHAR(64) NOT NULL,
    client_name NVARCHAR(200) NOT NULL,
    lob_name NVARCHAR(150) NOT NULL,
    created_at DATETIME2(3) NOT NULL
      CONSTRAINT DF_project_contexts_created_at DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_project_contexts_wbs_client_lob'
    AND object_id = OBJECT_ID(N'dbo.project_contexts')
)
  CREATE UNIQUE INDEX UX_project_contexts_wbs_client_lob
    ON dbo.project_contexts (wbs_code, client_name, lob_name);
GO

IF OBJECT_ID(N'dbo.user_permissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_permissions (
    id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_user_permissions PRIMARY KEY,
    ecode NVARCHAR(32) NOT NULL,
    context_id BIGINT NOT NULL,
    permission NVARCHAR(64) NOT NULL,
    consent_status NVARCHAR(16) NOT NULL,
    granted_at DATETIME2(3) NOT NULL
      CONSTRAINT DF_user_permissions_granted_at DEFAULT SYSUTCDATETIME(),
    risk_accepted_at DATETIME2(3) NULL,
    CONSTRAINT FK_user_permissions_profile FOREIGN KEY (ecode)
      REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT FK_user_permissions_context FOREIGN KEY (context_id)
      REFERENCES dbo.project_contexts (id),
    CONSTRAINT CK_user_permissions_status
      CHECK (consent_status IN (N'GRANTED', N'REVOKED'))
  );
END;
GO

IF COL_LENGTH(N'dbo.user_permissions', N'risk_accepted_at') IS NULL
  ALTER TABLE dbo.user_permissions ADD risk_accepted_at DATETIME2(3) NULL;
GO

UPDATE dbo.user_permissions SET consent_status = N'GRANTED' WHERE consent_status = N'PENDING';

IF OBJECT_ID(N'dbo.CK_user_permissions_status', N'C') IS NOT NULL
  ALTER TABLE dbo.user_permissions DROP CONSTRAINT CK_user_permissions_status;

ALTER TABLE dbo.user_permissions
  ADD CONSTRAINT CK_user_permissions_status
  CHECK (consent_status IN (N'GRANTED', N'REVOKED'));
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_user_permissions_mapping'
    AND object_id = OBJECT_ID(N'dbo.user_permissions')
)
  CREATE UNIQUE INDEX UX_user_permissions_mapping
    ON dbo.user_permissions (ecode, context_id, permission);
GO

IF OBJECT_ID(N'dbo.permission_proofs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.permission_proofs (
    id BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_permission_proofs PRIMARY KEY,
    permission_id BIGINT NOT NULL,
    file_path NVARCHAR(260) NOT NULL,
    original_filename NVARCHAR(255) NOT NULL,
    content_type NVARCHAR(100) NOT NULL,
    uploaded_at DATETIME2(3) NOT NULL
      CONSTRAINT DF_permission_proofs_uploaded_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_permission_proofs_permission FOREIGN KEY (permission_id)
      REFERENCES dbo.user_permissions (id)
  );
END;
GO

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_roles (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_user_roles PRIMARY KEY,
    ecode NVARCHAR(32) NOT NULL,
    role_name NVARCHAR(32) NOT NULL,
    assigned_by NVARCHAR(32) NULL,
    assigned_at DATETIME2(3) NOT NULL CONSTRAINT DF_user_roles_assigned_at DEFAULT SYSUTCDATETIME(),
    revoked_by NVARCHAR(32) NULL,
    revoked_at DATETIME2(3) NULL,
    CONSTRAINT FK_user_roles_profile FOREIGN KEY (ecode) REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT FK_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT FK_user_roles_revoked_by FOREIGN KEY (revoked_by) REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT CK_user_roles_name CHECK (role_name IN (N'ADMIN', N'ADMIN_MANAGER')),
    CONSTRAINT CK_user_roles_revocation CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    )
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UX_user_roles_active'
    AND object_id = OBJECT_ID(N'dbo.user_roles')
)
  CREATE UNIQUE INDEX UX_user_roles_active
    ON dbo.user_roles (ecode, role_name)
    WHERE revoked_at IS NULL;
GO

IF OBJECT_ID(N'dbo.user_role_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_role_audit (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_user_role_audit PRIMARY KEY,
    ecode NVARCHAR(32) NOT NULL,
    role_name NVARCHAR(32) NOT NULL,
    action NVARCHAR(32) NOT NULL,
    changed_by NVARCHAR(32) NULL,
    changed_at DATETIME2(3) NOT NULL CONSTRAINT DF_user_role_audit_changed_at DEFAULT SYSUTCDATETIME(),
    reason NVARCHAR(500) NULL,
    CONSTRAINT FK_user_role_audit_profile FOREIGN KEY (ecode) REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT FK_user_role_audit_actor FOREIGN KEY (changed_by) REFERENCES dbo.user_profiles (ecode),
    CONSTRAINT CK_user_role_audit_role CHECK (role_name IN (N'ADMIN', N'ADMIN_MANAGER')),
    CONSTRAINT CK_user_role_audit_action CHECK (action IN (N'ASSIGNED', N'REVOKED', N'BOOTSTRAP_ASSIGNED'))
  );
END;
GO

IF OBJECT_ID(N'dbo.evidence_access_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.evidence_access_audit (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_evidence_access_audit PRIMARY KEY,
    proof_id BIGINT NOT NULL,
    actor_ecode NVARCHAR(32) NOT NULL,
    accessed_at DATETIME2(3) NOT NULL CONSTRAINT DF_evidence_access_audit_accessed_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_evidence_access_audit_proof FOREIGN KEY (proof_id) REFERENCES dbo.permission_proofs (id),
    CONSTRAINT FK_evidence_access_audit_actor FOREIGN KEY (actor_ecode) REFERENCES dbo.user_profiles (ecode)
  );
END;
GO

IF OBJECT_ID(N'dbo.application_audit_events', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.application_audit_events (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_application_audit_events PRIMARY KEY,
    request_id UNIQUEIDENTIFIER NOT NULL,
    actor_ecode NVARCHAR(32) NULL,
    subject_ecode NVARCHAR(32) NULL,
    event_type NVARCHAR(48) NOT NULL,
    outcome NVARCHAR(16) NOT NULL,
    details_json NVARCHAR(2000) NULL,
    occurred_at DATETIME2(3) NOT NULL CONSTRAINT DF_application_audit_events_occurred_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_application_audit_events_outcome CHECK (outcome IN (N'SUCCESS', N'FAILURE', N'PARTIAL')),
    CONSTRAINT CK_application_audit_events_details CHECK (details_json IS NULL OR ISJSON(details_json) = 1)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_application_audit_events_occurred_at'
    AND object_id = OBJECT_ID(N'dbo.application_audit_events')
)
  CREATE INDEX IX_application_audit_events_occurred_at
    ON dbo.application_audit_events (occurred_at DESC, id DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_application_audit_events_actor'
    AND object_id = OBJECT_ID(N'dbo.application_audit_events')
)
  CREATE INDEX IX_application_audit_events_actor
    ON dbo.application_audit_events (actor_ecode, occurred_at DESC)
    WHERE actor_ecode IS NOT NULL;
GO
