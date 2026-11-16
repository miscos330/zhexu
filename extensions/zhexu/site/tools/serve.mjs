#!/usr/bin/env node
/**
 * Serves the showcase page on this machine, for previewing it.
 *
 *   node extensions/zhexu/site/tools/serve.mjs
 *   node extensions/zhexu/site/tools/serve.mjs --port 4173
 *
 * It serves what a deployment publishes (the page, its styles and scripts, and
 * `assets/`), and nothing else from this folder. It listens on 127.0.0.1 only.
 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const PORT = Number(option('port', process.env.PORT || 4173));

/** The file a request path stands for, or null when it is not part of the page. */
function fileFor(pathname) {
  const target = resolve(ROOT, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  const relative = target.slice(ROOT.length + 1).split(sep);
  const published =
    relative.length === 1 ? extname(relative[0]) in TYPES : relative[0] === 'assets';
  if (!published || !(extname(target) in TYPES)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

function handle(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  const file = request.method === 'GET' || request.method === 'HEAD' ? fileFor(pathname) : null;
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

// `localhost` may mean either loopback address, so listen on both. A machine without
// IPv6 only gets the first.
createServer(handle).listen(PORT, '127.0.0.1', () => {
  console.log(`Showcase page: http://localhost:${PORT}/`);
});
createServer(handle)
  .on('error', () => {})
  .listen(PORT, '::1');
