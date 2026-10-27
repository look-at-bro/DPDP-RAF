import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { readSheet } from 'read-excel-file/node';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { basename, extname, resolve, sep } from 'node:path';
import { initializeDatabase } from './db/initializeDatabase.js';
import * as profileRepository from './repositories/profileRepository.js';
import appLogger from './utils/logger.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32).refine((value) => value !== '-'),
  password: z.string().min(1).max(256)
    .refine((value) => value.trim().length > 0 && value.trim() !== '-'),
}).strict();

const profileSchema = z.object({
  fullname: z.string().trim().min(2).max(150),
  officeEmail: z.string().trim().email().max(254)
    .transform((value) => value.toLowerCase()),
  phonenumber: z.string().trim().min(7).max(32)
    .regex(/^\+?[0-9().\-\s]+$/, 'Enter a valid phone number.'),
}).strict();

const adminProvisionProfileSchema = profileSchema.extend({
  ecode: z.string().trim().min(1).max(32).refine((value) => value !== '-').transform((value) => value.toUpperCase()),
}).strict();

const permissionRecordSchema = z.object({
  permission: z.string().trim().min(2).max(64),
  wbsCode: z.string().trim().min(1).max(64),
  clientName: z.string().trim().min(1).max(200),
  lobName: z.string().trim().min(1).max(150),
  riskAcceptanceConfirmed: z.literal('true'),
}).strict();

const adminDirectoryQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

const adminRoleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(3).max(500),
}).strict();

const PROFILE_SETUP_COOKIE = 'dpdp_profile_setup';
const ACCESS_TOKEN_COOKIE = 'dpdp_access_token';
const TOKEN_ISSUER = 'dpdp-raf';
const PROFILE_SETUP_AUDIENCE = 'dpdp-profile-setup';
const APP_AUDIENCE = 'dpdp-app';
const PROOF_UPLOAD_DIR = resolve(
  process.env.PROOF_UPLOAD_DIR || resolve(process.cwd(), 'private-uploads', 'permission-proofs'),
);
const MAX_PROOF_FILE_BYTES = Number(process.env.PROOF_UPLOAD_MAX_BYTES) || 10 * 1024 * 1024;
const MAX_EMPLOYEE_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EMPLOYEE_IMPORT_ROWS = 500;
const employeeImportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const proofMimeTypes = new Map([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword', 'application/octet-stream']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']],
  ['.eml', ['message/rfc822', 'application/octet-stream']],
  ['.msg', ['application/vnd.ms-outlook', 'application/octet-stream']],
  ['.txt', ['text/plain']],
]);

const proxySubnetAliases = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustedProxySubnet(value) {
  if (proxySubnetAliases.has(value.toLowerCase())) return true;

  const [address, prefix, ...extra] = value.split('/');
  const version = isIP(address);
  if (!version || extra.length > 0) return false;
  if (prefix === undefined) return true;

  const maxPrefix = version === 4 ? 32 : 128;
  return /^\d+$/.test(prefix) && Number(prefix) <= maxPrefix;
}

function normalizeTrustProxy(value) {
  if (value === undefined || value === false) return false;
  if (typeof value !== 'string') {
    throw new Error('TRUST_PROXY must be false or a trusted proxy IP/subnet list.');
  }

  const setting = value.trim();
  if (!setting || setting.toLowerCase() === 'false') return false;
  if (setting.toLowerCase() === 'true') {
    throw new Error('TRUST_PROXY=true is unsafe; configure trusted proxy IP addresses or CIDR subnets instead.');
  }

  const proxies = setting.split(',').map((proxy) => proxy.trim());
  if (proxies.some((proxy) => !proxy || !isTrustedProxySubnet(proxy))) {
    throw new Error('TRUST_PROXY must contain valid IP addresses, CIDR subnets, or loopback/linklocal/uniquelocal aliases.');
  }
  return proxies.length === 1 ? proxies[0] : proxies;
}

