// Tiny local static server. No dependency installation or API credentials required.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  // Serve only public application assets; never expose .git or repository files.
  if (!(pathname === '/' || pathname === '/index.html' || pathname === '/styles.css' ||
    /^\/src\/[a-z-]+\.js$/.test(pathname))) {
    response.writeHead(404).end('Not found');
    return;
  }
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' https://data-api.binance.vision https://api.binance.com https://fapi.binance.com https://api.kraken.com " +
        "wss://data-stream.binance.vision wss://fstream.binance.com wss://ws.kraken.com; " +
        "img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  console.log('BitcornWisdom at http://' + host + ':' + port);
});
