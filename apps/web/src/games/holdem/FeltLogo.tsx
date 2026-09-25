/** Pixel-art DASCADE mark printed on the felt (5×7 glyphs + a pixel spade). */
import { PixelArt } from '@dascade/ui';

const GLYPHS: Record<string, string[]> = {
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};

const SPADE = ['...#...', '..###..', '.#####.', '#######', '#######', '.#.#.#.', '...#...'];

function word(text: string): string[] {
  const rows: string[] = Array.from({ length: 7 }, () => '');
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch]!;
    for (let r = 0; r < 7; r++) rows[r] += (i ? '.' : '') + g[r];
  });
  return rows;
}

const ROWS = (() => {
  const letters = word('DASCADE');
  return letters.map((row, r) => `${SPADE[r]}..${row}..${SPADE[r]}`);
})();

export function FeltLogo({ width }: { width: number }) {
  return (
    <div className="hd-logo" style={{ width }} aria-hidden>
      <PixelArt rows={ROWS} className="hd-logo__mark" />
      <span className="hd-logo__sub">Hold’em · No limit</span>
    </div>
  );
}
