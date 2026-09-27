/**
 * DAStravaganza scenes: a trivia buzzer round, a network with a Glitch in it,
 * a writing contest vote, a letter-grid word hunt and a live survey reveal.
 */
import {
  banner,
  blinkOn,
  clamp,
  confetti,
  cyc,
  disc,
  drawText,
  drawTextC,
  easeOut,
  frame,
  hash,
  line,
  rect,
  smooth,
  sparkle,
  sprite,
  textWidth,
  type AttractFrame,
  type Ctx,
  type Scene,
} from '../attractKit.ts';

/** Game-show stage floor: chaser bulbs round the edge + a spotlight. */
function stage(ctx: Ctx, W: number, H: number, t: number, still: boolean, base: string, bulbOn: string, bulbOff: string): void {
  rect(ctx, 0, 0, W, H, base);
  // spotlight cone
  for (let y = 0; y < H; y++) {
    const spread = 6 + y * 0.55;
    const alpha = 0.07 * (1 - y / H);
    rect(ctx, W / 2 - spread, y, spread * 2, 1, `rgba(255,240,200,${alpha.toFixed(3)})`);
  }
  const phase = still ? 0 : Math.floor(t * 9);
  let i = 0;
  const bulb = (x: number, y: number) => {
    rect(ctx, x, y, 1, 1, (i + phase) % 3 === 0 ? bulbOn : bulbOff);
    i++;
  };
  for (let x = 1; x < W - 1; x += 3) bulb(x, 0);
  for (let y = 1; y < H - 1; y += 3) bulb(W - 1, y);
  for (let x = W - 2; x > 1; x -= 3) bulb(x, H - 1);
  for (let y = H - 2; y > 1; y -= 3) bulb(0, y);
}

// ---------------------------------------------------------------------------
// Trivia — question, four lit answers, a countdown bar, the reveal.
// ---------------------------------------------------------------------------
const TRIVIA_C = 8;
const ANSWERS = [
  { key: 'A', word: 'EARTH', color: '#ff4f81' },
  { key: 'B', word: 'VENUS', color: '#22d3ee' },
  { key: 'C', word: 'MARS', color: '#ffd23f' },
  { key: 'D', word: 'PLUTO', color: '#2de38f' },
];

