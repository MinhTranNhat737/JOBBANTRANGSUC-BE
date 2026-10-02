const tests = [
  ['BE health', 'http://localhost:3001/api/health', false],
  ['BE products', 'http://localhost:3001/api/products?limit=1', false],
  ['BE categories', 'http://localhost:3001/api/categories', false],
  ['BE brands', 'http://localhost:3001/api/brands', false],
  ['BE customers', 'http://localhost:3001/api/customers?limit=2', true],
  ['BE inventory', 'http://localhost:3001/api/inventory', true],
  ['BE inventory logs', 'http://localhost:3001/api/inventory/logs?limit=2', true],
  ['BE orders', 'http://localhost:3001/api/orders?limit=2', true],
  ['BE dashboard', 'http://localhost:3001/api/dashboard/stats', true],
  ['BE auth me', 'http://localhost:3001/api/auth/me', true],
  ['BE wishlist', 'http://localhost:3001/api/wishlist', true],
  ['BE payment check', 'http://localhost:3001/api/payment/check/4789', false],
  ['FE customers proxy', 'http://localhost:3000/api/customers?limit=2', true],
  ['FE inventory proxy', 'http://localhost:3000/api/inventory', true],
  ['FE inventory logs', 'http://localhost:3000/api/inventory/logs', true],
  ['FE orders proxy', 'http://localhost:3000/api/orders?limit=2', true],
  ['FE settings API', 'http://localhost:3000/api/admin/notifications', true],
  ['FE product search', 'http://localhost:3000/api/products/search?q=chrome', false],
];

async function main() {
  const [username, password] = process.argv.slice(2);
  const login = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await login.json();
  if (!login.ok || !loginData.token) throw new Error(`Login failed (${login.status})`);

  const results = [];
  for (const [name, url, authenticated] of tests) {
    try {
      const response = await fetch(url, {
        headers: authenticated ? { Authorization: `Bearer ${loginData.token}` } : {},
      });
      const body = await response.text();
      results.push({ name, status: response.status, ok: response.ok, error: response.ok ? undefined : body.slice(0, 160) });
    } catch (error) {
      results.push({ name, status: 0, ok: false, error: error.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
