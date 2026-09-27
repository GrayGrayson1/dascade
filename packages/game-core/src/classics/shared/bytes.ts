/**
 * Tiny little-endian byte writer/reader for compact real-time snapshots (server-simulated
 * Classics games broadcast these with `room.broadcastBytes`). Readers never throw: reading past
 * the end sets `ok = false` and returns 0, so a truncated/corrupt frame can be discarded.
 */

export class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private pos = 0;

  constructor(initial = 256) {
    this.buf = new ArrayBuffer(Math.max(16, initial));
    this.view = new DataView(this.buf);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.pos + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.pos));
    this.buf = next;
    this.view = new DataView(next);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, v & 0xff);
    this.pos += 1;
    return this;
  }

  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.pos, Math.max(-128, Math.min(127, Math.round(v))));
    this.pos += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, Math.max(0, Math.min(0xffff, Math.round(v))), true);
    this.pos += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.pos, Math.max(-32768, Math.min(32767, Math.round(v))), true);
    this.pos += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, Number.isFinite(v) ? v : 0, true);
    this.pos += 4;
    return this;
  }

  /** Fixed-point: value × scale stored as int16 (e.g. positions with 1/8 px precision). */
  fx16(v: number, scale: number): this {
    return this.i16(v * scale);
  }

  get length(): number {
    return this.pos;
  }

  /** Copy of the written bytes. */
  bytes(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.pos));
  }

  reset(): this {
    this.pos = 0;
    return this;
  }
}

export class ByteReader {
  private readonly view: DataView;
  private pos = 0;
  ok = true;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private can(n: number): boolean {
    if (this.pos + n <= this.view.byteLength) return true;
    this.ok = false;
    return false;
  }

  u8(): number {
    if (!this.can(1)) return 0;
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    if (!this.can(1)) return 0;
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    if (!this.can(2)) return 0;
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    if (!this.can(2)) return 0;
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    if (!this.can(4)) return 0;
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    if (!this.can(4)) return 0;
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    if (!this.can(4)) return 0;
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    if (!Number.isFinite(v)) {
      this.ok = false;
      return 0;
    }
    return v;
  }

  fx16(scale: number): number {
    return this.i16() / scale;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }
}
