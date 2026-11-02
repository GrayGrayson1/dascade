import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_TITLE } from './title.ts';

describe('APP_TITLE', () => {
  it('is the title index.html starts with', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(APP_TITLE);
  });
});
