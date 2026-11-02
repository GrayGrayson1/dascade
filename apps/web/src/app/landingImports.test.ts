/**
 * The landing page stays light: nothing main.tsx imports statically, directly or through other
 * files, may reach net/session.ts. That module pulls in the Colyseus SDK, which loads with a room
 * (the lazy routes in App.tsx). This walks the static imports of the app's own files; `import()` and
 * `import type` (erased in the build) don't count.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const SESSION = resolve(SRC, 'net/session.ts');

/**
 * Static import / re-export specifiers of a file, without comments. `import type …` is skipped;
 * `import { type A }` is kept (verbatimModuleSyntax keeps it as an import).
 */
function staticImports(file: string): string[] {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const specs: string[] = [];
  const clause = /^\s*(?:import|export)\s+(type\s+)?[\w\s{},*$]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  for (const m of code.matchAll(clause)) if (!m[1]) specs.push(m[2]!);
  for (const m of code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]!);
  return specs;
}

/** Every app file main.tsx reaches through static imports, each with the chain that reaches it. */
function landingGraph(): Map<string, string[]> {
  const entry = resolve(SRC, 'main.tsx');
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of staticImports(file)) {
      if (!spec.startsWith('.') || !/\.(tsx?)$/.test(spec)) continue; // packages, CSS, assets
      const target = resolve(dirname(file), spec);
      if (seen.has(target) || !existsSync(target)) continue;
      seen.set(target, [...seen.get(file)!, target]);
      queue.push(target);
    }
  }
  return seen;
}

describe('the landing page bundle', () => {
  it('finds the app shell (the walk works)', () => {
    const graph = landingGraph();
    for (const file of ['app/App.tsx', 'app/store.ts', 'arcade/ArcadeFloor.tsx', 'shell/shortcuts.ts']) {
      expect(graph.has(resolve(SRC, file)), file).toBe(true);
    }
  });

  it('never statically reaches net/session.ts (the Colyseus SDK)', () => {
    const chain = landingGraph().get(SESSION);
    expect(chain?.map((f) => relative(SRC, f)).join(' → ') ?? null).toBeNull();
  });
});
