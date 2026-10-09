import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts', 'tests/integration/**/*.test.ts'], testTimeout: 15_000, hookTimeout: 15_000, maxWorkers: 3 },
  resolve: { alias: {
    '@meteor-flow/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url).pathname,
    '@meteor-flow/posix-fs': new URL('./packages/posix-fs/src/index.ts', import.meta.url).pathname,
  } },
});
