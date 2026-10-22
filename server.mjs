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
  if (!(pathname === '/' || pathname === '/index.html' || pathname === '/grid.html' || pathname === '/embed.html' || pathname === '/embed-lab.html' || pathname === '/styles.css' || pathname === '/grid.css' || pathname === '/embed.css' || pathname === '/favicon.svg' ||
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
    // The standalone embed may be framed by third-party applications.
    // The full trading desk keeps its original anti-framing policy.
    const isEmbed = pathname === '/embed.html';
    const connectPolicy = isEmbed ?
      "connect-src 'self' https: wss: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; " :
      "connect-src 'self' https://data-api.binance.vision https://api.binance.com https://fapi.binance.com https://api.kraken.com https://api.exchange.coinbase.com " +
      "wss://data-stream.binance.vision wss://fstream.binance.com wss://ws.kraken.com wss://ws-feed.exchange.coinbase.com; ";
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        connectPolicy +
        "img-src 'self' data:; object-src 'none'; base-uri 'none'" +
        (isEmbed ? '' : "; frame-ancestors 'none'")
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  console.log('BitcornWisdom at http://' + host + ':' + port);
});
