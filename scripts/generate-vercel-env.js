// Overwrites the checked-in dev copy of assets/env.js before the Vercel
// production build runs `nx build chat-client`. Defaults to '' (same-origin
// API calls), which is correct for the single-Vercel-project setup in
// vercel.json. Set the API_URL env var on the Vercel project only if
// chat-api is ever deployed separately from chat-client again.
const fs = require('fs');
const path = require('path');

const apiUrl = process.env.API_URL ?? '';
const target = path.join(__dirname, '..', 'apps', 'chat-client', 'src', 'assets', 'env.js');

fs.writeFileSync(
  target,
  `window.__env = {\n  apiUrl: ${JSON.stringify(apiUrl)},\n};\n`
);

console.log(`Wrote ${target} with apiUrl=${JSON.stringify(apiUrl)}`);