export const trivia: Scene = {
  label: 'TRIVIA',
  length: TRIVIA_C,
  still: 5.4,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, TRIVIA_C);
    stage(ctx, W, H, f.t, f.still, '#1f0a14', '#ffd23f', '#4a2410');
    // question card
    const qh = Math.max(10, Math.round(H * 0.24) - Math.round(f.top * 0.5));
    const qx = 4;
    const qw = W - 8;
    const qy = Math.max(4, f.top + 2);
    rect(ctx, qx + 1, qy + 1, qw, qh, 'rgba(0,0,0,0.5)');
    rect(ctx, qx, qy, qw, qh, '#2d1030');
    frame(ctx, qx, qy, qw, qh, '#ff4f81');
    const q = textWidth('THE RED PLANET?') <= qw - 4 ? 'THE RED PLANET?' : 'RED PLANET?';
    drawTextC(ctx, q, W / 2 + 0.5, qy + Math.round((qh - 5) / 2), '#ffffff');
    // timer bar
    const answerAt = 4.2;
    const timeLeft = clamp(1 - (tt - 0.5) / (answerAt - 0.5), 0, 1);
    const ty = qy + qh + 2;
    rect(ctx, qx, ty, qw, 2, '#3a1420');
    rect(ctx, qx, ty, Math.round(qw * timeLeft), 2, timeLeft < 0.3 ? '#ff5a5f' : '#ffd23f');
    // answers 2×2
    const top = ty + 5;
    const gap = 3;
    const aw = Math.floor((qw - gap) / 2);
    const ah = Math.max(8, Math.floor((H - top - (f.hud ? 9 : 5) - gap) / 2));
    const revealed = tt > answerAt;
    const blink = blinkOn(f, tt, 5);
    ANSWERS.forEach((a, i) => {
      const x = qx + (i % 2) * (aw + gap);
      const y = top + Math.floor(i / 2) * (ah + gap);
      const correct = a.key === 'C';
      const dim = revealed && !correct;
      const pop = revealed && correct && blink;
      rect(ctx, x + 1, y + 1, aw, ah, 'rgba(0,0,0,0.5)');
      rect(ctx, x, y, aw, ah, dim ? '#2a1a22' : pop ? '#2de38f' : '#140812');
      frame(ctx, x, y, aw, ah, dim ? '#4a3040' : correct && revealed ? '#2de38f' : a.color);
      const badge = Math.min(7, ah - 2);
      rect(ctx, x + 1, y + 1, badge, ah - 2, dim ? '#4a3040' : a.color);
      drawTextC(ctx, a.key, x + 1 + badge / 2 + 0.5, y + Math.round((ah - 5) / 2), '#140812');
      if (textWidth(a.word) <= aw - badge - 4)
        drawText(ctx, a.word, x + badge + 3, y + Math.round((ah - 5) / 2), dim ? '#6a5060' : pop ? '#05301b' : '#ffffff');
    });
    // players locking in (dots under the question)
    const lockTimes = [1.1, 1.6, 2.3, 2.9, 3.4];
    lockTimes.forEach((at, i) => {
      const on = tt > at;
      rect(ctx, W - 6 - i * 3, qy + qh - 3, 2, 2, on ? '#2de38f' : '#4a2a3a');
    });
    if (revealed && tt < TRIVIA_C - 0.4) {
      const since = tt - answerAt;
      confetti(ctx, W / 2, top + ah, since, 18, W, H, 3);
      if (f.hud && since > 0.3) {
        const rise = Math.round(Math.min(1, (since - 0.3) / 0.4) * 4);
        banner(ctx, '+500', W, top + ah + gap / 2 - rise, '#ffd23f', '#1f0a14', 1);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// DASception — a ring of Sysop terminals; one of them glitches. Vote it out.
// ---------------------------------------------------------------------------
const DEC_C = 8.4;
const FACE = ['.....', '.#.#.', '.....', '#...#', '.###.'];
const NODE_COLORS = ['#22d3ee', '#a78bfa', '#2de38f', '#ffd23f', '#ff8a3d', '#38bdf8'];

export const deception: Scene = {
  label: 'DASCEPTION',
  length: DEC_C,
  still: 6.0,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, DEC_C);
    rect(ctx, 0, 0, W, H, '#07070f');
    // circuit-board floor
    for (let y = 3; y < H; y += 6) rect(ctx, 0, y, W, 1, '#0d0f1c');
    for (let x = 5; x < W; x += 9) rect(ctx, x, 0, 1, H, '#0b0d18');
    const cx = W / 2;
    const cy = H * 0.52;
    const rx = W * 0.34;
    const ry = H * 0.27;
    const n = 6;
    const glitch = 4;
    const nodes = Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as const;
    });
    // links + packets
    for (let i = 0; i < n; i++) {
      const [x0, y0] = nodes[i]!;
      for (const j of [(i + 1) % n, (i + 3) % n]) {
        if (j < i && j === (i + 3) % n) continue;
        const [x1, y1] = nodes[j]!;
        line(ctx, x0, y0, x1, y1, j === (i + 1) % n ? '#1c2748' : '#121a33');
        if (!f.still) {
          const k = cyc(f.t * 0.6 + i * 0.37 + j * 0.11, 1);
          rect(ctx, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 1, 1, i === glitch || j === glitch ? '#ff4fd8' : '#38bdf8');
        }
      }
    }
    const voteStart = 3.4;
    const ejectAt = 5.4;
    const ejected = tt > ejectAt;
    const s = W >= 120 ? 2 : 1;
    const size = 5 * s + 4;
    const glitching = !f.still && tt > 1.2 && tt < ejectAt;
    nodes.forEach(([x, y], i) => {
      const isG = i === glitch;
      const col = NODE_COLORS[i]!;
      let ox = 0;
      if (isG && glitching && hash(Math.floor(f.t * 12) + i) > 0.6) ox = hash(Math.floor(f.t * 30)) > 0.5 ? 1 : -1;
      const px = Math.round(x - size / 2) + ox;
      const py = Math.round(y - size / 2);
      if (isG && ejected) {
        const k = clamp((tt - ejectAt) / 0.5, 0, 1);
        if (k < 1)
          for (let j = 0; j < 10; j++) {
            const a = j * 0.63;
            rect(ctx, x + Math.cos(a) * k * 12, y + Math.sin(a) * k * 8, 1, 1, j % 2 ? '#ff4fd8' : '#ff5a5f');
          }
        rect(ctx, px, py, size, size, '#2a0614');
        frame(ctx, px, py, size, size, '#ff5a5f');
        sprite(ctx, ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], px + (size - 5 * s) / 2, py + (size - 5 * s) / 2, { '#': '#ff5a5f' }, s);
        return;
      }
      rect(ctx, px + 1, py + 1, size, size, 'rgba(0,0,0,0.6)');
      rect(ctx, px, py, size, size, '#0c1020');
      const tear = isG && glitching && Math.floor(f.t * 10) % 3 === 0;
      frame(ctx, px, py, size, size, tear ? '#ff4fd8' : col);
      sprite(
        ctx,
        FACE,
        px + (size - 5 * s) / 2,
        py + (size - 5 * s) / 2,
        { '#': isG && glitching && Math.floor(f.t * 6) % 4 === 0 ? '#ff4fd8' : col },
        s,
      );
      if (tear) {
        const ty = py + 1 + Math.floor(hash(Math.floor(f.t * 20)) * (size - 2));
        rect(ctx, px - 2, ty, size + 4, 1, 'rgba(255,79,216,0.8)');
      }
    });
    // votes fly to the glitch
    if (tt > voteStart && tt < ejectAt + 0.2) {
      const [gx, gy] = nodes[glitch]!;
      nodes.forEach(([x, y], i) => {
        if (i === glitch) return;
        const k = clamp((tt - voteStart - i * 0.18) / 0.7, 0, 1);
        if (k <= 0) return;
        const vx = x + (gx - x) * easeOut(k);
        const vy = y + (gy - y) * easeOut(k) - Math.sin(k * Math.PI) * 5;
        disc(ctx, vx, vy, 1, NODE_COLORS[i]!);
      });
    }
    if (f.hud) {
      const ask = textWidth('WHO IS THE GLITCH?') <= W - 4 ? 'WHO IS THE GLITCH?' : 'WHO?';
      if (ejected && tt < DEC_C - 0.4)
        banner(ctx, 'GLITCH FOUND', W, cy, blinkOn(f, tt) ? '#ff4fd8' : '#ffffff', '#07070f', W >= 130 ? 2 : 1);
      else if (tt > 1.2 && tt < voteStart + 1.4) banner(ctx, ask, W, cy, '#c4b5fd', '#000000', 1);
    }
  },
};

