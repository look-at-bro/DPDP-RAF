import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../apps/client/', import.meta.url));
const serverRoot = fileURLToPath(new URL('../apps/server/', import.meta.url));
const clientRequire = createRequire(new URL('../apps/client/package.json', import.meta.url));
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { parse: parseEnv } = serverRequire('dotenv');
const viteEntry = clientRequire.resolve('vite');
const viteCli = resolve(dirname(viteEntry), '../../bin/vite.js');
const networkMode = process.argv.includes('--network');

function readEnvFile(filePath) {
  return existsSync(filePath) ? parseEnv(readFileSync(filePath)) : {};
}

function getLanAddresses() {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => !address.internal && (address.family === 'IPv4' || address.family === 4))
    .map((address) => address.address);
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once('error', () => resolvePort(false));
    probe.listen(port, '0.0.0.0', () => {
      probe.close(() => resolvePort(true));
    });
  });
}

async function findNetworkPort(preferredPort) {
  const requestedPort = Number(process.env.NETWORK_DEV_PORT);
  if (process.env.NETWORK_DEV_PORT && (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535)) {
    throw new Error('NETWORK_DEV_PORT must be an integer between 1 and 65535.');
  }
  if (process.env.NETWORK_DEV_PORT) {
    if (!(await isPortAvailable(requestedPort))) {
      throw new Error(`NETWORK_DEV_PORT ${requestedPort} is already in use.`);
    }
    return requestedPort;
  }

  for (let port = preferredPort; port < Math.min(preferredPort + 100, 65536); port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('Could not find an available port for the network client.');
}

const clientEnv = readEnvFile(resolve(clientRoot, '.env'));
const serverEnv = readEnvFile(resolve(serverRoot, '.env'));
const lanAddresses = networkMode ? getLanAddresses() : [];
const networkPort = networkMode
  ? await findNetworkPort(Number(clientEnv.VITE_DEV_PORT) || 5173)
  : null;
const viteArguments = [viteCli, '--host', networkMode ? '0.0.0.0' : '127.0.0.1'];
const childServerEnv = { ...process.env };

if (networkMode) {
  viteArguments.push('--port', String(networkPort), '--strictPort');
  const configuredOrigins = (process.env.CORS_ORIGINS || serverEnv.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const networkOrigins = [
    `http://localhost:${networkPort}`,
    `http://127.0.0.1:${networkPort}`,
    ...lanAddresses.map((address) => `http://${address}:${networkPort}`),
  ];
  childServerEnv.CORS_ORIGINS = [...new Set([...configuredOrigins, ...networkOrigins])].join(',');
}

const children = [
  spawn(process.execPath, viteArguments, {
    cwd: clientRoot,
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(process.execPath, ['--watch', 'src/server.js'], {
    cwd: serverRoot,
    env: childServerEnv,
    stdio: 'inherit',
    windowsHide: true,
  }),
];

if (networkMode) {
  console.log('Network development URLs:');
  for (const address of lanAddresses) {
    console.log(`  http://${address}:${networkPort}/`);
  }
  if (lanAddresses.length === 0) console.log(`  No LAN IPv4 address found. Local URL: http://localhost:${networkPort}/`);
  console.log('The API remains on loopback and is reached through the Vite proxy.');
}

let stopping = false;

function stop(exitCode, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Failed to start a development process', error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}

process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
