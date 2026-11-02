/**
 * Join QR codes, for every room: the lobby's "QR" invite and Showdown's join ticket (Production
 * Desk, QR A; games/showdown/qr.tsx re-exports these). People scan the screen with their phone and
 * land in the room.
 *
 *  - Drawn in this browser by a small encoder (lean-qr, MIT, no dependencies) that loads on its own,
 *    only where a QR is drawn.
 *  - The text is the link in capitals: HTTPS://DASCADE.ONRENDER.COM/R/CODE (host from the page).
 *    That's alphanumeric mode, version 2 (25×25) at error correction M, against version 3 (29×29) in
 *    lowercase: each module is about 12 % bigger in the same space. /R/ reaches the join screen
 *    (routes ignore case, and the server's fallback serves it); a room that isn't an event room goes
 *    straight on to /room/CODE.
 *  - Black on white with a 4-module quiet zone and no logo, in every theme and look: scanners need
 *    the contrast. The readable link and the room code always sit next to it (some people won't
 *    scan, rightly).
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { cx } from '@dascade/ui';

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

/**
 * A QR code that scales with its box (CSS sizes it; the pixels stay crisp). It keeps the `sd-qr`
 * class it had in Showdown, whose stage styles size it by that name.
 */
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

/** The QR as a PNG (for a chat or an invite): `px` pixels per module, quiet zone included. */
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

/** The short, readable join address shown under a QR: host and /r/CODE, no scheme. */
export function joinAddressText(code: string, host = typeof location !== 'undefined' ? location.host : ''): string {
  return `${host}/r/${code}`;
}
