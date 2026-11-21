// Client preview: serves client/dist with a Tauri stub, and forwards the
// stub's server_api calls to the local dev site with the demo device token.
const http = require('http'), fs = require('fs'), path = require('path');
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
const token = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'work', 'seed.json'), 'utf8')).token;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/sbapi/')) {
    const body = await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
    const up = await fetch('http://localhost:8090/api/' + url.pathname.slice(7) + url.search, {
      method: req.method, body: body || undefined,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json', 'content-type': 'application/json' },
    });
    res.writeHead(up.status, { 'content-type': 'application/json' });
    return res.end(await up.text());
  }
  if (url.pathname === '/stub.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, 'preview-stub.js'))); }
  let f = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(dist) || !fs.existsSync(f)) f = path.join(dist, 'index.html');
  let out = fs.readFileSync(f);
  if (f.endsWith('index.html')) out = out.toString().replace('<head>', '<head><script src="/stub.js"></script>');
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  res.end(out);
}).listen(8767, () => console.log('preview on 8767'));
