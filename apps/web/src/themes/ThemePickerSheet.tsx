/** Quick-access theme picker (lazy chunk): a wide dialog on desktop, a bottom sheet on phones. */
import { Button, Modal } from '@dascade/ui';
import { setThemePickerOpen } from './pickerStore.ts';
import { ThemePicker } from './ThemePicker.tsx';
import { ExitHalloweenButton } from './ExitHalloween.tsx';

export default function ThemePickerSheet() {
  const close = () => setThemePickerOpen(false);
  return (
    <Modal
      open
      wide
      onClose={close}
      className="tp-sheet"
      title="Themes"
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <ExitHalloweenButton variant="panel" />
      <p className="tp-sheet__intro">
        Restyle the whole arcade. Themes are just for you — they never change a game, and other players keep their own.
      </p>
      <ThemePicker variant="sheet" label="Theme" />
    </Modal>
  );
}
