/**
 * Confirmation dialog for organizer and participant actions. Destructive / manual-override actions
 * require a typed reason (3–200 characters, written to the public audit log).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { TOURNAMENT_LIMITS } from '@dascade/shared';
import { Button, Field, Modal, TextArea } from '@dascade/ui';
import type { TournamentAck } from '@dascade/shared';

export interface ConfirmSpec {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Ask for a reason (required, 3–200 chars). */
  reason?: { label: string; placeholder?: string };
  /** Extra controls (e.g. pick the winner); `valid` gates the confirm button. */
  extra?: ReactNode;
  valid?: boolean;
  run: (reason: string) => Promise<TournamentAck>;
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  useEffect(() => {
    setReason('');
    setError(null);
    setBusy(false);
  }, [spec]);
  const trimmed = reason.trim();
  const reasonOk = !spec?.reason || (trimmed.length >= 3 && trimmed.length <= TOURNAMENT_LIMITS.reason);
  const canConfirm = Boolean(spec) && reasonOk && spec?.valid !== false && !busy;
  const confirm = async () => {
    if (!spec || !canConfirm) return;
    setBusy(true);
    setError(null);
    const ack = await spec.run(trimmed);
    setBusy(false);
    if (ack.ok) onClose();
    else setError(ack.message || 'That didn’t work. Try again.');
  };
  return (
    <Modal
      open={spec !== null}
      onClose={onClose}
      title={spec?.title ?? ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={spec?.danger ? 'danger' : 'primary'} loading={busy} disabled={!canConfirm} onClick={confirm}>
            {spec?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {spec ? (
        <form
          className="tk-confirm"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div className="tk-confirm__body">{spec.body}</div>
          {spec.extra}
          {spec.reason ? (
            <Field
              label={spec.reason.label}
              hint={`Required · shown in the tournament log · ${trimmed.length}/${TOURNAMENT_LIMITS.reason}`}
            >
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  value={reason}
                  rows={3}
                  maxLength={TOURNAMENT_LIMITS.reason}
                  placeholder={spec.reason?.placeholder ?? 'What happened?'}
                  aria-describedby={[describedBy, error ? hintId : null].filter(Boolean).join(' ') || undefined}
                  onChange={(e) => setReason(e.currentTarget.value)}
                />
              )}
            </Field>
          ) : null}
          {error ? (
            <p className="dc-field__error" role="alert" id={hintId}>
              {error}
            </p>
          ) : null}
          <button type="submit" hidden />
        </form>
      ) : null}
    </Modal>
  );
}
