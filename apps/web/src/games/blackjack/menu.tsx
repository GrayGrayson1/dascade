/**
 * In-game table menu: the rules card for everyone, rule edits (next round) and
 * "end game" for the host.
 */
import { useState } from 'react';
import { BLACKJACK_MSG, type BlackjackSettings } from '@dascade/shared/games/blackjack';
import { Button, IconButton, Modal } from '@dascade/ui';
import { session } from '../../net/session.ts';
import { BlackjackSettingsPanel } from './settings.tsx';
import { rulesSummary } from './util.ts';

export function TableMenu({
  rules,
  settings,
  isHost,
  endRequested,
  compact,
}: {
  rules: BlackjackSettings;
  settings: BlackjackSettings;
  isHost: boolean;
  endRequested: boolean;
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (
    <div className="bj-menu">
      {compact ? (
        <IconButton icon="info" label="Table rules" size="sm" variant="secondary" onClick={() => setOpen(true)} />
      ) : (
        <Button variant="ghost" icon="info" onClick={() => setOpen(true)}>
          Rules
        </Button>
      )}
      {isHost ? (
        compact ? (
          <IconButton icon="flag" label={endRequested ? 'Ending after this round' : 'End game'} size="sm" variant="secondary" disabled={endRequested} onClick={() => setConfirmEnd(true)} />
        ) : (
          <Button variant="ghost" icon="flag" disabled={endRequested} onClick={() => setConfirmEnd(true)}>
            {endRequested ? 'Final round' : 'End game'}
          </Button>
        )
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="Table rules" wide>
        <ul className="bj-rules">
          {rulesSummary(rules).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {isHost ? (
          <section className="bj-menu__edit">
            <h3 className="bj-menu__heading">Change the rules</h3>
            <p className="dc-field__hint">Edits take effect when the next round opens for bets.</p>
            <BlackjackSettingsPanel settings={settings} canEdit update={(patch) => session.lobby.settings(patch as Record<string, unknown>)} />
          </section>
        ) : null}
      </Modal>

      <Modal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End the game?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </Button>
            <Button
              variant="danger"
              icon="flag"
              onClick={() => {
                session.send(BLACKJACK_MSG.end, {});
                setConfirmEnd(false);
              }}
            >
              End game
            </Button>
          </>
        }
      >
        <p>Any hand in progress is played out and paid first. Then everyone sees the final standings.</p>
      </Modal>
    </div>
  );
}
