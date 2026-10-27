import { getPool, sql } from '../db/pool.js';

const selectProfile = `
  SELECT
    id,
    ecode,
    fullname,
    office_email AS officeEmail,
    phonenumber,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM dbo.user_profiles
`;

export async function recordApplicationAuditEvent({
  requestId,
  actorEcode = null,
  subjectEcode = null,
  eventType,
  outcome,
  details = null,
}) {
  const pool = await getPool();
  await pool.request()
    .input('requestId', sql.UniqueIdentifier, requestId)
    .input('actorEcode', sql.NVarChar(32), actorEcode)
    .input('subjectEcode', sql.NVarChar(32), subjectEcode)
    .input('eventType', sql.NVarChar(48), eventType)
    .input('outcome', sql.NVarChar(16), outcome)
    .input('detailsJson', sql.NVarChar(2000), details ? JSON.stringify(details) : null)
    .query(`
      INSERT INTO dbo.application_audit_events
        (request_id, actor_ecode, subject_ecode, event_type, outcome, details_json)
      VALUES
        (@requestId, @actorEcode, @subjectEcode, @eventType, @outcome, @detailsJson);
    `);
}

export async function registerProfile({ profile }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ecode', sql.NVarChar(32), profile.ecode)
    .input('fullname', sql.NVarChar(150), profile.fullname)
    .input('officeEmail', sql.NVarChar(254), profile.officeEmail)
    .input('phoneNumber', sql.NVarChar(32), profile.phonenumber)
    .query(`
      INSERT INTO dbo.user_profiles (ecode, fullname, office_email, phonenumber)
      VALUES (@ecode, @fullname, @officeEmail, @phoneNumber);
      ${selectProfile}
      WHERE ecode = @ecode;
    `);

  return result.recordset[0];
}

export async function updateProfile(profile) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ecode', sql.NVarChar(32), profile.ecode)
    .input('fullname', sql.NVarChar(150), profile.fullname)
    .input('officeEmail', sql.NVarChar(254), profile.officeEmail)
    .input('phoneNumber', sql.NVarChar(32), profile.phonenumber)
    .query(`
      UPDATE dbo.user_profiles
      SET fullname = @fullname, office_email = @officeEmail,
          phonenumber = @phoneNumber, updated_at = SYSUTCDATETIME()
      WHERE ecode = @ecode;
      ${selectProfile}
      WHERE ecode = @ecode;
    `);

  return result.recordset[0] ?? null;
}

export async function addPermission({ ecode, permission, wbsCode, clientName, lobName, proof }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const contextResult = await new sql.Request(transaction)
      .input('wbsCode', sql.NVarChar(64), wbsCode)
      .input('clientName', sql.NVarChar(200), clientName)
      .input('lobName', sql.NVarChar(150), lobName)
      .query(`
        DECLARE @contextId BIGINT;
        SELECT @contextId = id
        FROM dbo.project_contexts WITH (UPDLOCK, HOLDLOCK)
        WHERE wbs_code = @wbsCode AND client_name = @clientName AND lob_name = @lobName;

        IF @contextId IS NULL
        BEGIN
          INSERT INTO dbo.project_contexts (wbs_code, client_name, lob_name)
          VALUES (@wbsCode, @clientName, @lobName);
          SET @contextId = SCOPE_IDENTITY();
        END;
        SELECT @contextId AS id;
      `);

    const permissionResult = await new sql.Request(transaction)
      .input('ecode', sql.NVarChar(32), ecode)
      .input('contextId', sql.BigInt, contextResult.recordset[0].id)
      .input('permission', sql.NVarChar(64), permission)
      .query(`
        INSERT INTO dbo.user_permissions (ecode, context_id, permission, consent_status, risk_accepted_at)
        OUTPUT INSERTED.id AS permissionId, INSERTED.consent_status AS consentStatus,
          INSERTED.risk_accepted_at AS riskAcceptedAt
        VALUES (@ecode, @contextId, @permission, N'GRANTED', SYSUTCDATETIME());
      `);
    const savedPermission = permissionResult.recordset[0];

    await new sql.Request(transaction)
      .input('permissionId', sql.BigInt, savedPermission.permissionId)
      .input('filePath', sql.NVarChar(260), proof.filePath)
      .input('originalFilename', sql.NVarChar(255), proof.originalFilename)
      .input('contentType', sql.NVarChar(100), proof.contentType)
      .query(`
        INSERT INTO dbo.permission_proofs (permission_id, file_path, original_filename, content_type)
        VALUES (@permissionId, @filePath, @originalFilename, @contentType);
      `);

    await transaction.commit();
    return {
      permissionId: savedPermission.permissionId,
      permission,
      consentStatus: savedPermission.consentStatus,
      riskAcceptedAt: savedPermission.riskAcceptedAt,
      wbsCode,
      clientName,
      lobName,
      proofs: [{ originalFilename: proof.originalFilename, contentType: proof.contentType }],
    };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

export async function findProfileByEcode(ecode) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ecode', sql.NVarChar(32), ecode)
    .query(`${selectProfile} WHERE ecode = @ecode;`);

  return result.recordset[0] ?? null;
}

