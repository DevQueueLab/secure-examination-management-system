import { defineConfig } from 'tsup';

// Bundles our code and the workspace contracts package; every npm dependency stays external
// and is installed in the runtime image.
export default defineConfig({
  entry: { main: 'src/main.ts', seed: 'src/db/seed/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: ['@athena/shared'],
});
