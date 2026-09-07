import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'sim-generation-'));
try {
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: 'tools/benchmarks/generation.ts',
      outDir: directory,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'generation.mjs' } },
    },
  });
  const child = spawn(process.execPath, [join(directory, 'generation.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
