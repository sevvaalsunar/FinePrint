// Cypress ve elle deneme için küçük statik sunucu: http://localhost:4173/panel.html?fixture=happy
import http from 'node:http'; import { readFile } from 'node:fs/promises'; import { extname, join, normalize } from 'node:path';
const root = process.cwd(), port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (p === '/' ) p = '/panel.html';
    const buf = await readFile(join(root, p));
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(buf);
  } catch { res.writeHead(404); res.end('yok'); }
}).listen(port, () => console.log(`http://localhost:${port}/panel.html?fixture=happy`));