export async function findPermissionsByEcode(ecode) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ecode', sql.NVarChar(32), ecode)
    .query(`
      SELECT
        up.id AS permissionId,
        up.permission,
        up.consent_status AS consentStatus,
        pc.wbs_code AS wbsCode,
        pc.client_name AS clientName,
        pc.lob_name AS lobName,
        up.granted_at AS grantedAt,
        pp.id AS proofId,
        pp.original_filename AS originalFilename,
        pp.content_type AS contentType,
        pp.uploaded_at AS uploadedAt
      FROM dbo.user_permissions AS up
      INNER JOIN dbo.project_contexts AS pc ON pc.id = up.context_id
      LEFT JOIN dbo.permission_proofs AS pp ON pp.permission_id = up.id
      WHERE up.ecode = @ecode
      ORDER BY up.granted_at DESC, pp.uploaded_at DESC;
    `);

  const permissions = new Map();

  for (const row of result.recordset) {
    let permission = permissions.get(row.permissionId);
    if (!permission) {
      permission = {
        permissionId: row.permissionId,
        permission: row.permission,
        consentStatus: row.consentStatus,
        wbsCode: row.wbsCode,
        clientName: row.clientName,
        lobName: row.lobName,
        grantedAt: row.grantedAt,
        proofs: [],
      };
      permissions.set(row.permissionId, permission);
    }

    if (row.proofId) {
      permission.proofs.push({
        id: row.proofId,
        originalFilename: row.originalFilename,
        contentType: row.contentType,
        uploadedAt: row.uploadedAt,
      });
    }
  }

  return [...permissions.values()];
}

export async function findActiveRolesByEcode(ecode) {
  const pool = await getPool();
  const result = await pool.request()
    .input('ecode', sql.NVarChar(32), ecode)
    .query(`
      SELECT role_name AS role
      FROM dbo.user_roles
      WHERE ecode = @ecode AND revoked_at IS NULL;
    `);

  return result.recordset.map((row) => row.role);
}

