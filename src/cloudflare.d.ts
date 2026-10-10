// What `wrangler types` would emit for GlobalProps: it types `exports.default.fetch` in tests.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./index');
  }
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
  }
}