// ---------------------------------------------------------------------------
// DASterpiece — prompt, two anonymous answers, the hearts decide.
// ---------------------------------------------------------------------------
const MP_C = 8.2;
const HEART = ['#.#', '###', '.#.'];

function scribble(ctx: Ctx, x: number, y: number, w: number, lines: number, seed: number, color: string): void {
  for (let l = 0; l < lines; l++) {
    let cx = x;
    const end = x + w * (l === lines - 1 ? 0.55 + hash(seed + l) * 0.3 : 1);
    while (cx < end) {
      const ww = 2 + Math.floor(hash(seed * 3 + cx + l * 17) * 4);
      rect(ctx, cx, y + l * 3, Math.min(ww, end - cx), 1, color);
      cx += ww + 1;
    }
  }
}

export const masterpiece: Scene = {
  label: 'DASTERPIECE',
  length: MP_C,
  still: 5.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, MP_C);
    rect(ctx, 0, 0, W, H, '#150a1e');
    for (let y = 0; y < H; y += 5) for (let x = (y / 5) % 2 ? 0 : 2; x < W; x += 4) rect(ctx, x, y, 1, 1, '#221430');
    // prompt card
    const px = 4;
    const pw = W - 8;
    const ph = Math.max(10, Math.round(H * 0.22));
    const py = 3 + f.top;
    rect(ctx, px + 1, py + 1, pw, ph, 'rgba(0,0,0,0.5)');
    rect(ctx, px, py, pw, ph, '#ffe9a8');
    const prompt = textWidth('FINISH THE SENTENCE') <= pw - 4 ? 'FINISH THE SENTENCE' : 'FINISH IT';
    drawTextC(ctx, prompt, W / 2 + 0.5, py + Math.round((ph - 5) / 2), '#3a1d05');
    // two answer cards
    const top = py + ph + 5;
    const cw = Math.floor((W - 12) / 2);
    const ch = Math.max(12, H - top - (f.hud ? 10 : 7));
    const votesAt = 2.8;
    const winAt = 5.0;
    const cards = [
      { x: 4, from: -cw - 6, at: 0.6, seed: 3, color: '#22d3ee', votes: 2 },
      { x: 8 + cw, from: W + 4, at: 1.0, seed: 9, color: '#ff4fd8', votes: 5 },
    ];
    cards.forEach((c, i) => {
      if (tt < c.at) return;
      const k = easeOut(clamp((tt - c.at) / 0.4, 0, 1));
      const x = Math.round(c.from + (c.x - c.from) * k);
      const winner = i === 1 && tt > winAt;
      const grow = winner ? 1 : 0;
      rect(ctx, x + 1, top + 1, cw, ch, 'rgba(0,0,0,0.5)');
      rect(ctx, x - grow, top - grow, cw + grow * 2, ch + grow * 2, winner && blinkOn(f, tt, 4) ? '#ffd23f' : c.color);
      rect(ctx, x + 1, top + 1, cw - 2, ch - 2, '#fbf8ff');
      scribble(ctx, x + 3, top + 4, cw - 6, Math.max(1, Math.floor((ch - 10) / 3)), c.seed, '#4a3a5a');
      // hearts pile up
      const received = Math.max(0, Math.min(c.votes, Math.floor((tt - votesAt) / 0.3 - i * 0.5)));
      for (let v = 0; v < received; v++) sprite(ctx, HEART, x + 2 + v * 4, top + ch - 5, { '#': '#ff4f81' });
      if (winner && f.hud && tt < MP_C - 0.4) {
        const rw = Math.min(cw + 2, textWidth('WINNER') + 6);
        rect(ctx, x + cw / 2 - rw / 2, top - 4, rw, 7, '#ffd23f');
        drawTextC(ctx, 'WINNER', x + cw / 2 + 0.5, top - 3, '#3a1d05');
      }
    });
    // flying hearts
    if (tt > votesAt && tt < winAt) {
      for (let i = 0; i < 7; i++) {
        const at = votesAt + i * 0.28;
        const k = clamp((tt - at) / 0.5, 0, 1);
        if (k <= 0 || k >= 1) continue;
        const target = cards[i % 7 < 2 ? 0 : 1]!;
        const tx = target.x + cw / 2;
        const sx = W / 2 + (hash(i * 4.2) - 0.5) * W;
        sprite(ctx, HEART, sx + (tx - sx) * k - 1, H + 2 - (H + 2 - top - ch / 2) * k, { '#': '#ff4f81' });
      }
    }
    if (tt > winAt && tt < MP_C - 0.4) {
      const since = tt - winAt;
      for (let i = 0; i < 5; i++) sparkle(ctx, cards[1]!.x + hash(i + 11) * cw, top + hash(i + 17) * ch, since * 3 + i * 0.4, '#fff3b0');
    }
  },
};

