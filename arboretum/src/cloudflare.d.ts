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
    // One room per person for the remote (src/remote.ts).
    REMOTE: DurableObjectNamespace<import('./remote').RemoteRoom>;
    // WebAuthn relying party: the host, and the origin the browser reports.
    RP_ID: string;
    ORIGIN: string;
  }
}
