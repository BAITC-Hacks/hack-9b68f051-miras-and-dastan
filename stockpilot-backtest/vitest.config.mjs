import { defineConfig } from 'vitest/config';
// The parent app's Vitest must not discover a second runner's tests automatically.
export default defineConfig({ test: { include: ['tests/**/*.checks.ts'] } });
