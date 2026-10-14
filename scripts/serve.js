// Minimal static server for previewing dist/ locally: `npm run preview`.
// Not meant for production; any static host can serve the dist/ folder.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT) || 4321;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  let file = path.join(DIST, path.normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) {
    response.writeHead(403).end();
    return;
  }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Preview: http://localhost:${PORT}/`);
});
