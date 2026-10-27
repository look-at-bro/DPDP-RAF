import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

function readPort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:5000';
  const proxyUrl = new URL(proxyTarget);

  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new Error('VITE_API_PROXY_TARGET must use HTTP or HTTPS');
  }
  if (!proxyUrl.hostname || proxyUrl.username || proxyUrl.password) {
    throw new Error('VITE_API_PROXY_TARGET must not contain credentials');
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: env.VITE_DEV_HOST?.trim() || '127.0.0.1',
      port: readPort(env.VITE_DEV_PORT ?? '5173', 'VITE_DEV_PORT'),
      strictPort: false,
      proxy: {
        '/api': {
          target: proxyUrl.toString(),
          changeOrigin: false,
        },
      },
    },
  };
});
