/** Quick-access theme control (palette icon) for the arcade floor HUD and the room top bar. */
import { IconButton, cx } from '@dascade/ui';
import { sfx } from '../audio/audio.ts';
import { setThemePickerOpen } from './pickerStore.ts';

export function ThemeButton({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  return (
    <IconButton
      icon="palette"
      label="Change theme"
      size={size}
      className={cx('theme-btn', className)}
      data-part="theme-button"
      onClick={() => {
        sfx('click');
        setThemePickerOpen(true);
      }}
    />
  );
}
