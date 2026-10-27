import sql from 'mssql';

let connectedPool;

export async function getPool() {
  if (connectedPool) return connectedPool;

  const required = ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing database configuration: ${missing.join(', ')}`);
  }

  const port = Number(process.env.DB_PORT || 1433);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535.');
  }

  const pool = new sql.ConnectionPool({
    server: process.env.DB_SERVER,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
    pool: {
      max: Number(process.env.DB_POOL_MAX) || 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  });

  try {
    connectedPool = await pool.connect();
    return connectedPool;
  } catch (error) {
    await pool.close().catch(() => {});
    throw error;
  }
}

export { sql };