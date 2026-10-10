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
