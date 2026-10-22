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

const PRODUCTS: Record<number, { name: string; price: string }[]> = {
  1: [{ name: 'Phone A', price: '$100' }, { name: 'Phone B', price: '$200' }, { name: 'Phone C, "Pro"', price: '$300' }],
  2: [{ name: 'Phone D', price: '$400' }, { name: 'Phone E', price: '$500' }, { name: 'گوشی F', price: '$600' }]
};

function productsPage(page: number): string {
  const items = (PRODUCTS[page] || []).map((p, i) => `
    <li class="product card">
      <a class="title" href="/p/${page}-${i}">${p.name}</a>
      <span class="price">${p.price}</span>
      <img src="/img/${page}-${i}.png" alt="${p.name}" width="40" height="40">
    </li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Products ${page}</title>
    <style>li.product { padding: 12px; margin: 6px; border: 1px solid #ccc; list-style: none; }</style></head>
    <body><h1>Products</h1><ul id="list">${items}</ul>
    ${page < 2 ? `<a class="next" href="/products?page=${page + 1}">Next</a>` : ''}</body></html>`;
}

export async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/products')) {
      const page = Number(new URL(req.url, 'http://x').searchParams.get('page') || 1);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(productsPage(page));
    }
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
