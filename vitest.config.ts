import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const all = await readD1Migrations('./migrations');
  // The initial school (migrations 0003 and 0004) is kept out of the normal test database so most tests
  // start from an empty school; the tests that cover it apply it themselves from TEST_SEED.
  const seed = all.filter((m) => m.name.includes('initial_school'));
  const migrations = all.filter((m) => !seed.includes(m));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_SEED: seed } },
      }),
    ],
    test: { include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'] },
  };
});
