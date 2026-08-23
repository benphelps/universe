import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Layering rule: core/ and universe/ are pure simulation code — no rendering
 * or DOM dependencies — so they stay testable headless and runnable in workers.
 */
const FORBIDDEN_IMPORTS = [/from\s+['"]three/, /from\s+['"].*\/render\//, /from\s+['"].*\/app\//];
const FORBIDDEN_GLOBALS = [/\bdocument\./, /\bwindow\./, /\bnavigator\./];

function tsFilesUnder(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) results.push(full);
  }
  return results;
}

describe('layering', () => {
  for (const layer of ['core', 'universe']) {
    it(`${layer}/ has no rendering or DOM dependencies`, () => {
      const dir = join(SRC_DIR, layer);
      for (const file of tsFilesUnder(dir)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_GLOBALS]) {
          expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false);
        }
      }
    });
  }
});
