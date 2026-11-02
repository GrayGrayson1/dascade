/**
 * The join QR (Production Desk, QR A) on the stage, so people watching the Teams share on a laptop
 * scan it with their phone. Phones never show it (they're in already).
 *
 * The QR itself (the encoder, the capitals-only /R/CODE link, black on white with a quiet zone) now
 * lives in shell/qr.tsx, so every lobby can show one; this file re-exports it under the same names
 * and keeps the Showdown join ticket.
 */
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { cx } from '@dascade/ui';
import { QrCode, joinQrText } from '../../shell/qr.tsx';
import { LOOK_COPY, joinAddress } from './look.ts';

export { QR_QUIET, QrCode, copyJoinQr, joinQrPng, joinQrText } from '../../shell/qr.tsx';

/**
 * The join ticket: "Scan to play", the QR, the readable link and the room code. `big` for the
 * Welcome card and the lobby (about 40 % of the stage's height), `medium` between rounds and in the
 * Join pop-up.
 */
export function JoinTicket({
  code,
  look,
  size,
  className,
}: {
  code: string;
  look: ShowdownLook;
  size: 'big' | 'medium';
  className?: string;
}) {
  if (!code) return null;
  const join = joinAddress(code);
  // Where the ticket is narrow (the Join pop-up), a long address breaks before /r/.
  const at = join.short.lastIndexOf('/r/');
  return (
    <div className={cx('sd-ticket', className)} data-size={size} data-part="showdown-join-ticket">
      <span className="sd-ticket__scan">{LOOK_COPY[look].showcase.scanToPlay}</span>
      <QrCode text={joinQrText(code)} label={`QR code for ${join.short}`} className="sd-ticket__qr" />
      <span className="sd-ticket__addr">
        {join.short.slice(0, at)}
        <wbr />
        {join.short.slice(at)}
      </span>
      <span className="sd-ticket__code" aria-label={`Room code ${code}`}>
        {code.split('').map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </span>
    </div>
  );
}
