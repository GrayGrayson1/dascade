/**
 * Upper bounds for what a Zod (v4) schema can accept, computed from its definition:
 * - `nodes`: decoded values (every object, array and primitive counts 1) — what BaseGameRoom.handle()'s
 *   structural guard (`maxNodes`) counts;
 * - `bytes`: a generous bound on the msgpack-encoded size (UTF-8 strings ≤ 3 bytes per UTF-16 unit).
 * `Infinity` means the schema itself is unbounded there (an unbounded record, `unknown`, a string without
 * `.max`…); callers must bound those by other means (e.g. `maxBytes`, the settings byte cap).
 * Test-only: reads Zod internals (`_zod.def`), pinned by the tests that use it.
 */

interface Def {
  type: string;
  [key: string]: unknown;
}
type Schema = { _zod: { def: Def } };

export interface Bound {
  nodes: number;
  bytes: number;
}

const INF: Bound = { nodes: Infinity, bytes: Infinity };
const NUMBER_BYTES = 9;
const HEADER_BYTES = 5;

function maxLength(def: Def): number {
  let max = Infinity;
  for (const check of (def.checks as Array<{ _zod: { def: { check: string; maximum?: number; length?: number } } }> | undefined) ?? []) {
    const c = check._zod.def;
    if (c.check === 'max_length' && typeof c.maximum === 'number') max = Math.min(max, c.maximum);
    if (c.check === 'length_equals' && typeof c.length === 'number') max = Math.min(max, c.length);
  }
  return max;
}

function strBytes(len: number): number {
  return HEADER_BYTES + len * 3;
}

function add(a: Bound, b: Bound): Bound {
  return { nodes: a.nodes + b.nodes, bytes: a.bytes + b.bytes };
}

function max(a: Bound, b: Bound): Bound {
  return { nodes: Math.max(a.nodes, b.nodes), bytes: Math.max(a.bytes, b.bytes) };
}

export function schemaBound(schema: unknown, depth = 0): Bound {
  if (depth > 40) return INF;
  const def = (schema as Schema)._zod.def;
  const next = (s: unknown) => schemaBound(s, depth + 1);
  switch (def.type) {
    case 'string':
      return { nodes: 1, bytes: strBytes(maxLength(def)) };
    case 'number':
    case 'int':
    case 'bigint':
    case 'boolean':
    case 'null':
    case 'undefined':
    case 'nan':
    case 'date':
    case 'void':
      return { nodes: 1, bytes: NUMBER_BYTES };
    case 'literal': {
      const values = def.values as unknown[];
      const longest = Math.max(0, ...values.map((v) => (typeof v === 'string' ? v.length : 8)));
      return { nodes: 1, bytes: strBytes(longest) };
    }
    case 'enum': {
      const values = Object.values(def.entries as Record<string, unknown>);
      const longest = Math.max(0, ...values.map((v) => (typeof v === 'string' ? v.length : 8)));
      return { nodes: 1, bytes: strBytes(longest) };
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
    case 'success':
      return max({ nodes: 1, bytes: NUMBER_BYTES }, next(def.innerType));
    case 'lazy':
      return next((def.getter as () => unknown)());
    case 'pipe':
      // Input side is what arrives on the wire.
      return (def.in as Schema)._zod.def.type === 'transform' ? next(def.out) : next(def.in);
    case 'transform':
      return INF;
    case 'object': {
      let total: Bound = { nodes: 1, bytes: HEADER_BYTES };
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
        total = add(total, add({ nodes: 0, bytes: strBytes(key.length) }, next(value)));
      }
      if (def.catchall && (def.catchall as Schema)._zod.def.type !== 'never') return INF;
      return total;
    }
    case 'array': {
      const n = maxLength(def);
      const el = next(def.element);
      return { nodes: 1 + n * el.nodes, bytes: HEADER_BYTES + n * el.bytes };
    }
    case 'tuple': {
      if (def.rest) return INF;
      let total: Bound = { nodes: 1, bytes: HEADER_BYTES };
      for (const item of def.items as unknown[]) total = add(total, next(item));
      return total;
    }
    case 'union': {
      let best: Bound = { nodes: 0, bytes: 0 };
      for (const option of def.options as unknown[]) best = max(best, next(option));
      return best;
    }
    case 'intersection':
      return add(next(def.left), next(def.right));
    case 'record':
    case 'map':
    case 'set':
    case 'unknown':
    case 'any':
    case 'custom':
    default:
      return INF;
  }
}
