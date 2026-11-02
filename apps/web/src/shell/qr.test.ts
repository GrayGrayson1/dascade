import { describe, expect, it } from 'vitest';
import { correction, generate } from 'lean-qr';
import * as shellQr from './qr.tsx';
import * as showdownQr from '../games/showdown/qr.tsx';

const { joinAddressText, joinQrText } = shellQr;

describe('the lobby join QR', () => {
  it('encodes the short join link in capitals on the page’s own host', () => {
    expect(joinQrText('K7QMX', 'https://dascade.onrender.com')).toBe('HTTPS://DASCADE.ONRENDER.COM/R/K7QMX');
    expect(joinQrText('K7QMX', 'http://127.0.0.1:2712')).toBe('HTTP://127.0.0.1:2712/R/K7QMX');
  });

  it('fits version 2 (25×25) at ECC M for the live host', () => {
    const text = joinQrText('K7QMX', 'https://dascade.onrender.com');
    expect(generate(text, { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M }).size).toBe(25);
  });

  it('shows a readable address without the scheme', () => {
    expect(joinAddressText('K7QMX', 'dascade.onrender.com')).toBe('dascade.onrender.com/r/K7QMX');
  });
});

describe('Showdown keeps its QR exports (frozen contract 3)', () => {
  it('re-exports the shell helpers under the same names, plus its join ticket', () => {
    expect(showdownQr.QrCode).toBe(shellQr.QrCode);
    expect(showdownQr.joinQrText).toBe(shellQr.joinQrText);
    expect(showdownQr.copyJoinQr).toBe(shellQr.copyJoinQr);
    expect(showdownQr.joinQrPng).toBe(shellQr.joinQrPng);
    expect(showdownQr.QR_QUIET).toBe(shellQr.QR_QUIET);
    expect(typeof showdownQr.JoinTicket).toBe('function');
  });
});
