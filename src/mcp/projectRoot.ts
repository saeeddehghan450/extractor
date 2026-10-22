/**
 * projectRoot.ts
 *
 * MCP clients start the server from their own working directory. config.json and output/ are
 * resolved against the working directory, so move to the project root first (this module must
 * be the first import of the entry point). Set EXTRACTOR_KEEP_CWD=1 to keep the caller's directory.
 */

import path from 'path';

if (!process.env.EXTRACTOR_KEEP_CWD) {
  // src/mcp and dist/mcp are both two levels below the project root
  process.chdir(path.resolve(__dirname, '..', '..'));
}
