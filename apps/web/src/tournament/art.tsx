/** Tournament Center pixel art (procedural SVG via <PixelArt>). */
import { PixelArt } from '@dascade/ui';

// k = outline, y = gold, o = shade, w = highlight ('.' = transparent).
const TROPHY = [
  '....kkkkkkkkkkkk....',
  '...kyyyyyyyyyyyyk...',
  'kkkkywwyyyyyyyyykkkk',
  'kyykywyyyyyyyyyokyyk',
  'ky.kywyyyyyyyyyok.yk',
  'ky.kyyyyyyyyyyyok.yk',
  '.kykyyyyyyyyyyyokyk.',
  '..kkyyyyyyyyyyookk..',
  '....kyyyyyyyyook....',
  '.....kyyyyyyook.....',
  '......kkyyyokk......',
  '........kyok........',
  '........kyok........',
  '.......kyyook.......',
  '.....kkkkkkkkkk.....',
  '.....kyyyyyyyok.....',
  '.....kyywwyyyok.....',
  '.....kkkkkkkkkk.....',
];

export function PixelTrophy({ className, title }: { className?: string; title?: string }) {
  return <PixelArt rows={TROPHY} className={className} title={title} />;
}

// A tiny bracket glyph for empty states.
const BRACKET = [
  'ww......',
  '.w......',
  '.www....',
  '.w.w....',
  'ww.w....',
  '...wwwyy',
  'ww.w....',
  '.w.w....',
  '.www....',
  '.w......',
  'ww......',
];

export function PixelBracket({ className }: { className?: string }) {
  return <PixelArt rows={BRACKET} className={className} />;
}
