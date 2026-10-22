/**
 * dev.ts - `npm run dev`: the server for development next to `npm run dev:web` (Next.js dev server on
 * :3000, which proxies the API here). Its origin is allowed explicitly; everything else is as in main.ts.
 */

process.env.EXTRACTOR_ALLOWED_ORIGINS ||= 'http://localhost:3000,http://127.0.0.1:3000';

void import('./main.js');
