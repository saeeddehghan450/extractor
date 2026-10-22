/**
 * Tiny local website used by the end-to-end tests.
 */
import http from 'http';
import { AddressInfo } from 'net';

const BIG_JS = `// app.js\n${'console.log("padding");\n'.repeat(400)}
document.getElementById('buy').addEventListener('click', () => {
  console.log('buy clicked');
  fetch('/api/data').then(r => r.json()).then(d => { document.getElementById('out').textContent = d.message; });
});
//# sourceMappingURL=app.js.map`;

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="description" content="fixture">
  <title>Fixture Shop</title>
  <link rel="stylesheet" href="/style.css">
  <style>body { font-family: sans-serif; } .x { color: red; }</style>
</head>
<body>
  <h1>Fixture Shop</h1>
  <form id="f" action="/submit" method="post"><input name="email" type="email" required><button type="button" id="buy" class="btn primary" style="padding: 4px">Buy now</button></form>
  <p id="out"></p>
  <img src="/missing.png">
  <canvas id="gl" width="100" height="50"></canvas>
  <script>
    localStorage.setItem('cart', '3 items');
    sessionStorage.setItem('visit', '1');
    document.cookie = 'theme=dark';
    console.warn('fixture warning');
    const gl = document.getElementById('gl').getContext('webgl');
    setTimeout(() => { throw new Error('fixture uncaught error'); }, 10);
  </script>
  <script src="/app.js"></script>
</body>
</html>`;

export async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    switch (req.url) {
      case '/':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Set-Cookie': 'sid=abc; HttpOnly' });
        return res.end(HTML);
      case '/style.css':
        res.writeHead(200, { 'Content-Type': 'text/css' });
        return res.end('h1 { color: rebeccapurple; } .btn { border-radius: 4px; } :root { --brand: #123456; }');
      case '/app.js':
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(BIG_JS);
      case '/api/data':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'hello from api' }));
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); })
  };
}
