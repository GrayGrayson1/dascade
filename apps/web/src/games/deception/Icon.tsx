/**
 * Icon helper: the shared pixel icon set plus two DASception glyphs (skull, ghost) that exist in
 * the avatar art but not in the icon set. Decorative unless `title` is given.
 */
import type { CSSProperties } from 'react';
import { PixelArt, PixelIcon, cx, type IconName } from '@dascade/ui';

const EXTRA = {
  skull: [
    '...######...',
    '..########..',
    '.##########.',
    '.##..##..##.',
    '.#...##...#.',
    '.##..##..##.',
    '.####..####.',
    '..########..',
    '...#.#.#....',
    '...######...',
    '............',
    '............',
  ],
  ghost: [
    '....####....',
    '..########..',
    '.##########.',
    '.#..##..###.',
    '.#..##..###.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##.###.###.',
    '.#...#...#..',
  ],
} as const;

export type DxIconName = IconName | keyof typeof EXTRA;

export function Icon({
  name,
  size,
  className,
  title,
  style,
}: {
  name: DxIconName;
  size?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  if (name === 'skull' || name === 'ghost') {
    return (
      <PixelArt
        rows={EXTRA[name]}
        title={title}
        className={cx('dc-icon', className)}
        style={size !== undefined ? { width: size, height: size, ...style } : style}
      />
    );
  }
  return <PixelIcon name={name} size={size} className={className} title={title} style={style} />;
}
