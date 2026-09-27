import { describe, expect, it } from 'vitest';
import { PER_PAGE, pageCount, pageLetter, pageOf, parseCode, selectionCode } from './strips.ts';

describe('title-strip selection codes', () => {
  it('numbers eight selections per letter, skipping I and O', () => {
    expect(PER_PAGE).toBe(8);
    expect([0, 1, 7, 8, 15, 16].map(selectionCode)).toEqual(['A1', 'A2', 'A8', 'B1', 'B8', 'C1']);
    const letters = Array.from({ length: 24 }, (_, p) => pageLetter(p)).join('');
    expect(letters).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(letters).not.toMatch(/[IO]/);
  });

  it('keeps going past Z with two letters', () => {
    expect(pageLetter(23)).toBe('Z');
    expect(pageLetter(24)).toBe('AA');
    expect(pageLetter(25)).toBe('AB');
    expect(pageLetter(24 + 24)).toBe('BA');
    expect(selectionCode(24 * 8)).toBe('AA1');
  });

  it('pages: at least one, and the page a catalogue index sits on', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(7)).toBe(1);
    expect(pageCount(8)).toBe(1);
    expect(pageCount(9)).toBe(2);
    expect(pageOf(0)).toBe(0);
    expect(pageOf(7)).toBe(0);
    expect(pageOf(8)).toBe(1);
    expect(pageOf(-3)).toBe(0);
  });

  it('parses a typed code back to its catalogue index (and only codes that exist)', () => {
    for (let i = 0; i < 400; i++) expect(parseCode(selectionCode(i), 400)).toBe(i);
    expect(parseCode('b3', 20)).toBe(10);
    expect(parseCode(' A1 ', 1)).toBe(0);
    expect(parseCode('A2', 1)).toBeNull(); // past the end of the catalogue
    expect(parseCode('A9', 99)).toBeNull(); // eight per letter
    expect(parseCode('A0', 99)).toBeNull();
    expect(parseCode('I1', 99)).toBeNull(); // no I or O
    expect(parseCode('O1', 99)).toBeNull();
    expect(parseCode('', 99)).toBeNull();
    expect(parseCode('1A', 99)).toBeNull();
  });
});
