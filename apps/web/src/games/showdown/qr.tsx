/**
 * The join QR (Production Desk, QR A): the room's join link as a QR code on the stage, so people
 * watching the Teams share on a laptop scan it with their phone. Phones never show it (they're in
 * already).
 *
 *  - Drawn in this browser by a small encoder (lean-qr, MIT, no dependencies) that loads on its own,
 *    only where a QR is drawn: the stage window, the console and big screens.
 *  - The text is the link in capitals: HTTPS://DASCADE.ONRENDER.COM/R/CODE (host from the page).
 *    That's alphanumeric mode, version 2 (25×25) at error correction M, against version 3 (29×29) in
 *    lowercase: each module is about 12 % bigger in the same space. /R/ reaches the join screen
 *    (routes ignore case, and the server's fallback serves it).
 *  - Black on white with a 4-module quiet zone and no logo, in every look. The readable link and the
 *    room code always sit under it (some people won't scan, rightly).
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { cx } from '@dascade/ui';
import { LOOK_COPY, joinAddress } from './look.ts';

/** Modules of white around the code (the QR spec's quiet zone). */
export const QR_QUIET = 4;

type Encoder = typeof import('lean-qr');
let encoder: Promise<Encoder> | null = null;

/** The encoder, fetched once, the first time a QR is drawn. */
function loadEncoder(): Promise<Encoder> {
  encoder ??= import('lean-qr');
  return encoder;
}

/** What the QR encodes: the join link in capitals (a smaller code: see above). */
export function joinQrText(code: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return `${origin}/r/${code}`.toUpperCase();
}

/** The code's modules (one canvas pixel each, quiet zone included), black on white. */
async function drawModules(canvas: HTMLCanvasElement, text: string): Promise<number> {
  const { generate, correction } = await loadEncoder();
  const code = generate(text, { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M });
  code.toCanvas(canvas, { pad: QR_QUIET, on: [0, 0, 0, 255], off: [255, 255, 255, 255] });
  return code.size;
}

/** A QR code that scales with its box (CSS sizes it; the pixels stay crisp). */
export function QrCode({ text, label, className, style }: { text: string; label: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let live = true;
    void drawModules(canvas, text)
      .then(() => {
        if (live) canvas.dataset.ready = 'true';
      })
      .catch(() => {
        if (live) canvas.dataset.ready = 'failed';
      });
    return () => {
      live = false;
    };
  }, [text]);
  return <canvas ref={ref} className={cx('sd-qr', className)} role="img" aria-label={label} data-qr={text} style={style} />;
}

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

/** The QR as a PNG (for the Teams chat and the invite): `px` pixels per module, quiet zone included. */
export async function joinQrPng(code: string, px = 12): Promise<Blob> {
  const small = document.createElement('canvas');
  await drawModules(small, joinQrText(code));
  const big = document.createElement('canvas');
  big.width = small.width * px;
  big.height = small.height * px;
  const g = big.getContext('2d');
  if (!g) throw new Error('No 2D canvas');
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, big.width, big.height);
  return new Promise((resolve, reject) => big.toBlob((b) => (b ? resolve(b) : reject(new Error('No PNG'))), 'image/png'));
}

/**
 * Copies the QR image to the clipboard; where the browser can't put images there, saves the PNG
 * instead. Says which.
 */
export async function copyJoinQr(code: string): Promise<'copied' | 'saved' | 'failed'> {
  try {
    const png = joinQrPng(code);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'copied';
    }
    const url = URL.createObjectURL(await png);
    const a = document.createElement('a');
    a.href = url;
    a.download = `join-${code}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