// ---------------------------------------------------------------------------
// DASwords — a letter grid; a path traces PIXEL, then NEON.
// ---------------------------------------------------------------------------
const WORDS_C = 8.4;
const GRID = ['PIXN', 'TELE', 'AODO', 'RCSN'];
const FOUND: Array<{ word: string; path: Array<[number, number]>; at: number; score: number }> = [
  {
    word: 'PIXEL',
    path: [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
    ],
    at: 0.6,
    score: 5,
  },
  {
    word: 'NEON',
    path: [
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ],
    at: 3.4,
    score: 3,
  },
  {
    word: 'CODE',
    path: [
      [3, 1],
      [2, 1],
      [2, 2],
      [1, 1],
    ],
    at: 5.7,
    score: 3,
  },
];
const STEP = 0.28;

export const words: Scene = {
  label: 'DASWORDS',
  length: WORDS_C,
  still: 3.0,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, WORDS_C);
    rect(ctx, 0, 0, W, H, '#0a1426');
    for (let y = 0; y < H; y += 4) rect(ctx, 0, y, W, 1, '#0c182c');
    const ts = Math.max(8, Math.floor(Math.min(H * 0.86, W * 0.57) / 4));
    const gw = ts * 4;
    const side = W - gw >= 26;
    const gx = side ? 4 : Math.round((W - gw) / 2);
    const gy = Math.round((H - gw) / 2);
    // which tiles are lit now
    const lit = new Map<string, string>();
    let active: (typeof FOUND)[number] | null = null;
    let linePts: Array<[number, number]> = [];
    for (const w of FOUND) {
      if (tt < w.at) continue;
      const steps = Math.floor((tt - w.at) / STEP) + 1;
      const done = steps > w.path.length + 2;
      if (!done) {
        active = w;
        const shown = Math.min(w.path.length, steps);
        linePts = w.path.slice(0, shown);
        for (const [r, c] of linePts) lit.set(`${r},${c}`, steps > w.path.length ? '#2de38f' : '#ffd23f');
      }
    }
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const x = gx + c * ts;
        const y = gy + r * ts;
        const hl = lit.get(`${r},${c}`);
        rect(ctx, x + 1, y + 2, ts - 2, ts - 2, 'rgba(0,0,0,0.5)');
        rect(ctx, x + 1, y + 1, ts - 2, ts - 2, hl ?? '#f1e6cc');
        rect(ctx, x + 1, y + ts - 2, ts - 2, 1, hl ? '#8a6d10' : '#c8b88f');
        const scale = ts >= 14 ? 2 : 1;
        drawTextC(ctx, GRID[r]![c]!, x + ts / 2 + 0.5, y + Math.round((ts - 5 * scale) / 2), '#1a1030', scale);
      }
    // trace line through tile centres
    for (let i = 1; i < linePts.length; i++) {
      const [r0, c0] = linePts[i - 1]!;
      const [r1, c1] = linePts[i]!;
      line(ctx, gx + c0 * ts + ts / 2, gy + r0 * ts + ts / 2, gx + c1 * ts + ts / 2, gy + r1 * ts + ts / 2, 'rgba(255,79,216,0.8)');
    }
    // found list
    if (side) {
      const lx = gx + gw + 4;
      const lw = W - lx - 3;
      rect(ctx, lx - 1, gy, lw + 1, gw, '#081020');
      frame(ctx, lx - 1, gy, lw + 1, gw, '#1d3a66');
      let y = gy + 3;
      const newest = [...FOUND].reverse().find((w) => tt >= w.at + STEP * (w.path.length + 1));
      for (const w of FOUND) {
        const doneAt = w.at + STEP * (w.path.length + 1);
        if (tt < doneAt) continue;
        const label = textWidth(w.word) <= lw - 3 ? w.word : w.word.slice(0, 3);
        const fresh = w === newest && tt - doneAt < 1.2;
        drawText(ctx, label, lx + 2, y, fresh ? (blinkOn(f, tt, 6) ? '#2de38f' : '#ffffff') : '#e6f0ff');
        y += 7;
      }
      const total = FOUND.filter((w) => tt >= w.at + STEP * (w.path.length + 1)).reduce((a, w) => a + w.score, 0);
      drawTextC(ctx, String(total), lx + lw / 2, gy + gw - 7, '#ffd23f');
    }
    if (active && f.hud && !side) {
      const steps = Math.floor((tt - active.at) / STEP) + 1;
      if (steps > active.path.length) {
        const k = clamp((tt - active.at - STEP * active.path.length) / 0.3, 0, 1);
        banner(ctx, `${active.word} +${active.score}`, W, H / 2 + (1 - k) * 3, '#2de38f', '#0a1426', 1);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// DAS Survey — the room answers, the bars grow, a guess lands close.
// ---------------------------------------------------------------------------
const SURVEY_C = 8;
const BARS = [
  { label: 'COFFEE', pct: 62, color: '#ff8a3d' },
  { label: 'TEA', pct: 23, color: '#2de38f' },
  { label: 'WATER', pct: 15, color: '#38bdf8' },
];

export const survey: Scene = {
  label: 'SURVEY',
  length: SURVEY_C,
  still: 5.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, SURVEY_C);
    rect(ctx, 0, 0, W, H, '#0b1220');
    for (let x = 0; x < W; x += 6) rect(ctx, x, 0, 1, H, '#0e1728');
    const reveal = 1.6 + 1.6;
    const revealed = tt > reveal && tt < SURVEY_C - 0.4;
    const title = revealed && f.hud ? 'CLOSE! +80' : textWidth('MORNING FUEL?') <= W - 6 ? 'MORNING FUEL?' : 'FUEL?';
    const o = f.top;
    drawTextC(ctx, title, W / 2 + 0.5, 3 + o, revealed ? (blinkOn(f, tt) ? '#ffd23f' : '#ffffff') : '#ffffff', 1, '#000000');
    rect(ctx, 4, 10 + o, W - 8, 1, '#2a3a5a');
    const labelW = Math.max(...BARS.map((b) => textWidth(b.label)));
    const showLabels = W - labelW - 22 >= 30;
    const bx = showLabels ? 6 + labelW + 3 : 5;
    const maxW = W - bx - 16;
    const rowH = Math.max(7, Math.floor((H - 16 - o) / BARS.length));
    const growAt = 1.6;
    BARS.forEach((b, i) => {
      const y = 14 + o + i * rowH;
      const k = easeOut(clamp((tt - growAt - i * 0.25) / 1.1, 0, 1));
      if (showLabels) drawText(ctx, b.label, 5, y + Math.round((rowH - 7) / 2), '#c9d4ea');
      const bh = Math.max(3, rowH - 4);
      rect(ctx, bx, y, maxW, bh, '#141e33');
      const w = Math.round(maxW * (b.pct / 100) * k);
      rect(ctx, bx, y, w, bh, b.color);
      rect(ctx, bx, y, w, 1, 'rgba(255,255,255,0.35)');
      if (k > 0.05) drawText(ctx, `${Math.round(b.pct * k)}`, bx + w + 2, y + Math.round((bh - 5) / 2), '#ffffff');
    });
    // a player's guess marker on the top bar
    const guessAt = 0.7;
    if (tt > guessAt) {
      const y = 14 + o;
      const gx = bx + Math.round(maxW * 0.58);
      const drop = Math.round((1 - smooth(guessAt, guessAt + 0.4, tt)) * -6);
      rect(ctx, gx, y - 2 + drop, 1, Math.max(3, rowH - 4) + 4, '#ffffff');
      rect(ctx, gx - 1, y - 3 + drop, 3, 1, '#ffffff');
    }
  },
};
