import { describe, expect, it } from 'vitest';
import { correction, generate } from 'lean-qr';
import { joinQrText } from './qr.tsx';

describe('the join QR', () => {
  it('encodes the join link in capitals (/R/CODE on the page’s own host)', () => {
    expect(joinQrText('K7QMX', 'https://dascade.onrender.com')).toBe('HTTPS://DASCADE.ONRENDER.COM/R/K7QMX');
    expect(joinQrText('K7QMX', 'http://127.0.0.1:2731')).toBe('HTTP://127.0.0.1:2731/R/K7QMX');
  });

  it('in capitals the link fits version 2 (25×25) at ECC M; in lowercase it needs version 3', () => {
    const at = (text: string) => generate(text, { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M }).size;
    expect(at(joinQrText('K7QMX', 'https://dascade.onrender.com'))).toBe(25);
    expect(at('https://dascade.onrender.com/r/K7QMX')).toBe(29);
  });
});
