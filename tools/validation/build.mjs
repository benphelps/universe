import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const pages = (await readdir('tools/validation')).filter(name => name.endsWith('.html'));
await build({
  base: '/',
  build: {
    outDir: '.artifacts/validation',
    emptyOutDir: true,
    rolldownOptions: { input: pages.map(name => resolve('tools/validation', name)) },
  },
});
