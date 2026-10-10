// Test-only binding, injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

// Vite's `?raw` import: the file's text.
declare module '*?raw' {
  const text: string;
  export default text;
}

// The staging test runs against the runtime's own in-memory file system; no Node typings are installed.
declare module 'node:fs';
declare module 'node:os';
declare module 'node:path';

// Vite's file-list import: the keys are the matching paths (the guard test reads only those).
interface ImportMeta {
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
  glob(pattern: string | string[], options: { query: string; import: string; eager: true }): Record<string, unknown>;
}
