import pino from 'pino';

const logger = pino({
  name: 'dpdp-raf-api',
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'password',
      '*.password',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'set-cookie',
      '*.set-cookie',
      'token',
      '*.token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;