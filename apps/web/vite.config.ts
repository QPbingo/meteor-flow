import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';

export default defineConfig(() => {
  const port = (value: string | undefined, fallback: number) => {
    const number = Number(value ?? fallback);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('无效开发端口');
    return number;
  };
  const devPort = port(process.env.METEOR_FLOW_DEV_PORT, 5173);
  const serverPort = port(process.env.METEOR_FLOW_SERVER_PORT, 4317);
  const devHost = `127.0.0.1:${devPort}`;
  const devOrigin = `http://${devHost}`;
  const serverHost = `127.0.0.1:${serverPort}`;
  const serverOrigin = `http://${serverHost}`;
  const allowed = (request: IncomingMessage, websocket = false) =>
    request.headers.host === devHost && request.headers['sec-fetch-site'] !== 'cross-site' &&
    (request.headers.origin === devOrigin || (!websocket && request.headers.origin === undefined && ['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '')));

  return {
    plugins: [react(), {
      name: 'meteor-flow-local-development-boundary',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (allowed(request)) return next();
          response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          response.end('拒绝非本机开发页面请求');
        });
      },
    }],
    server: {
      host: '127.0.0.1', port: devPort, strictPort: true, cors: false,
      hmr: { path: '/__vite_hmr' },
      proxy: { '^/api(?:/|$)': {
        target: serverOrigin, ws: true, changeOrigin: false,
        // Vite invokes bypass before both HTTP forwarding and WebSocket upgrade.
        // Rewrite only after validating the original browser boundary.
        bypass(request, response) {
          if (!allowed(request, !response)) {
            if (response) { response.writeHead(403); response.end(); }
            else request.socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return request.url ?? '/';
          }
          request.headers.host = serverHost;
          if (request.headers.origin === devOrigin) request.headers.origin = serverOrigin;
        },
      } },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
