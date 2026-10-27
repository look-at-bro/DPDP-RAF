import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import request from 'supertest';
import writeExcelFile from 'write-excel-file/node';
import { createApp } from '../src/server.js';

const testSecret = 'local-test-secret-with-more-than-32-characters';
const generatedProofFiles = [];
const generatedTestDirectories = [];

after(async () => {
  await Promise.all([
    ...generatedProofFiles.map((filePath) => unlink(filePath).catch(() => {})),
    ...generatedTestDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  ]);
});

function makeProfileRepository() {
  const profiles = new Map();
  const approvals = new Map();
  const roles = new Map();
  const proofs = new Map();
  const evidenceAccesses = [];
  const roleChanges = [];
  const auditEvents = [];
  const requests = [];
  return {
    async upsertProfile(profile) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async registerProfile({ profile }) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async updateProfile(profile) {
      if (!profiles.has(profile.ecode)) return null;
      profiles.set(profile.ecode, { ...profiles.get(profile.ecode), ...profile });
      return { ...profiles.get(profile.ecode) };
    },
    async findProfileByEcode(ecode) {
      return profiles.get(ecode) ?? null;
    },
    async findActiveRolesByEcode(ecode) {
      return roles.get(ecode) ?? [];
    },
    async findAdmins() {
      return [...roles.entries()]
        .filter(([, userRoles]) => userRoles.includes('ADMIN') || userRoles.includes('ADMIN_MANAGER'))
        .map(([ecode, userRoles]) => ({ ecode, fullname: profiles.get(ecode)?.fullname, roles: userRoles.map((name) => ({ name })) }));
    },
    async searchPermissionDirectory({ term, page, pageSize }) {
      return { results: [], page, pageSize, total: 0, term };
    },
    async findProofById(proofId) {
      return proofs.get(Number(proofId)) ?? null;
    },
    async recordEvidenceAccess(access) {
      evidenceAccesses.push(access);
    },
    async recordApplicationAuditEvent(event) {
      auditEvents.push(event);
    },
    async changeAdminRole({ ecode, actorEcode, enabled, reason }) {
      const currentRoles = roles.get(ecode) ?? [];
      const updatedRoles = enabled
        ? [...new Set([...currentRoles, 'ADMIN'])]
        : currentRoles.filter((role) => role !== 'ADMIN');
      roles.set(ecode, updatedRoles);
      roleChanges.push({ ecode, actorEcode, enabled, reason });
      return { ecode, enabled, changed: true };
    },
    async addPermission(approval) {
      requests.push(approval);
      const saved = {
        permissionId: requests.length,
        permission: approval.permission,
        consentStatus: 'GRANTED',
        wbsCode: approval.wbsCode,
        clientName: approval.clientName,
        lobName: approval.lobName,
        proofs: [{ originalFilename: approval.proof.originalFilename, contentType: approval.proof.contentType }],
      };
      approvals.set(approval.ecode, [...(approvals.get(approval.ecode) ?? []), saved]);
      return saved;
    },
    async findPermissionsByEcode(ecode) {
      return approvals.get(ecode) ?? [];
    },
    requests,
    roles,
    proofs,
    evidenceAccesses,
    roleChanges,
    auditEvents,
  };
}

function makeApp(fetchImpl = async () => new Response('{"authenticated":true}', { status: 200 }), profiles = makeProfileRepository(), proofUploadDir, logger) {
  return createApp({
    authApiUrl: 'https://auth.test.invalid/login',
    jwtSecret: testSecret,
    fetchImpl,
    profiles,
    logger,
    allowedOrigins: [],
    secureCookies: false,
    proofUploadDir,
  });
}