function createProofUpload(uploadDirectory, maxFileBytes) {
  return multer({
    storage: multer.diskStorage({
      destination(_req, _file, callback) {
        mkdir(uploadDirectory, { recursive: true, mode: 0o700 })
          .then(() => callback(null, uploadDirectory))
          .catch(callback);
      },
      filename(_req, file, callback) {
        callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: maxFileBytes, files: 1, fields: 8, fieldSize: 2048 },
    fileFilter(_req, file, callback) {
      const extension = extname(file.originalname).toLowerCase();
      const acceptedTypes = proofMimeTypes.get(extension);
      if (!acceptedTypes || !acceptedTypes.includes(file.mimetype)) {
        callback(new Error('Upload a PDF, Word document, or email file with a supported file type.'));
        return;
      }
      callback(null, true);
    },
  });
}

function publicProfile(profile, roles = []) {
  return {
    ecode: profile.ecode,
    fullname: profile.fullname,
    officeEmail: profile.officeEmail,
    phonenumber: profile.phonenumber,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    roles,
  };
}

function parseProofUpload(proofUpload) {
  return (req, res, next) => {
    proofUpload.single('proof')(req, res, (error) => {
      if (!error) return next();

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'The permission proof file is too large.' });
      }
      if (error.code && !error.code.startsWith('LIMIT_')) {
        return res.status(503).json({ success: false, message: 'Unable to store the permission proof file.' });
      }
      const message = error.code
        ? 'The upload did not match the supported file constraints.'
        : error.message;
      return res.status(400).json({ success: false, message });
    });
  };
}

