const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('dist/client');
const prefix = '/zijin-mountain-traffic-map';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.rsc': 'text/x-component' };
http.createServer((req, res) => {
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (url === prefix || url.startsWith(prefix + '/')) url = url.slice(prefix.length);
    const file = path.resolve(root, '.' + (url.endsWith('/') ? url + 'index.html' : url));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400).end(); }
}).listen(4173, '127.0.0.1', () => console.log('Static preview: http://127.0.0.1:4173/zijin-mountain-traffic-map/'));