function cookiePair(response, name) {
  const cookie = response.headers['set-cookie']?.find((entry) => entry.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return cookie.split(';')[0];
}

async function registerUser(app, ecode = 'E12345') {
  const login = await request(app).post('/api/login').send({ username: ecode, password: 'correct-password' });
  const registration = await request(app)
    .post('/api/profile')
    .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
    .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
  assert.equal(registration.status, 200);
  return { accessCookie: cookiePair(registration, 'dpdp_access_token') };
}

describe('authentication and profile setup', () => {
  it('logs request metadata with an ID but excludes query strings', async () => {
    const records = [];
    const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [
      level,
      (fields, event) => records.push({ level, fields, event }),
    ]));
    const app = makeApp(undefined, makeProfileRepository(), undefined, logger);
    const response = await request(app).get('/api/me?token=must-not-be-logged');
    const adminResponse = await request(app).put('/api/admin/admins/E54321?token=must-not-be-logged');

    assert.equal(response.status, 401);
    assert.equal(adminResponse.status, 401);
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
    assert.equal(records.length, 2);
    assert.equal(records[0].level, 'warn');
    assert.equal(records[0].event, 'http_request_completed');
    assert.equal(records[0].fields.path, '/api/me');
    assert.equal(records[0].fields.statusCode, 401);
    assert.equal(records[0].fields.requestId, response.headers['x-request-id']);
    assert.equal(records[1].fields.path, '/api/admin/admins/:ecode');
    assert.equal(JSON.stringify(records).includes('must-not-be-logged'), false);
    assert.equal(JSON.stringify(records).includes('E54321'), false);
  });

  it('applies the configured proxy and API rate limit', async () => {
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{"authenticated":true}', { status: 200 }),
      profiles: makeProfileRepository(),
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: 'loopback',
      apiRateLimitMax: 1,
    });
    assert.equal(app.get('trust proxy'), 'loopback');
    assert.equal((await request(app).get('/api/me')).status, 401);
    assert.equal((await request(app).get('/api/me')).status, 429);
  });

  it('rejects blanket trust of every proxy', () => {
    assert.throws(() => createApp({ trustProxy: 'true' }), /TRUST_PROXY=true is unsafe/);
  });

  it('forwards credentials and issues an E-code-bound setup cookie', async () => {
    const profiles = makeProfileRepository();
    let forwardedBody;
    const app = makeApp(async (_url, options) => {
      forwardedBody = JSON.parse(options.body);
      return new Response('{"authenticated":true}', { status: 200 });
    }, profiles);
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.deepEqual(forwardedBody, { username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'PROFILE_REQUIRED');
    const token = decodeURIComponent(cookiePair(response, 'dpdp_profile_setup').split('=')[1]);
    assert.equal(jwt.verify(token, testSecret, { audience: 'dpdp-profile-setup' }).ecode, 'E12345');
    assert.deepEqual(profiles.auditEvents[0], {
      requestId: response.headers['x-request-id'],
      actorEcode: 'E12345',
      subjectEcode: 'E12345',
      eventType: 'LOGIN',
      outcome: 'SUCCESS',
      details: { nextStep: 'PROFILE_REQUIRED' },
    });
  });

  it('rejects empty and placeholder credentials before contacting the authentication service', async () => {
    let authenticationRequests = 0;
    const app = makeApp(async () => {
      authenticationRequests += 1;
      return new Response('{"authenticated":true}', { status: 200 });
    });
    const invalidCredentials = [
      { username: '', password: 'correct-password' },
      { username: '   ', password: 'correct-password' },
      { username: '-', password: 'correct-password' },
      { username: 'E12345', password: '' },
      { username: 'E12345', password: '   ' },
      { username: 'E12345', password: '-' },
    ];

    for (const credentials of invalidCredentials) {
      const response = await request(app).post('/api/login').send(credentials);
      assert.equal(response.status, 400);
      assert.equal(response.headers['set-cookie'], undefined);
    }

    assert.equal(authenticationRequests, 0);
  });

  it('preserves upstream unauthorized status without issuing a cookie', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(async () => new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }), profiles);
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'wrong-password' });
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Invalid credentials');
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(profiles.auditEvents[0].eventType, 'LOGIN');
    assert.equal(profiles.auditEvents[0].outcome, 'FAILURE');
    assert.deepEqual(profiles.auditEvents[0].details, { reason: 'AUTH_REJECTED' });
    assert.equal(JSON.stringify(profiles.auditEvents).includes('wrong-password'), false);
  });

  it('accepts successful upstream responses and rejects a mismatched E-code', async () => {
    const missingConfirmation = await request(makeApp(async () => new Response('{}', { status: 200 })))
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });
    assert.equal(missingConfirmation.status, 200);
    assert.equal(missingConfirmation.body.nextStep, 'PROFILE_REQUIRED');
    assert.ok(missingConfirmation.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_profile_setup=')));

    const mismatchedIdentity = await request(makeApp(async () => new Response(
      JSON.stringify({ authenticated: true, ecode: 'E99999' }),
      { status: 200 },
    )))
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });
    assert.equal(mismatchedIdentity.status, 401);
    assert.equal(mismatchedIdentity.headers['set-cookie'], undefined);
  });

  it('sends returning users directly to the application', async () => {
    const profiles = makeProfileRepository();
    await profiles.upsertProfile({ ecode: 'E12345', fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    const response = await request(makeApp(undefined, profiles)).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'APPLICATION');
    assert.equal(response.body.user.ecode, 'E12345');
    assert.ok(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_access_token=')));
  });

  it('creates a profile without requiring approval details or a file', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    assert.deepEqual(profiles.requests, []);
    const currentUser = await request(app).get('/api/me').set('Cookie', accessCookie);
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.user.fullname, 'Taylor Example');
    assert.equal(currentUser.body.user.ecode, 'E12345');
    assert.ok(profiles.auditEvents.some((event) => event.eventType === 'PROFILE_CREATE' && event.details.source === 'SELF_SERVICE'));
  });

  it('rejects profile setup without its authenticated setup cookie', async () => {
    const response = await request(makeApp()).post('/api/profile').send({
      fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234',
    });
    assert.equal(response.status, 401);
  });

  it('allows the signed-in user to update details without changing E-code', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .send({ fullname: 'Taylor Updated', officeEmail: 'updated@example.test', phonenumber: '+15550109999' });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.fullname, 'Taylor Updated');
    assert.equal(response.body.user.ecode, 'E12345');
    assert.ok(profiles.auditEvents.some((event) => event.eventType === 'PROFILE_UPDATE' && event.actorEcode === 'E12345'));
  });

  it('audits logout and attributes it only to a valid session', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    const response = await request(app).post('/api/logout').set('Cookie', accessCookie);

    assert.equal(response.status, 200);
    const logoutEvent = profiles.auditEvents.find((event) => event.eventType === 'LOGOUT');
    assert.equal(logoutEvent.actorEcode, 'E12345');
    assert.equal(logoutEvent.subjectEcode, 'E12345');
  });

  it('validates profile changes and rejects disallowed origins', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const invalid = await request(app).put('/api/profile').set('Cookie', accessCookie).send({
      fullname: 'T', officeEmail: 'not-an-email', phonenumber: '123',
    });
    assert.equal(invalid.status, 400);
    const forbidden = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .set('Origin', 'https://untrusted.test')
      .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    assert.equal(forbidden.status, 403);
  });
});

describe('approval requests', () => {
  it('returns an empty approval list for users without requests', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const response = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.permissions, []);
  });

  it('stores an evidence-backed permission as granted and returns it in the list', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('riskAcceptanceConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7 proof'), { filename: 'approval.pdf', contentType: 'application/pdf' });
    assert.equal(response.status, 201);
    assert.equal(response.body.permission.consentStatus, 'GRANTED');
    assert.equal(response.body.permission.permission, 'Client data access');
    assert.equal(profiles.requests[0].riskAcceptanceConfirmed, 'true');
    assert.equal(response.body.permission.proofs[0].originalFilename, 'approval.pdf');
    assert.equal(JSON.stringify(response.body).includes(profiles.requests[0].proof.filePath), false);
    const list = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(list.body.permissions[0].consentStatus, 'GRANTED');
    assert.equal(list.body.permissions[0].clientName, 'Example Client');
    generatedProofFiles.push(resolve(process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'), profiles.requests[0].proof.filePath));
  });

  it('requires risk acceptance before recording a permission', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'dpdp-risk-acceptance-'));
    generatedTestDirectories.push(directory);
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles, directory);
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('%PDF-1.7 proof'), { filename: 'approval.pdf', contentType: 'application/pdf' });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /acknowledge.*risks/i);
    assert.deepEqual(profiles.requests, []);
    assert.deepEqual(await readdir(directory), []);
  });

  it('requires an approval document and validates its content', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'dpdp-approval-'));
    generatedTestDirectories.push(directory);
    const app = makeApp(undefined, makeProfileRepository(), directory);
    const { accessCookie } = await registerUser(app);
    const missing = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('riskAcceptanceConfirmed', 'true');
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /upload/i);
    const invalid = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('riskAcceptanceConfirmed', 'true')
      .attach('proof', Buffer.from('not a PDF'), { filename: 'approval.pdf', contentType: 'application/pdf' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /contents do not match/i);
    assert.deepEqual(await readdir(directory), []);
  });

  it('requires authentication and rejects unsupported upload types', async () => {
    const app = makeApp();
    const unauthorized = await request(app)
      .post('/api/permissions')
      .field('permission', 'Client data access')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(unauthorized.status, 401);
    const { accessCookie } = await registerUser(app);
    const invalidType = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(invalidType.status, 400);
  });
});

