import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, RP_ID: 'arboretum.test', ORIGIN: 'https://arboretum.test' } },
      }),
    ],
    // .site/ is the built site, komorebi's own bun tests among its files: never this suite's.
    test: { setupFiles: ['./test/apply-migrations.ts'], exclude: [...configDefaults.exclude, '.site/**', '.site.tmp/**'] },
  };
});