function proofContentMatchesType(file, contents) {
  const extension = extname(file.originalname).toLowerCase();

  if (extension === '.pdf') return contents.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (extension === '.doc' || extension === '.msg') {
    return contents.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (extension === '.docx') {
    const archive = contents.toString('latin1');
    return contents.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      && archive.includes('[Content_Types].xml')
      && archive.includes('word/document.xml');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch {
    return false;
  }

  if (extension === '.eml') {
    return /^(from|to|subject|date|message-id):\s*.+/im.test(text)
      && /\r?\n\r?\n/.test(text);
  }
  if (extension === '.txt') return !text.includes('\0');
  return false;
}

async function validateProofContent(req, res, next) {
  if (!req.file) return next();

  let contents;
  try {
    contents = await readFile(req.file.path);
  } catch {
    await unlink(req.file.path).catch(() => {});
    return res.status(500).json({ success: false, message: 'Unable to verify the permission proof file.' });
  }

  if (!proofContentMatchesType(req.file, contents)) {
    await unlink(req.file.path).catch(() => {});
    return res.status(400).json({
      success: false,
      message: 'The permission proof file contents do not match its declared type.',
    });
  }
  return next();
}

function messageFromPayload(payload, fallback) {
  if (payload && typeof payload === 'object' && typeof payload.message === 'string') {
    return payload.message;
  }
  return fallback;
}

async function readResponsePayload(response) {
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function createApp({
  logger = appLogger,
  authApiUrl = process.env.AUTH_API_URL,
  jwtSecret = process.env.JWT_SECRET,
  fetchImpl = fetch,
  profiles = profileRepository,
  allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  secureCookies = process.env.NODE_ENV === 'production',
  trustProxy = process.env.TRUST_PROXY,
  apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX) || 300,
  proofUploadDir = PROOF_UPLOAD_DIR,
} = {}) {
  const app = express();
  const resolvedProofUploadDir = resolve(proofUploadDir);
  const proofUpload = createProofUpload(resolvedProofUploadDir, MAX_PROOF_FILE_BYTES);
  const handleProofUpload = parseProofUpload(proofUpload);
  const profileSetupTtlSeconds = Number(process.env.PROFILE_SETUP_TTL_SECONDS) || 600;
  const accessTtlSeconds = Number(process.env.JWT_ACCESS_TTL_SECONDS) || 900;

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const record = {
        requestId,
        method: req.method,
        path: typeof req.route?.path === 'string' ? req.route.path : '/unmatched',
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      };
      const logRequest = res.statusCode >= 500 ? logger.error
        : res.statusCode >= 400 ? logger.warn
          : logger.info;
      logRequest.call(logger, record, 'http_request_completed');
    });
    next();
  });

  app.set('trust proxy', normalizeTrustProxy(trustProxy));
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '16kb' }));
  app.use(cookieParser());

  const loginLimiter = rateLimit({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 900000,
    limit: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Try again later.' },
  });

  const apiLimiter = rateLimit({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 900000,
    limit: apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many API requests. Try again later.' },
  });
  app.use('/api', apiLimiter);

  function signToken(ecode, audience, expiresIn) {
    if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
      throw new Error('JWT_SECRET must contain at least 32 characters.');
    }
    return jwt.sign({ ecode }, jwtSecret, {
      algorithm: 'HS256',
      audience,
      issuer: TOKEN_ISSUER,
      expiresIn,
    });
  }

  function cookieOptions(path, maxAge) {
    return {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path,
      maxAge,
    };
  }

  async function writeAuditEvent(req, {
    eventType,
    outcome = 'SUCCESS',
    actorEcode = null,
    subjectEcode = null,
    details = null,
  }) {
    try {
      await profiles.recordApplicationAuditEvent({
        requestId: req.requestId,
        actorEcode,
        subjectEcode,
        eventType,
        outcome,
        details,
      });
    } catch (error) {
      logger.error({
        requestId: req.requestId,
        eventType,
        errorName: error.name,
        errorCode: error.number,
      }, 'application_audit_event_write_failed');
    }
  }

  function requireAccessToken(req, res, next) {
    const token = req.cookies[ACCESS_TOKEN_COOKIE];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Sign in is required.' });
    }

    try {
      req.auth = jwt.verify(token, jwtSecret, {
        algorithms: ['HS256'],
        audience: APP_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });
      return next();
    } catch {
      res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions('/api'));
      return res.status(401).json({ success: false, message: 'Your session has expired. Sign in again.' });
    }
  }

  function requireRole(...allowedRoles) {
    return async (req, res, next) => {
      try {
        const roles = await profiles.findActiveRolesByEcode(req.auth.ecode);
        req.auth.roles = roles;
        if (!allowedRoles.some((role) => roles.includes(role))) {
          return res.status(403).json({ success: false, message: 'Administrator access is required.' });
        }
        return next();
      } catch {
        return res.status(500).json({ success: false, message: 'Unable to verify administrator access.' });
      }
    };
  }

  function requireAllowedOrigin(req, res, next) {
    const origin = req.get('Origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ success: false, message: 'Request origin is not allowed.' });
    }
    return next();
  }

  function requireProfileSetup(req, res, next) {
    const setupToken = req.cookies[PROFILE_SETUP_COOKIE];
    if (!setupToken) {
      return res.status(401).json({ success: false, message: 'Sign in before submitting your profile.' });
    }

    try {
      req.setupEcode = jwt.verify(setupToken, jwtSecret, {
        algorithms: ['HS256'],
        audience: PROFILE_SETUP_AUDIENCE,
        issuer: TOKEN_ISSUER,
      }).ecode;
      return next();
    } catch {
      res.clearCookie(PROFILE_SETUP_COOKIE, cookieOptions('/api/profile'));
      return res.status(401).json({ success: false, message: 'Your profile setup session has expired. Sign in again.' });
    }
  }

  app.post('/api/login', loginLimiter, async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', details: { reason: 'INVALID_INPUT' } });
      return res.status(400).json({ success: false, message: 'Enter your E-code and password.' });
    }

    let authUrl;
    try {
      authUrl = new URL(authApiUrl);
      if (authUrl.protocol !== 'https:' || authUrl.username || authUrl.password) {
        throw new Error('Invalid authentication URL.');
      }
    } catch {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', details: { reason: 'AUTH_CONFIGURATION' } });
      return res.status(503).json({ success: false, message: 'Authentication service is not configured correctly.' });
    }

    const configuredTimeout = Number(process.env.AUTH_API_TIMEOUT_MS) || 8000;
    const timeoutMs = Math.min(Math.max(configuredTimeout, 1000), 30000);

    let upstreamResponse;
    let payload;
    try {
      upstreamResponse = await fetchImpl(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(result.data),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      payload = await readResponsePayload(upstreamResponse);
    } catch (error) {
      const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
      await writeAuditEvent(req, {
        eventType: 'LOGIN',
        outcome: 'FAILURE',
        details: { reason: timedOut ? 'AUTH_TIMEOUT' : 'AUTH_UNAVAILABLE' },
      });
      return res.status(timedOut ? 504 : 502).json({
        success: false,
        message: timedOut ? 'Authentication service timed out.' : 'Could not reach the authentication service.',
      });
    }

    if (!upstreamResponse.ok) {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', details: { reason: 'AUTH_REJECTED' } });
      return res.status(upstreamResponse.status).json({
        success: false,
        upstreamStatus: upstreamResponse.status,
        message: messageFromPayload(payload, `Authentication failed (HTTP ${upstreamResponse.status}).`),
      });
    }

    const ecode = typeof payload?.ecode === 'string' && payload.ecode.trim()
      ? payload.ecode.trim()
      : result.data.username;
    if (ecode.toUpperCase() !== result.data.username.toUpperCase()) {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', details: { reason: 'IDENTITY_MISMATCH' } });
      return res.status(401).json({ success: false, message: 'The authenticated E-code does not match the sign-in identity.' });
    }

    let existingProfile;
    try {
      existingProfile = await profiles.findProfileByEcode(ecode);
    } catch {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', details: { reason: 'PROFILE_LOOKUP_FAILED' } });
      return res.status(500).json({ success: false, message: 'Unable to check the user profile.' });
    }

    if (existingProfile) {
      let roles;
      try {
        roles = await profiles.findActiveRolesByEcode(existingProfile.ecode);
      } catch {
        await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', subjectEcode: ecode, details: { reason: 'ROLE_LOOKUP_FAILED' } });
        return res.status(500).json({ success: false, message: 'Unable to verify account access.' });
      }

      let accessToken;
      try {
        accessToken = signToken(existingProfile.ecode, APP_AUDIENCE, accessTtlSeconds);
      } catch {
        await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', subjectEcode: ecode, details: { reason: 'TOKEN_SIGNING_FAILED' } });
        return res.status(503).json({ success: false, message: 'Token signing is not configured.' });
      }

      await writeAuditEvent(req, {
        eventType: 'LOGIN',
        actorEcode: ecode,
        subjectEcode: ecode,
        details: { nextStep: 'APPLICATION' },
      });
      res.cookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions('/api', accessTtlSeconds * 1000));
      return res.json({
        success: true,
        nextStep: 'APPLICATION',
        user: publicProfile(existingProfile, roles),
      });
    }

    let setupToken;
    try {
      setupToken = signToken(ecode, PROFILE_SETUP_AUDIENCE, profileSetupTtlSeconds);
    } catch {
      await writeAuditEvent(req, { eventType: 'LOGIN', outcome: 'FAILURE', subjectEcode: ecode, details: { reason: 'TOKEN_SIGNING_FAILED' } });
      return res.status(503).json({ success: false, message: 'Token signing is not configured.' });
    }

    await writeAuditEvent(req, {
      eventType: 'LOGIN',
      actorEcode: ecode,
      subjectEcode: ecode,
      details: { nextStep: 'PROFILE_REQUIRED' },
    });
    res.cookie(
      PROFILE_SETUP_COOKIE,
      setupToken,
      cookieOptions('/api/profile', profileSetupTtlSeconds * 1000),
    );
    return res.json({ success: true, nextStep: 'PROFILE_REQUIRED', ecode });
  });

  app.post('/api/profile', requireAllowedOrigin, requireProfileSetup, async (req, res) => {
    const result = profileSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Check the profile fields and try again.' });
    }

    let accessToken;
    try {
      accessToken = signToken(req.setupEcode, APP_AUDIENCE, accessTtlSeconds);
    } catch {
      return res.status(503).json({ success: false, message: 'Token signing is not configured.' });
    }

    let profile;
    try {
      profile = await profiles.registerProfile({ profile: { ...result.data, ecode: req.setupEcode } });
    } catch (error) {
      if (error.number === 2601 || error.number === 2627) {
        await writeAuditEvent(req, {
          eventType: 'PROFILE_CREATE',
          outcome: 'FAILURE',
          actorEcode: req.setupEcode,
          subjectEcode: req.setupEcode,
          details: { source: 'SELF_SERVICE', reason: 'DUPLICATE_PROFILE_DATA' },
        });
        return res.status(409).json({ success: false, message: 'That office email is already registered.' });
      }
      logger.error({ requestId: req.requestId, errorName: error.name, errorCode: error.number }, 'profile_registration_database_write_failed');
      return res.status(500).json({ success: false, message: 'Unable to save the profile.' });
    }

    await writeAuditEvent(req, {
      eventType: 'PROFILE_CREATE',
      actorEcode: req.setupEcode,
      subjectEcode: req.setupEcode,
      details: { source: 'SELF_SERVICE' },
    });
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions('/api', accessTtlSeconds * 1000));
    res.clearCookie(PROFILE_SETUP_COOKIE, cookieOptions('/api/profile'));
    return res.json({ success: true, user: publicProfile(profile) });
  });

  app.put('/api/profile', requireAllowedOrigin, requireAccessToken, async (req, res) => {
    const result = profileSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Check the profile fields and try again.' });
    }

    try {
      const profile = await profiles.updateProfile({ ...result.data, ecode: req.auth.ecode });
      if (!profile) return res.status(404).json({ success: false, message: 'Profile not found.' });
      const roles = await profiles.findActiveRolesByEcode(req.auth.ecode);
      await writeAuditEvent(req, {
        eventType: 'PROFILE_UPDATE',
        actorEcode: req.auth.ecode,
        subjectEcode: req.auth.ecode,
      });
      return res.json({ success: true, user: publicProfile(profile, roles) });
    } catch (error) {
      if (error.number === 2601 || error.number === 2627) {
        return res.status(409).json({ success: false, message: 'That office email is already registered.' });
      }
      return res.status(500).json({ success: false, message: 'Unable to save the profile.' });
    }
  });

  app.get('/api/profile/setup', (req, res) => {
    const setupToken = req.cookies[PROFILE_SETUP_COOKIE];
    if (!setupToken) {
      return res.status(401).json({ success: false, message: 'Sign in before completing your profile.' });
    }

    try {
      const setup = jwt.verify(setupToken, jwtSecret, {
        algorithms: ['HS256'],
        audience: PROFILE_SETUP_AUDIENCE,
        issuer: TOKEN_ISSUER,
      });
      return res.json({ success: true, ecode: setup.ecode });
    } catch {
      res.clearCookie(PROFILE_SETUP_COOKIE, cookieOptions('/api/profile'));
      return res.status(401).json({ success: false, message: 'Your profile setup session has expired. Sign in again.' });
    }
  });

  app.get('/api/me', requireAccessToken, async (req, res) => {
    try {
      const profile = await profiles.findProfileByEcode(req.auth.ecode);
      if (!profile) {
        return res.status(404).json({ success: false, message: 'Profile not found.' });
      }
      const roles = await profiles.findActiveRolesByEcode(req.auth.ecode);
      return res.json({ success: true, user: publicProfile(profile, roles) });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to load the profile.' });
    }
  });

  app.get('/api/permissions', requireAccessToken, async (req, res) => {
    try {
      const permissions = await profiles.findPermissionsByEcode(req.auth.ecode);
      return res.json({ success: true, permissions });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to load the permission details.' });
    }
  });

  app.post('/api/permissions', requireAllowedOrigin, requireAccessToken, handleProofUpload, validateProofContent, async (req, res) => {
    if (req.body.riskAcceptanceConfirmed !== 'true') {
      if (req.file) await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: 'Acknowledge the permission risks before submitting.' });
    }
    const result = permissionRecordSchema.safeParse(req.body);
    if (!result.success) {
      if (req.file) await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ success: false, message: 'Check the approval details and try again.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Upload the approval document to submit your request.' });
    }

    try {
      const permission = await profiles.addPermission({
        ecode: req.auth.ecode,
        ...result.data,
        proof: { filePath: req.file.filename, contentType: req.file.mimetype, originalFilename: req.file.originalname },
      });
      return res.status(201).json({ success: true, permission });
    } catch (error) {
      await unlink(req.file.path).catch(() => {});
      if (error.number === 2601 || error.number === 2627) {
        return res.status(409).json({ success: false, message: 'This permission already exists for that project.' });
      }
      return res.status(500).json({ success: false, message: 'Unable to save the permission and its evidence.' });
    }
  });

  app.get('/api/admin/permissions', requireAccessToken, requireRole('ADMIN', 'ADMIN_MANAGER'), async (req, res) => {
    const parsedQuery = adminDirectoryQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ success: false, message: 'Enter at least two characters to search by client or WBS code.' });
    }

    try {
      const directory = await profiles.searchPermissionDirectory({
        term: parsedQuery.data.q,
        page: parsedQuery.data.page,
        pageSize: 50,
      });
      return res.json({ success: true, ...directory });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to search the permission directory.' });
    }
  });

  app.get('/api/admin/admins', requireAccessToken, requireRole('ADMIN', 'ADMIN_MANAGER'), async (_req, res) => {
    try {
      const admins = await profiles.findAdmins();
      return res.json({ success: true, admins });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to load administrator accounts.' });
    }
  });

  app.post('/api/admin/users', requireAllowedOrigin, requireAccessToken, requireRole('ADMIN_MANAGER'), async (req, res) => {
    const result = adminProvisionProfileSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ success: false, message: 'Check the E-code, name, office email, and phone number.' });
    }

    try {
      const profile = await profiles.registerProfile({ profile: result.data });
      await writeAuditEvent(req, {
        eventType: 'PROFILE_CREATE',
        actorEcode: req.auth.ecode,
        subjectEcode: profile.ecode,
        details: { source: 'ADMIN_SINGLE' },
      });
      return res.status(201).json({ success: true, user: publicProfile(profile) });
    } catch (error) {
      if (isDuplicateProfileError(error)) {
        await writeAuditEvent(req, {
          eventType: 'PROFILE_CREATE',
          outcome: 'FAILURE',
          actorEcode: req.auth.ecode,
          subjectEcode: result.data.ecode,
          details: { source: 'ADMIN_SINGLE', reason: 'DUPLICATE_PROFILE_DATA' },
        });
        return res.status(409).json({ success: false, message: 'That E-code or office email is already registered.' });
      }
      return res.status(500).json({ success: false, message: 'Unable to create the employee profile.' });
    }
  });

  app.post('/api/admin/users/import', requireAllowedOrigin, requireAccessToken, requireRole('ADMIN_MANAGER'), parseEmployeeImport, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Choose an .xlsx employee spreadsheet.' });
    }

    let rows;
    try {
      rows = await readSheet(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, message: 'Could not read the spreadsheet. Upload a valid .xlsx file.' });
    }

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'The spreadsheet is empty.' });
    }

    const headerIndexes = new Map(rows[0].map((header, index) => [normalizeSpreadsheetHeader(header), index]));
    const requiredHeaders = ['ecode', 'fullname', 'officeemail', 'phonenumber'];
    const missingHeaders = requiredHeaders.filter((header) => !headerIndexes.has(header));
    if (missingHeaders.length) {
      return res.status(400).json({
        success: false,
        message: 'The first row must contain Ecode, Full name, Office email, and Phone number columns.',
      });
    }

    const employeeRows = rows.slice(1).filter((row) => row.some((cell) => spreadsheetCellText(cell)));
    if (!employeeRows.length) {
      return res.status(400).json({ success: false, message: 'The spreadsheet contains no employee rows.' });
    }
    if (employeeRows.length > MAX_EMPLOYEE_IMPORT_ROWS) {
      return res.status(400).json({ success: false, message: `Import no more than ${MAX_EMPLOYEE_IMPORT_ROWS} employees at a time.` });
    }

    const seenEcodes = new Set();
    const seenEmails = new Set();
    const results = [];

    for (const [index, row] of employeeRows.entries()) {
      const rowNumber = index + 2;
      const profileInput = {
        ecode: spreadsheetCellText(row[headerIndexes.get('ecode')]),
        fullname: spreadsheetCellText(row[headerIndexes.get('fullname')]),
        officeEmail: spreadsheetCellText(row[headerIndexes.get('officeemail')]),
        phonenumber: spreadsheetCellText(row[headerIndexes.get('phonenumber')]),
      };
      const result = adminProvisionProfileSchema.safeParse(profileInput);
      if (!result.success) {
        results.push({ row: rowNumber, ecode: profileInput.ecode || null, status: 'skipped', message: 'Check the required employee fields.' });
        continue;
      }

      const normalizedEcode = result.data.ecode.toUpperCase();
      const normalizedEmail = result.data.officeEmail.toLowerCase();
      if (seenEcodes.has(normalizedEcode) || seenEmails.has(normalizedEmail)) {
        results.push({ row: rowNumber, ecode: result.data.ecode, status: 'skipped', message: 'Duplicate E-code or office email in this spreadsheet.' });
        continue;
      }
      seenEcodes.add(normalizedEcode);
      seenEmails.add(normalizedEmail);

      try {
        await profiles.registerProfile({ profile: result.data });
        results.push({ row: rowNumber, ecode: result.data.ecode, status: 'created' });
        await writeAuditEvent(req, {
          eventType: 'PROFILE_CREATE',
          actorEcode: req.auth.ecode,
          subjectEcode: result.data.ecode,
          details: { source: 'ADMIN_BULK', row: rowNumber },
        });
      } catch (error) {
        if (isDuplicateProfileError(error)) {
          results.push({ row: rowNumber, ecode: result.data.ecode, status: 'skipped', message: 'E-code or office email already exists.' });
          continue;
        }
        const createdCount = results.filter((item) => item.status === 'created').length;
        const skippedCount = results.filter((item) => item.status === 'skipped').length;
        await writeAuditEvent(req, {
          eventType: 'PROFILE_BULK_IMPORT',
          outcome: createdCount > 0 ? 'PARTIAL' : 'FAILURE',
          actorEcode: req.auth.ecode,
          details: { rowCount: results.length, createdCount, skippedCount, stoppedAtRow: rowNumber },
        });
        return res.status(500).json({
          success: false,
          message: `Import stopped at row ${rowNumber}. ${createdCount} profiles were created; existing profiles were not overwritten.`,
          createdCount,
          skippedCount,
          results,
        });
      }
    }

    const createdCount = results.filter((item) => item.status === 'created').length;
    const skippedCount = results.length - createdCount;
    await writeAuditEvent(req, {
      eventType: 'PROFILE_BULK_IMPORT',
      outcome: skippedCount > 0 ? 'PARTIAL' : 'SUCCESS',
      actorEcode: req.auth.ecode,
      details: { rowCount: results.length, createdCount, skippedCount },
    });
    return res.json({
      success: true,
      createdCount,
      skippedCount,
      results,
    });
  });

  app.put('/api/admin/admins/:ecode', requireAllowedOrigin, requireAccessToken, requireRole('ADMIN_MANAGER'), async (req, res) => {
    const targetEcode = z.string().trim().min(1).max(32).safeParse(req.params.ecode);
    const result = adminRoleSchema.safeParse(req.body);
    if (!targetEcode.success || !result.success) {
      return res.status(400).json({ success: false, message: 'Provide a valid E-code, role action, and reason.' });
    }
    if (!result.data.enabled && targetEcode.data === req.auth.ecode) {
      return res.status(400).json({ success: false, message: 'You cannot remove your own admin role.' });
    }

    try {
      const change = await profiles.changeAdminRole({
        ecode: targetEcode.data,
        actorEcode: req.auth.ecode,
        enabled: result.data.enabled,
        reason: result.data.reason,
      });
      if (!change) return res.status(404).json({ success: false, message: 'User profile not found.' });
      return res.json({ success: true, change });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to update the administrator role.' });
    }
  });

  app.get('/api/admin/evidence/:proofId', requireAccessToken, requireRole('ADMIN', 'ADMIN_MANAGER'), async (req, res) => {
    const proofId = Number(req.params.proofId);
    if (!Number.isSafeInteger(proofId) || proofId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid evidence identifier.' });
    }

    try {
      const proof = await profiles.findProofById(proofId);
      if (!proof || basename(proof.filePath) !== proof.filePath) {
        return res.status(404).json({ success: false, message: 'Evidence file not found.' });
      }

      const filePath = resolve(resolvedProofUploadDir, proof.filePath);
      if (!filePath.startsWith(`${resolvedProofUploadDir}${sep}`)) {
        return res.status(404).json({ success: false, message: 'Evidence file not found.' });
      }

      await profiles.recordEvidenceAccess({ proofId, actorEcode: req.auth.ecode });
      const safeFilename = proof.originalFilename.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 180) || 'permission-evidence';
      const disposition = proof.contentType === 'application/pdf' ? 'inline' : 'attachment';
      return res.sendFile(filePath, {
        headers: {
          'Content-Type': proof.contentType,
          'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      }, (error) => {
        if (error && !res.headersSent) {
          res.status(error.code === 'ENOENT' ? 404 : 500).json({
            success: false,
            message: error.code === 'ENOENT' ? 'Evidence file not found.' : 'Unable to open the evidence file.',
          });
        }
      });
    } catch {
      return res.status(500).json({ success: false, message: 'Unable to load the evidence file.' });
    }
  });

  app.post('/api/logout', requireAllowedOrigin, async (req, res) => {
    const actorEcode = (() => {
      try {
        return jwt.verify(req.cookies[ACCESS_TOKEN_COOKIE], jwtSecret, {
          algorithms: ['HS256'],
          audience: APP_AUDIENCE,
          issuer: TOKEN_ISSUER,
        }).ecode;
      } catch {
        return null;
      }
    })();
    await writeAuditEvent(req, { eventType: 'LOGOUT', actorEcode, subjectEcode: actorEcode });
    res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions('/api'));
    res.clearCookie(PROFILE_SETUP_COOKIE, cookieOptions('/api/profile'));
    return res.json({ success: true });
  });

  return app;
}

const app = createApp();
export default app;

function validateStartupConfiguration() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 5000;

  try {
    validateStartupConfiguration();
    await initializeDatabase();
    app.listen(port, host, () => {
      appLogger.info({ host, port }, 'api_listening');
    });
  } catch (error) {
    appLogger.fatal({ errorName: error.name, errorCode: error.code }, 'server_startup_failed');
    process.exitCode = 1;
  }
}

const employeeImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EMPLOYEE_IMPORT_BYTES, files: 1, fields: 0 },
  fileFilter(_req, file, callback) {
    if (extname(file.originalname).toLowerCase() !== '.xlsx'
      || ![employeeImportMimeType, 'application/octet-stream'].includes(file.mimetype)) {
      callback(new Error('Choose an .xlsx employee spreadsheet.'));
      return;
    }
    callback(null, true);
  },
});

function parseEmployeeImport(req, res, next) {
  employeeImportUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'The spreadsheet must be 5 MB or smaller.' });
    }
    return res.status(400).json({ success: false, message: error.message || 'The spreadsheet upload is invalid.' });
  });
}

function normalizeSpreadsheetHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

function spreadsheetCellText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isDuplicateProfileError(error) {
  return error.number === 2601 || error.number === 2627;
}