describe('admin API authorization', () => {
  it('denies regular users access to admin search and admin lists', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const search = await request(app).get('/api/admin/permissions?q=Client').set('Cookie', accessCookie);
    const admins = await request(app).get('/api/admin/admins').set('Cookie', accessCookie);
    assert.equal(search.status, 403);
    assert.equal(admins.status, 403);
  });

  it('allows admins to search and see admins but not change roles', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    profiles.roles.set('E12345', ['ADMIN']);
    let searchArguments;
    profiles.searchPermissionDirectory = async (options) => {
      searchArguments = options;
      return { results: [{ permissionId: 4, proofs: [] }], page: options.page, pageSize: options.pageSize, total: 1 };
    };

    const search = await request(app).get('/api/admin/permissions?q=Example&page=2').set('Cookie', accessCookie);
    assert.equal(search.status, 200);
    assert.deepEqual(searchArguments, { term: 'Example', page: 2, pageSize: 50 });
    assert.equal(search.body.results[0].permissionId, 4);

    const invalidSearch = await request(app).get('/api/admin/permissions?q=x').set('Cookie', accessCookie);
    assert.equal(invalidSearch.status, 400);

    const admins = await request(app).get('/api/admin/admins').set('Cookie', accessCookie);
    assert.equal(admins.status, 200);
    assert.equal(admins.body.admins[0].ecode, 'E12345');

    const profileProvision = await request(app)
      .post('/api/admin/users')
      .set('Cookie', accessCookie)
      .send({ ecode: 'E54321', fullname: 'Jordan Employee', officeEmail: 'jordan@example.test', phonenumber: '+15550105555' });
    assert.equal(profileProvision.status, 403);

    const roleChange = await request(app)
      .put('/api/admin/admins/E12345')
      .set('Cookie', accessCookie)
      .send({ enabled: false, reason: 'No longer responsible' });
    assert.equal(roleChange.status, 403);
  });

  it('allows managers to assign/revoke admins with reasons and prevents self-revocation', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    await profiles.upsertProfile({ ecode: 'E54321', fullname: 'Morgan Admin', officeEmail: 'morgan@example.test' });
    profiles.roles.set('E12345', ['ADMIN_MANAGER']);
    const invalid = await request(app)
      .put('/api/admin/admins/E54321')
      .set('Cookie', accessCookie)
      .send({ enabled: true, reason: 'x' });
    assert.equal(invalid.status, 400);

    const selfRevoke = await request(app)
      .put('/api/admin/admins/E12345')
      .set('Cookie', accessCookie)
      .send({ enabled: false, reason: 'Self request' });
    assert.equal(selfRevoke.status, 400);

    const assigned = await request(app)
      .put('/api/admin/admins/E54321')
      .set('Cookie', accessCookie)
      .send({ enabled: true, reason: 'Assigned for support duties' });
    assert.equal(assigned.status, 200);
    assert.ok(profiles.roles.get('E54321').includes('ADMIN'));
    assert.equal(profiles.roleChanges[0].reason, 'Assigned for support duties');

    const revoked = await request(app)
      .put('/api/admin/admins/E54321')
      .set('Cookie', accessCookie)
      .send({ enabled: false, reason: 'Duties have ended' });
    assert.equal(revoked.status, 200);
    assert.ok(!profiles.roles.get('E54321').includes('ADMIN'));
    assert.equal(profiles.roleChanges[1].reason, 'Duties have ended');

    const targetLogin = await request(app).post('/api/login').send({ username: 'E54321', password: 'correct-password' });
    const targetAccessCookie = cookiePair(targetLogin, 'dpdp_access_token');
    const deniedAfterRevocation = await request(app)
      .get('/api/admin/admins')
      .set('Cookie', targetAccessCookie);
    assert.equal(deniedAfterRevocation.status, 403);
  });

  it('allows managers to provision profiles that employees can use at login', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    profiles.roles.set('E12345', ['ADMIN_MANAGER']);

    const created = await request(app)
      .post('/api/admin/users')
      .set('Cookie', accessCookie)
      .send({ ecode: 'E54321', fullname: 'Jordan Employee', officeEmail: 'jordan@example.test', phonenumber: '+15550105555' });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.ecode, 'E54321');
    const creationEvent = profiles.auditEvents.find((event) => event.eventType === 'PROFILE_CREATE' && event.details.source === 'ADMIN_SINGLE');
    assert.equal(creationEvent.actorEcode, 'E12345');
    assert.equal(creationEvent.subjectEcode, 'E54321');
    assert.deepEqual(creationEvent.details, { source: 'ADMIN_SINGLE' });

    const employeeLogin = await request(app)
      .post('/api/login')
      .send({ username: 'E54321', password: 'correct-password' });
    assert.equal(employeeLogin.status, 200);
    assert.equal(employeeLogin.body.nextStep, 'APPLICATION');
  });

  it('imports Excel employee rows and reports duplicates without overwriting profiles', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    profiles.roles.set('E12345', ['ADMIN_MANAGER']);
    const registerProfile = profiles.registerProfile.bind(profiles);
    profiles.registerProfile = async ({ profile }) => {
      if (await profiles.findProfileByEcode(profile.ecode)) {
        const error = new Error('Duplicate employee profile');
        error.number = 2627;
        throw error;
      }
      return registerProfile({ profile });
    };

    const workbook = await writeExcelFile([
      ['Ecode', 'Full name', 'Office email', 'Phone number'],
      ['E54321', 'Jordan Employee', 'jordan@example.test', '+15550105555'],
      ['E54321', 'Duplicate Employee', 'duplicate@example.test', '+15550106666'],
      ['E12345', 'Existing Employee', 'existing@example.test', '+15550107777'],
      ['E98765', 'Invalid Employee', 'not-an-email', '+15550108888'],
    ]).toBuffer();

    const response = await request(app)
      .post('/api/admin/users/import')
      .set('Cookie', accessCookie)
      .attach('file', workbook, {
        filename: 'employees.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.createdCount, 1);
    assert.equal(response.body.skippedCount, 3);
    assert.deepEqual(response.body.results.map((result) => result.status), ['created', 'skipped', 'skipped', 'skipped']);
    assert.equal((await profiles.findProfileByEcode('E12345')).fullname, 'Taylor Example');
    assert.equal((await profiles.findProfileByEcode('E54321')).fullname, 'Jordan Employee');
    const importEvent = profiles.auditEvents.find((event) => event.eventType === 'PROFILE_BULK_IMPORT');
    assert.equal(importEvent.actorEcode, 'E12345');
    assert.equal(importEvent.outcome, 'PARTIAL');
    assert.deepEqual(importEvent.details, { rowCount: 4, createdCount: 1, skippedCount: 3 });
    assert.equal(profiles.auditEvents.filter((event) => event.eventType === 'PROFILE_CREATE' && event.details.source === 'ADMIN_BULK').length, 1);
  });

  it('serves evidence only to admins and records the viewer', async () => {
    const uploadDirectory = await mkdtemp(resolve(tmpdir(), 'dpdp-admin-evidence-'));
    generatedTestDirectories.push(uploadDirectory);
    await writeFile(resolve(uploadDirectory, 'evidence.txt'), 'private approval evidence');
    const profiles = makeProfileRepository();
    profiles.proofs.set(7, {
      filePath: 'evidence.txt',
      originalFilename: 'evidence.txt',
      contentType: 'text/plain',
    });
    const app = makeApp(undefined, profiles, uploadDirectory);
    const { accessCookie } = await registerUser(app);

    const denied = await request(app).get('/api/admin/evidence/7').set('Cookie', accessCookie);
    assert.equal(denied.status, 403);

    profiles.roles.set('E12345', ['ADMIN']);
    const response = await request(app).get('/api/admin/evidence/7').set('Cookie', accessCookie);
    assert.equal(response.status, 200);
    assert.equal(response.text, 'private approval evidence');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.deepEqual(profiles.evidenceAccesses, [{ proofId: 7, actorEcode: 'E12345' }]);
  });
});
/*
import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/server.js';

const testSecret = 'local-test-secret-with-more-than-32-characters';
const generatedProofFiles = [];
const generatedTestDirectories = [];

after(async () => {
  await Promise.all([
    ...generatedProofFiles.map((filePath) => unlink(filePath).catch(() => {})),
    ...generatedTestDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  ]);
});

function makeProfileRepository() {
  const profiles = new Map();
  const approvals = new Map();
  const requests = [];
  return {
    async upsertProfile(profile) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async registerProfile({ profile }) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async updateProfile(profile) {
      if (!profiles.has(profile.ecode)) return null;
      profiles.set(profile.ecode, { ...profiles.get(profile.ecode), ...profile });
      return { ...profiles.get(profile.ecode) };
    },
    async findProfileByEcode(ecode) {
      return profiles.get(ecode) ?? null;
    },
    async createPermissionRequest(approval) {
      requests.push(approval);
      const saved = {
        permissionId: requests.length,
        permission: approval.permission,
        consentStatus: 'PENDING',
        wbsCode: approval.wbsCode,
        clientName: approval.clientName,
        lobName: approval.lobName,
        proofs: [{ originalFilename: approval.proof.originalFilename, contentType: approval.proof.contentType }],
      };
      approvals.set(approval.ecode, [...(approvals.get(approval.ecode) ?? []), saved]);
      return saved;
    },
    async findPermissionsByEcode(ecode) {
      return approvals.get(ecode) ?? [];
    },
    requests,
  };
}

function makeApp(fetchImpl = async () => new Response('{}', { status: 200 }), profiles = makeProfileRepository(), proofUploadDir) {
  return createApp({
    authApiUrl: 'https://auth.test.invalid/login',
    jwtSecret: testSecret,
    fetchImpl,
    profiles,
    allowedOrigins: [],
    secureCookies: false,
    proofUploadDir,
  });
}

function cookiePair(response, name) {
  const cookie = response.headers['set-cookie']?.find((entry) => entry.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return cookie.split(';')[0];
}

async function registerUser(app, ecode = 'E12345') {
  const login = await request(app).post('/api/login').send({ username: ecode, password: 'correct-password' });
  const registration = await request(app)
    .post('/api/profile')
    .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
    .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
  assert.equal(registration.status, 200);
  return { login, registration, accessCookie: cookiePair(registration, 'dpdp_access_token') };
}

describe('authentication and profile setup', () => {
  it('applies the configured proxy and API rate limit', async () => {
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles: makeProfileRepository(),
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: 'loopback',
      apiRateLimitMax: 1,
    });
    assert.equal(app.get('trust proxy'), 'loopback');
    assert.equal((await request(app).get('/api/me')).status, 401);
    assert.equal((await request(app).get('/api/me')).status, 429);
  });

  it('rejects blanket trust of every proxy', () => {
    assert.throws(() => createApp({ trustProxy: 'true' }), /TRUST_PROXY=true is unsafe/);
  });

  it('forwards credentials and issues an E-code-bound setup cookie', async () => {
    let forwardedBody;
    const app = makeApp(async (_url, options) => {
      forwardedBody = JSON.parse(options.body);
      return new Response('{}', { status: 200 });
    });
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.deepEqual(forwardedBody, { username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'PROFILE_REQUIRED');
    const token = decodeURIComponent(cookiePair(response, 'dpdp_profile_setup').split('=')[1]);
    assert.equal(jwt.verify(token, testSecret, { audience: 'dpdp-profile-setup' }).ecode, 'E12345');
  });

  it('preserves upstream unauthorized status without issuing a cookie', async () => {
    const app = makeApp(async () => new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }));
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'wrong-password' });
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Invalid credentials');
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('sends returning users directly to the application', async () => {
    const profiles = makeProfileRepository();
    await profiles.upsertProfile({ ecode: 'E12345', fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    const response = await request(makeApp(undefined, profiles)).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'APPLICATION');
    assert.equal(response.body.user.ecode, 'E12345');
    assert.ok(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_access_token=')));
  });

  it('creates a profile without requiring approval details or a file', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    assert.deepEqual(profiles.requests, []);
    const currentUser = await request(app).get('/api/me').set('Cookie', accessCookie);
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.user.fullname, 'Taylor Example');
    assert.equal(currentUser.body.user.ecode, 'E12345');
  });

  it('rejects profile setup without its authenticated setup cookie', async () => {
    const response = await request(makeApp()).post('/api/profile').send({
      fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234',
    });
    assert.equal(response.status, 401);
  });

  it('allows the signed-in user to update details without changing E-code', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .send({ fullname: 'Taylor Updated', officeEmail: 'updated@example.test', phonenumber: '+15550109999' });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.fullname, 'Taylor Updated');
    assert.equal(response.body.user.ecode, 'E12345');
  });

  it('validates profile changes and rejects disallowed origins', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const invalid = await request(app).put('/api/profile').set('Cookie', accessCookie).send({
      fullname: 'T', officeEmail: 'not-an-email', phonenumber: '123',
    });
    assert.equal(invalid.status, 400);
    const forbidden = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .set('Origin', 'https://untrusted.test')
      .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    assert.equal(forbidden.status, 403);
  });
});

describe('approval requests', () => {
  it('returns an empty approval list for users without requests', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const response = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.permissions, []);
  });

  it('stores proof-backed approval as pending and returns it in the list', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('%PDF-1.7 proof'), { filename: 'approval.pdf', contentType: 'application/pdf' });
    assert.equal(response.status, 201);
    assert.equal(response.body.approval.consentStatus, 'PENDING');
    assert.equal(response.body.approval.permission, 'Client data access');
    assert.equal(response.body.approval.proofs[0].originalFilename, 'approval.pdf');
    assert.equal(JSON.stringify(response.body).includes(profiles.requests[0].proof.filePath), false);
    const list = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(list.body.permissions[0].consentStatus, 'PENDING');
    assert.equal(list.body.permissions[0].clientName, 'Example Client');
    generatedProofFiles.push(resolve(process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'), profiles.requests[0].proof.filePath));
  });

  it('requires an approval document and validates its content', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'dpdp-approval-'));
    generatedTestDirectories.push(directory);
    const app = makeApp(undefined, makeProfileRepository(), directory);
    const { accessCookie } = await registerUser(app);
    const missing = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory');
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /upload/i);
    const invalid = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('not a PDF'), { filename: 'approval.pdf', contentType: 'application/pdf' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /contents do not match/i);
    assert.deepEqual(await readdir(directory), []);
  });

  it('requires authentication and rejects unsupported upload types', async () => {
    const app = makeApp();
    const unauthorized = await request(app)
      .post('/api/permissions')
      .field('permission', 'Client data access')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(unauthorized.status, 401);
    const { accessCookie } = await registerUser(app);
    const invalidType = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(invalidType.status, 400);
  });
});
/*
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/server.js';

const testSecret = 'local-test-secret-with-more-than-32-characters';
const generatedProofFiles = [];
const generatedTestDirectories = [];

after(async () => {
  await Promise.all([
    ...generatedProofFiles.map((filePath) => unlink(filePath).catch(() => {})),
    ...generatedTestDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  ]);
});

function makeProfileRepository() {
  const profiles = new Map();
  const approvals = new Map();
  const requests = [];

  return {
    async upsertProfile(profile) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async registerProfile({ profile }) {
      profiles.set(profile.ecode, { ...profile });
      return { ...profile };
    },
    async updateProfile(profile) {
      if (!profiles.has(profile.ecode)) return null;
      profiles.set(profile.ecode, { ...profiles.get(profile.ecode), ...profile });
      return { ...profiles.get(profile.ecode) };
    },
    async findProfileByEcode(ecode) {
      return profiles.get(ecode) ?? null;
    },
    async createPermissionRequest(approval) {
      requests.push(approval);
      const saved = {
        permissionId: requests.length,
        permission: approval.permission,
        consentStatus: 'PENDING',
        wbsCode: approval.wbsCode,
        clientName: approval.clientName,
        lobName: approval.lobName,
        proofs: [{ originalFilename: approval.proof.originalFilename, contentType: approval.proof.contentType }],
      };
      approvals.set(approval.ecode, [...(approvals.get(approval.ecode) ?? []), saved]);
      return saved;
    },
    async findPermissionsByEcode(ecode) {
      return approvals.get(ecode) ?? [];
    },
    requests,
  };
}

function makeApp(fetchImpl = async () => new Response('{}', { status: 200 }), profiles = makeProfileRepository(), proofUploadDir) {
  return createApp({
    authApiUrl: 'https://auth.test.invalid/login',
    jwtSecret: testSecret,
    fetchImpl,
    profiles,
    allowedOrigins: [],
    secureCookies: false,
    proofUploadDir,
  });
}

function cookiePair(response, name) {
  const cookie = response.headers['set-cookie']?.find((entry) => entry.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return cookie.split(';')[0];
}

async function registerUser(app, ecode = 'E12345') {
  const login = await request(app).post('/api/login').send({ username: ecode, password: 'correct-password' });
  const registration = await request(app)
    .post('/api/profile')
    .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
    .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
  assert.equal(registration.status, 200);
  return { login, registration, accessCookie: cookiePair(registration, 'dpdp_access_token') };
}

describe('authentication and profile setup', () => {
  it('applies the configured proxy and API rate limit', async () => {
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles: makeProfileRepository(),
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: 'loopback',
      apiRateLimitMax: 1,
    });
    assert.equal(app.get('trust proxy'), 'loopback');
    assert.equal((await request(app).get('/api/me')).status, 401);
    assert.equal((await request(app).get('/api/me')).status, 429);
  });

  it('rejects blanket trust of every proxy', () => {
    assert.throws(() => createApp({ trustProxy: 'true' }), /TRUST_PROXY=true is unsafe/);
  });

  it('forwards credentials and issues an E-code-bound profile setup cookie', async () => {
    let forwardedBody;
    const app = makeApp(async (_url, options) => {
      forwardedBody = JSON.parse(options.body);
      return new Response('{}', { status: 200 });
    });
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.deepEqual(forwardedBody, { username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'PROFILE_REQUIRED');
    const token = decodeURIComponent(cookiePair(response, 'dpdp_profile_setup').split('=')[1]);
    assert.equal(jwt.verify(token, testSecret, { audience: 'dpdp-profile-setup' }).ecode, 'E12345');
  });

  it('preserves upstream unauthorized status without issuing a cookie', async () => {
    const app = makeApp(async () => new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401 }));
    const response = await request(app).post('/api/login').send({ username: 'E12345', password: 'wrong-password' });
    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Invalid credentials');
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('sends returning users directly to the application', async () => {
    const profiles = makeProfileRepository();
    await profiles.upsertProfile({ ecode: 'E12345', fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    const response = await request(makeApp(undefined, profiles)).post('/api/login').send({ username: 'E12345', password: 'correct-password' });
    assert.equal(response.body.nextStep, 'APPLICATION');
    assert.equal(response.body.user.ecode, 'E12345');
    assert.ok(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_access_token=')));
  });

  it('creates a profile without requiring approval details or a file', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    assert.deepEqual(profiles.requests, []);
    const currentUser = await request(app).get('/api/me').set('Cookie', accessCookie);
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.user.fullname, 'Taylor Example');
    assert.equal(currentUser.body.user.ecode, 'E12345');
  });

  it('rejects profile setup without its authenticated setup cookie', async () => {
    const response = await request(makeApp()).post('/api/profile').send({
      fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234',
    });
    assert.equal(response.status, 401);
  });

  it('allows the signed-in user to update contact details without changing E-code', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .send({ fullname: 'Taylor Updated', officeEmail: 'updated@example.test', phonenumber: '+15550109999' });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.fullname, 'Taylor Updated');
    assert.equal(response.body.user.ecode, 'E12345');
  });

  it('validates profile changes and rejects disallowed origins', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const invalid = await request(app).put('/api/profile').set('Cookie', accessCookie).send({
      fullname: 'T', officeEmail: 'not-an-email', phonenumber: '123',
    });
    assert.equal(invalid.status, 400);

    const forbidden = await request(app)
      .put('/api/profile')
      .set('Cookie', accessCookie)
      .set('Origin', 'https://untrusted.test')
      .send({ fullname: 'Taylor Example', officeEmail: 'taylor@example.test', phonenumber: '+15550101234' });
    assert.equal(forbidden.status, 403);
  });
});

describe('approval requests', () => {
  it('returns an empty approval list for users without requests', async () => {
    const app = makeApp();
    const { accessCookie } = await registerUser(app);
    const response = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.permissions, []);
  });

  it('stores a proof-backed approval as pending and returns it in the list', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const { accessCookie } = await registerUser(app);
    const response = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('%PDF-1.7 proof'), { filename: 'approval.pdf', contentType: 'application/pdf' });

    assert.equal(response.status, 201);
    assert.equal(response.body.approval.consentStatus, 'PENDING');
    assert.equal(response.body.approval.permission, 'Client data access');
    assert.equal(response.body.approval.proofs[0].originalFilename, 'approval.pdf');
    assert.equal(JSON.stringify(response.body).includes(profiles.requests[0].proof.filePath), false);

    const list = await request(app).get('/api/permissions').set('Cookie', accessCookie);
    assert.equal(list.body.permissions[0].consentStatus, 'PENDING');
    assert.equal(list.body.permissions[0].clientName, 'Example Client');
    generatedProofFiles.push(resolve(process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'), profiles.requests[0].proof.filePath));
  });

  it('requires an approval document and validates the upload content', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'dpdp-approval-'));
    generatedTestDirectories.push(directory);
    const app = makeApp(undefined, makeProfileRepository(), directory);
    const { accessCookie } = await registerUser(app);
    const fields = { permission: 'Client data access', wbsCode: 'WBS-123', clientName: 'Example Client', lobName: 'Advisory' };
    const missing = await request(app).post('/api/permissions').set('Cookie', accessCookie).field('permission', fields.permission);
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /upload/i);

    const invalid = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field(fields)
      .attach('proof', Buffer.from('not a PDF'), { filename: 'approval.pdf', contentType: 'application/pdf' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message, /contents do not match/i);
    assert.deepEqual(await readdir(directory), []);
  });

  it('rejects unsupported upload types and requests without an authenticated session', async () => {
    const app = makeApp();
    const unsupported = await request(app)
      .post('/api/permissions')
      .field('permission', 'Client data access')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(unsupported.status, 401);

    const { accessCookie } = await registerUser(app);
    const invalidType = await request(app)
      .post('/api/permissions')
      .set('Cookie', accessCookie)
      .field('permission', 'Client data access')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('program'), { filename: 'approval.exe', contentType: 'application/octet-stream' });
    assert.equal(invalidType.status, 400);
  });
});
/*
import { access, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { after, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/server.js';

const testSecret = 'local-test-secret-with-more-than-32-characters';
const generatedProofFiles = [];
const generatedTestDirectories = [];

after(async () => {
  await Promise.all([
    ...generatedProofFiles.map((filePath) => unlink(filePath).catch(() => {})),
    ...generatedTestDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  ]);
});

function makeProfileRepository() {
  const profiles = new Map();
  const registrations = [];

  return {
    async upsertProfile(profile) {
      const saved = { id: profiles.size + 1, ...profile };
      profiles.set(profile.ecode, saved);
      return { ...saved };
    },
    async registerProfile(registration) {
      registrations.push(registration);
      const saved = { id: profiles.size + 1, ...registration.profile };
      profiles.set(saved.ecode, saved);
      return { ...saved };
    },
    async findProfileByEcode(ecode) {
      return profiles.get(ecode) ?? null;
    },
    registrations,
  };
}

function makeApp(
  fetchImpl = async () => new Response('{}', { status: 200 }),
  profiles = makeProfileRepository(),
) {
  return createApp({
    authApiUrl: 'https://auth.test.invalid/login',
    jwtSecret: testSecret,
    fetchImpl,
    profiles,
    allowedOrigins: [],
    secureCookies: false,
  });
}

function cookiePair(response, name) {
  const cookie = response.headers['set-cookie']?.find((entry) => entry.startsWith(`${name}=`));
  assert.ok(cookie, `${name} cookie should be set`);
  return cookie.split(';')[0];
}

describe('POST /api/login', () => {
  it('applies an explicit trusted proxy and the global API rate limit', async () => {
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles: makeProfileRepository(),
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: 'loopback',
      apiRateLimitMax: 1,
    });

    assert.equal(app.get('trust proxy'), 'loopback');
    assert.equal((await request(app).get('/api/me')).status, 401);
    assert.equal((await request(app).get('/api/me')).status, 429);
  });

  it('rejects blanket trust of every proxy', () => {
    assert.throws(() => createApp({ trustProxy: 'true' }), /TRUST_PROXY=true is unsafe/);
  });

  it('forwards username and password, then sets an E-code-bound setup cookie', async () => {
    let forwardedBody;
    let redirectMode;
    const app = makeApp(async (_url, options) => {
      forwardedBody = JSON.parse(options.body);
      redirectMode = options.redirect;
      return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
    });

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    assert.equal(response.status, 200);
    assert.deepEqual(forwardedBody, { username: 'E12345', password: 'correct-password' });
    assert.equal(redirectMode, 'error');
    assert.deepEqual(response.body, {
      success: true,
      nextStep: 'PROFILE_REQUIRED',
      ecode: 'E12345',
    });

    const token = decodeURIComponent(cookiePair(response, 'dpdp_profile_setup').split('=')[1]);
    const claims = jwt.verify(token, testSecret, { audience: 'dpdp-profile-setup' });
    assert.equal(claims.ecode, 'E12345');
    assert.equal(response.headers['set-cookie'][0].includes('HttpOnly'), true);
  });

  it('preserves upstream unauthorized status without issuing a setup cookie', async () => {
    const app = makeApp(async () => new Response(
      JSON.stringify({ message: 'Invalid credentials' }),
      { status: 401 },
    ));

    const response = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'wrong-password' });

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      success: false,
      upstreamStatus: 401,
      message: 'Invalid credentials',
    });
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('sends a returning profile directly to the application with an E-code JWT', async () => {
    const profiles = makeProfileRepository();
    await profiles.upsertProfile({
      ecode: 'E12345',
      fullname: 'Taylor Example',
      officeEmail: 'taylor@example.test',
      phonenumber: '+15550101234',
    });

    const response = await request(makeApp(undefined, profiles))
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    assert.equal(response.status, 200);
    assert.equal(response.body.nextStep, 'APPLICATION');
    assert.equal(response.body.user.ecode, 'E12345');
    assert.equal(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_access_token=')), true);
    assert.equal(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_profile_setup=')), false);

    const accessCookie = cookiePair(response, 'dpdp_access_token');
    const token = decodeURIComponent(accessCookie.split('=')[1]);
    const claims = jwt.verify(token, testSecret, { audience: 'dpdp-app' });
    assert.equal(claims.ecode, 'E12345');
  });

  it('clears an expired application session and requires sign-in', async () => {
    const expiredToken = jwt.sign({ ecode: 'E12345' }, testSecret, {
      algorithm: 'HS256',
      audience: 'dpdp-app',
      issuer: 'dpdp-raf',
      expiresIn: -1,
    });

    const response = await request(makeApp())
      .get('/api/me')
      .set('Cookie', `dpdp_access_token=${expiredToken}`);

    assert.equal(response.status, 401);
    assert.equal(response.body.message, 'Your session has expired. Sign in again.');
    assert.equal(response.headers['set-cookie'].some((cookie) => cookie.startsWith('dpdp_access_token=;')), true);
  });

  it('returns the current permission and attached proof documents for the signed-in user', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const registration = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    const permissionsResponse = await request(app)
      .get('/api/permissions')
      .set('Cookie', cookiePair(registration, 'dpdp_access_token'));

    assert.equal(permissionsResponse.status, 200);
    assert.equal(permissionsResponse.body.permissions[0].permission, 'CLIENT_LOB_ACCESS');
    assert.equal(permissionsResponse.body.permissions[0].wbsCode, 'WBS-123');
    assert.equal(permissionsResponse.body.permissions[0].clientName, 'Example Client');
    assert.equal(permissionsResponse.body.permissions[0].lobName, 'Advisory');
    assert.equal(permissionsResponse.body.permissions[0].proofs[0].contentType, 'application/pdf');
    assert.equal(permissionsResponse.body.permissions[0].proofs[0].filePath, profiles.registrations[0].proof.filePath);
  });
});

describe('profile registration and JWT session', () => {
  it('saves profile, project consent, and proof then issues an E-code JWT cookie', async () => {
    const profiles = makeProfileRepository();
    const app = makeApp(undefined, profiles);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });
    const setupCookie = cookiePair(login, 'dpdp_profile_setup');

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', setupCookie)
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'Taylor.Example@company.test')
      .field('phonenumber', '+1 (555) 010-1234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7'), {
        filename: 'permission-Taylor-E12345.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      user: {
        ecode: 'E12345',
        fullname: 'Taylor Example',
        officeEmail: 'taylor.example@company.test',
        phonenumber: '+1 (555) 010-1234',
      },
    });
    assert.deepEqual(profiles.registrations[0].profile, {
      fullname: 'Taylor Example',
      officeEmail: 'taylor.example@company.test',
      phonenumber: '+1 (555) 010-1234',
      ecode: 'E12345',
    });
    assert.deepEqual(profiles.registrations[0].context, {
      wbsCode: 'WBS-123',
      clientName: 'Example Client',
      lobName: 'Advisory',
    });
    assert.deepEqual(Object.keys(profiles.registrations[0].proof).sort(), ['contentType', 'filePath']);
    assert.equal(JSON.stringify(profiles.registrations[0].proof).includes('Taylor-E12345'), false);
    assert.equal(profiles.registrations[0].proof.contentType, 'application/pdf');
    generatedProofFiles.push(resolve(
      process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'),
      profiles.registrations[0].proof.filePath,
    ));

    const accessCookie = cookiePair(response, 'dpdp_access_token');
    const accessToken = decodeURIComponent(accessCookie.split('=')[1]);
    const claims = jwt.verify(accessToken, testSecret, { audience: 'dpdp-app' });
    assert.equal(claims.ecode, 'E12345');
    assert.equal(response.headers['set-cookie'].some((cookie) => cookie.includes('HttpOnly')), true);
    assert.equal(JSON.stringify(response.body).includes(accessToken), false);

    const currentUser = await request(app)
      .get('/api/me')
      .set('Cookie', accessCookie);
    assert.equal(currentUser.status, 200);
    assert.equal(currentUser.body.user.ecode, 'E12345');
  });

  it('rejects submissions without explicit consent confirmation', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .attach('proof', Buffer.from('%PDF-1.7'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Check the profile fields and try again.');
  });

  it('requires an uploaded permission proof file', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true');

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'Upload the permission proof file to continue.');
  });

  it('rejects unsupported permission proof file types', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('not a supported file'), {
        filename: 'permission.exe',
        contentType: 'application/octet-stream',
      });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /supported file type/i);
  });

  it('rejects proof contents that do not match the declared PDF type', async () => {
    const profiles = makeProfileRepository();
    const uploadDirectory = await mkdtemp(resolve(tmpdir(), 'dpdp-invalid-proof-'));
    generatedTestDirectories.push(uploadDirectory);
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles,
      allowedOrigins: [],
      secureCookies: false,
      proofUploadDir: uploadDirectory,
    });
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('This is not a PDF document.'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /contents do not match/i);
    assert.deepEqual(profiles.registrations, []);
    assert.deepEqual(await readdir(uploadDirectory), []);
  });

  it('removes the uploaded proof when the registration database write fails', async () => {
    const profiles = makeProfileRepository();
    profiles.registerProfile = async (registration) => {
      profiles.registrations.push(registration);
      throw new Error('Database unavailable');
    };
    const app = makeApp(undefined, profiles);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7\nvalid test content'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    const proofPath = resolve(
      process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'),
      profiles.registrations[0].proof.filePath,
    );
    generatedProofFiles.push(proofPath);

    assert.equal(response.status, 500);
    await assert.rejects(access(proofPath), { code: 'ENOENT' });
  });

  it('returns a conflict and removes the proof for a duplicate office email', async () => {
    const profiles = makeProfileRepository();
    profiles.registerProfile = async (registration) => {
      profiles.registrations.push(registration);
      throw Object.assign(new Error('Duplicate office email'), { number: 2627 });
    };
    const app = makeApp(undefined, profiles);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7\nduplicate test content'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    const proofPath = resolve(
      process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'),
      profiles.registrations[0].proof.filePath,
    );
    generatedProofFiles.push(proofPath);

    assert.equal(response.status, 409);
    assert.equal(response.body.message, 'That office email is already registered.');
    await assert.rejects(access(proofPath), { code: 'ENOENT' });
  });

  it('rejects proof uploads when the storage destination is unavailable', async () => {
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'dpdp-proof-upload-'));
    generatedTestDirectories.push(temporaryDirectory);
    const blockedDestination = resolve(temporaryDirectory, 'not-a-directory');
    await writeFile(blockedDestination, 'occupies the expected directory path');
    const profiles = makeProfileRepository();
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles,
      allowedOrigins: [],
      secureCookies: false,
      proofUploadDir: blockedDestination,
    });
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.from('%PDF-1.7\nstorage failure test'), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 503);
    assert.equal(response.body.message, 'Unable to store the permission proof file.');
    assert.equal(profiles.registrations.length, 0);
    assert.equal(await readFile(blockedDestination, 'utf8'), 'occupies the expected directory path');
  });

  it('rejects permission proof files larger than the default 10 MiB limit', async () => {
    const app = makeApp();
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .field('fullname', 'Taylor Example')
      .field('officeEmail', 'taylor@example.test')
      .field('phonenumber', '+15550101234')
      .field('wbsCode', 'WBS-123')
      .field('clientName', 'Example Client')
      .field('lobName', 'Advisory')
      .field('consentConfirmed', 'true')
      .attach('proof', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'permission.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 400);
    assert.equal(response.body.message, 'The permission proof file is too large.');
  });

  it('rejects profile submission without the upstream-authenticated setup cookie', async () => {
    const response = await request(makeApp())
      .post('/api/profile')
      .send({
        fullname: 'Taylor Example',
        officeEmail: 'taylor@example.test',
        phonenumber: '+15550101234',
        wbsCode: 'WBS-123',
        clientName: 'Example Client',
        lobName: 'Advisory',
        consentConfirmed: 'true',
      });

    assert.equal(response.status, 401);
  });

  it('rejects profile writes from a disallowed origin', async () => {
    const app = createApp({
      authApiUrl: 'https://auth.test.invalid/login',
      jwtSecret: testSecret,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      profiles: makeProfileRepository(),
      allowedOrigins: ['http://client.test'],
      secureCookies: false,
    });
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'E12345', password: 'correct-password' });

    const response = await request(app)
      .post('/api/profile')
      .set('Origin', 'https://untrusted.test')
      .set('Cookie', cookiePair(login, 'dpdp_profile_setup'))
      .send({
        ecode: 'E12345',
        fullname: 'Taylor Example',
        officeEmail: 'taylor@example.test',
        phonenumber: '+15550101234',
      });

    assert.equal(response.status, 403);
  });
});
*/