export async function findAdmins() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      p.ecode,
      p.fullname,
      p.office_email AS officeEmail,
      ur.role_name AS role,
      ur.assigned_at AS assignedAt
    FROM dbo.user_roles AS ur
    INNER JOIN dbo.user_profiles AS p ON p.ecode = ur.ecode
    WHERE ur.revoked_at IS NULL
      AND ur.role_name IN (N'ADMIN', N'ADMIN_MANAGER')
    ORDER BY p.fullname, ur.role_name;
  `);

  const admins = new Map();
  for (const row of result.recordset) {
    let admin = admins.get(row.ecode);
    if (!admin) {
      admin = {
        ecode: row.ecode,
        fullname: row.fullname,
        officeEmail: row.officeEmail,
        roles: [],
      };
      admins.set(row.ecode, admin);
    }
    admin.roles.push({ name: row.role, assignedAt: row.assignedAt });
  }

  return [...admins.values()];
}

export async function searchPermissionDirectory({ term, page, pageSize }) {
  const pool = await getPool();
  const searchTerm = `%${term.replaceAll('~', '~~').replaceAll('%', '~%').replaceAll('_', '~_').replaceAll('[', '~[')}%`;
  const offset = (page - 1) * pageSize;
  const countResult = await pool.request()
    .input('searchTerm', sql.NVarChar(210), searchTerm)
    .query(`
      SELECT COUNT_BIG(DISTINCT up.id) AS total
      FROM dbo.user_permissions AS up
      INNER JOIN dbo.user_profiles AS p ON p.ecode = up.ecode
      INNER JOIN dbo.project_contexts AS pc ON pc.id = up.context_id
      WHERE pc.client_name LIKE @searchTerm ESCAPE N'~'
        OR pc.wbs_code LIKE @searchTerm ESCAPE N'~';
    `);
  const result = await pool.request()
    .input('searchTerm', sql.NVarChar(210), searchTerm)
    .input('offset', sql.Int, offset)
    .input('pageSize', sql.Int, pageSize)
    .query(`
      WITH permission_page AS (
        SELECT
          up.id AS permissionId,
          up.permission,
          up.consent_status AS consentStatus,
          up.granted_at AS grantedAt,
          p.ecode,
          p.fullname,
          p.office_email AS officeEmail,
          pc.wbs_code AS wbsCode,
          pc.client_name AS clientName,
          pc.lob_name AS lobName
        FROM dbo.user_permissions AS up
        INNER JOIN dbo.user_profiles AS p ON p.ecode = up.ecode
        INNER JOIN dbo.project_contexts AS pc ON pc.id = up.context_id
        WHERE pc.client_name LIKE @searchTerm ESCAPE N'~'
          OR pc.wbs_code LIKE @searchTerm ESCAPE N'~'
        ORDER BY pc.client_name, pc.wbs_code, p.fullname, up.permission
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      )
      SELECT
        page.permissionId,
        page.permission,
        page.consentStatus,
        page.grantedAt,
        page.ecode,
        page.fullname,
        page.officeEmail,
        page.wbsCode,
        page.clientName,
        page.lobName,
        pp.id AS proofId,
        pp.original_filename AS originalFilename,
        pp.content_type AS contentType,
        pp.uploaded_at AS uploadedAt
      FROM permission_page AS page
      LEFT JOIN dbo.permission_proofs AS pp ON pp.permission_id = page.permissionId
      ORDER BY page.clientName, page.wbsCode, page.fullname, page.permission, pp.uploaded_at DESC;
    `);

  const records = new Map();
  for (const row of result.recordset) {
    let record = records.get(row.permissionId);
    if (!record) {
      record = {
        permissionId: row.permissionId,
        permission: row.permission,
        consentStatus: row.consentStatus,
        grantedAt: row.grantedAt,
        user: {
          ecode: row.ecode,
          fullname: row.fullname,
          officeEmail: row.officeEmail,
        },
        wbsCode: row.wbsCode,
        clientName: row.clientName,
        lobName: row.lobName,
        proofs: [],
      };
      records.set(row.permissionId, record);
    }
    if (row.proofId) {
      record.proofs.push({
        id: row.proofId,
        originalFilename: row.originalFilename,
        contentType: row.contentType,
        uploadedAt: row.uploadedAt,
      });
    }
  }

  return {
    results: [...records.values()],
    page,
    pageSize,
    total: Number(countResult.recordset[0].total),
  };
}

export async function findProofById(proofId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('proofId', sql.BigInt, proofId)
    .query(`
      SELECT file_path AS filePath, original_filename AS originalFilename, content_type AS contentType
      FROM dbo.permission_proofs
      WHERE id = @proofId;
    `);

  return result.recordset[0] ?? null;
}

export async function recordEvidenceAccess({ proofId, actorEcode }) {
  const pool = await getPool();
  await pool.request()
    .input('proofId', sql.BigInt, proofId)
    .input('actorEcode', sql.NVarChar(32), actorEcode)
    .query(`
      INSERT INTO dbo.evidence_access_audit (proof_id, actor_ecode)
      VALUES (@proofId, @actorEcode);
    `);
}

export async function changeAdminRole({ ecode, actorEcode, enabled, reason }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const profileResult = await new sql.Request(transaction)
      .input('ecode', sql.NVarChar(32), ecode)
      .query('SELECT ecode FROM dbo.user_profiles WITH (UPDLOCK, HOLDLOCK) WHERE ecode = @ecode;');
    if (!profileResult.recordset[0]) {
      await transaction.rollback();
      return null;
    }

    const roleResult = await new sql.Request(transaction)
      .input('ecode', sql.NVarChar(32), ecode)
      .input('role', sql.NVarChar(32), 'ADMIN')
      .query(`
        SELECT id FROM dbo.user_roles WITH (UPDLOCK, HOLDLOCK)
        WHERE ecode = @ecode AND role_name = @role AND revoked_at IS NULL;
      `);
    const activeRole = roleResult.recordset[0];

    if (enabled && !activeRole) {
      await new sql.Request(transaction)
        .input('ecode', sql.NVarChar(32), ecode)
        .input('actorEcode', sql.NVarChar(32), actorEcode)
        .input('role', sql.NVarChar(32), 'ADMIN')
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          INSERT INTO dbo.user_roles (ecode, role_name, assigned_by)
          VALUES (@ecode, @role, @actorEcode);
          INSERT INTO dbo.user_role_audit (ecode, role_name, action, changed_by, reason)
          VALUES (@ecode, @role, N'ASSIGNED', @actorEcode, @reason);
        `);
    } else if (!enabled && activeRole) {
      await new sql.Request(transaction)
        .input('roleId', sql.BigInt, activeRole.id)
        .input('actorEcode', sql.NVarChar(32), actorEcode)
        .input('ecode', sql.NVarChar(32), ecode)
        .input('role', sql.NVarChar(32), 'ADMIN')
        .input('reason', sql.NVarChar(500), reason)
        .query(`
          UPDATE dbo.user_roles
          SET revoked_by = @actorEcode, revoked_at = SYSUTCDATETIME()
          WHERE id = @roleId;
          INSERT INTO dbo.user_role_audit (ecode, role_name, action, changed_by, reason)
          VALUES (@ecode, @role, N'REVOKED', @actorEcode, @reason);
        `);
    }

    await transaction.commit();
    return { ecode, enabled, changed: Boolean(enabled ? !activeRole : activeRole) };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}