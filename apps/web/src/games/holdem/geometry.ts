/**
 * Table geometry: fits an oval table into the available arena (horizontal on
 * wide screens, vertical on portrait phones) and spreads 2–10 seats evenly
 * along the rail by arc length, with the viewer's seat at the bottom.
 * Bets and the dealer button are placed just clear of each seat (its cards,
 * pod and status badge) and never on top of the board.
 */

export interface Point {
  x: number;
  y: number;
}

export interface TableGeometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Seat anchor ellipse (the rail line). */
  seatRx: number;
  seatRy: number;
  /** Playing surface. */
  feltRx: number;
  feltRy: number;
  portrait: boolean;
  compact: boolean;
  podW: number;
  podH: number;
  /** Width of face-down cards at the seats. */
  seatCardW: number;
  /** Width of the hero's cards when shown at the table (desktop). */
  heroCardW: number;
  boardCardW: number;
  /** Half extents of the board row (for keeping bets off it). */
  boardHalfW: number;
  boardHalfH: number;
  /** Vertical centre of the board row (the pot sits just above it). */
  boardCy: number;
  /** Height reserved above the board for the pot / winner banner. */
  potH: number;
  /** Enough room under the board for the felt logo and banners. */
  roomy: boolean;
}

export function computeGeometry(width: number, height: number): TableGeometry {
  const w = Math.max(280, width);
  const h = Math.max(260, height);
  // Compact pods only for narrow arenas (phones) or genuinely short ones that are also not wide.
  const compact = w < 720 || (h < 400 && w < 1000);
  const portrait = w < h * 0.92;
  // Medium pods for wide-but-short arenas (e.g. 1280×720 while the dock is open).
  const medium = !compact && h < 520;
  const podW = compact ? 86 : medium ? 136 : 150;
  const podH = compact ? 48 : medium ? 52 : 60;
  const seatCardW = compact ? 22 : medium ? 28 : 34;
  // Room for (tabled, slightly larger) cards above the top pods and the status badge under the bottom pods.
  const padTop = podH / 2 + seatCardW * 1.3 * 1.4 - 8;
  const padBottom = podH / 2 + (compact ? 20 : 26);
  const padX = podW / 2 + 6;
  let seatRx = w / 2 - padX;
  let seatRy = (h - padTop - padBottom) / 2;
  if (portrait) {
    seatRy = Math.min(seatRy, seatRx * 1.9);
  } else {
    seatRx = Math.min(seatRx, seatRy * 2.3);
    seatRy = Math.min(seatRy, seatRx / 1.05);
  }
  seatRx = Math.max(90, seatRx);
  seatRy = Math.max(90, seatRy);
  const cx = w / 2;
  const cy = padTop + (h - padTop - padBottom) / 2;
  const rail = compact ? 14 : 26;
  const feltRx = seatRx - rail;
  const feltRy = seatRy - rail;
  // The pot + board block lives between the top seats' badges and the bottom seats' cards.
  const potH = compact ? 30 : 36;
  const topLimit = cy - seatRy + podH / 2 + (compact ? 18 : 24) + 6;
  const bottomLimit = cy + seatRy - podH / 2 - (compact ? seatCardW * 1.4 * 0.72 : 60 * 1.4 - 6) - 6;
  const span = bottomLimit - topLimit;
  // Board: as large as fits between the side pods, the felt and that vertical window.
  const sideRoom = (seatRx - podW / 2 - 10) * 2;
  const boardCardW = Math.round(
    Math.max(30, Math.min(76, sideRoom / 5.4, feltRx * 0.19 * (portrait ? 1.6 : 1), feltRy * 0.44, (span - potH - 6) / 1.4)),
  );
  const gap = Math.round(boardCardW * 0.1);
  const boardH = boardCardW * 1.4;
  const block = potH + 6 + boardH;
  const blockTop = topLimit + Math.max(0, (span - block) / 2);
  const boardCy = blockTop + potH + 6 + boardH / 2;
  const roomy = bottomLimit - (boardCy + boardH / 2) >= (compact ? 34 : 44);
  return {
    width: w,
    height: h,
    cx,
    cy,
    seatRx,
    seatRy,
    feltRx,
    feltRy,
    portrait,
    compact,
    podW,
    podH,
    seatCardW,
    heroCardW: compact ? 46 : medium ? 50 : 60,
    boardCardW,
    boardHalfW: (boardCardW * 5 + gap * 4) / 2,
    boardHalfH: boardH / 2,
    boardCy,
    potH,
    roomy,
  };
}

/**
 * `count` points on the ellipse, equally spaced by arc length, starting at the
 * bottom centre and going clockwise on screen (the direction the action moves).
 */
export function seatPoints(geo: TableGeometry, count: number): Point[] {
  const { cx, cy, seatRx: rx, seatRy: ry } = geo;
  const samples = 720;
  const pts: Point[] = [];
  const cumulative: number[] = [0];
  for (let i = 0; i <= samples; i++) {
    const t = Math.PI / 2 + (i / samples) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    if (i > 0) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      cumulative.push(cumulative[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  const total = cumulative[samples]!;
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (j < samples && cumulative[j + 1]! < target) j++;
    const span = cumulative[j + 1]! - cumulative[j]!;
    const f = span > 0 ? (target - cumulative[j]!) / span : 0;
    const a = pts[j]!;
    const b = pts[j + 1]!;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** How far a seat's furniture reaches from the pod centre (cards above, badge below). */
function seatExtents(geo: TableGeometry, heroCards: boolean) {
  const cardH = heroCards ? geo.heroCardW * 1.4 - 6 : geo.seatCardW * 1.4 * 0.72;
  return {
    half: geo.podW / 2 + 4,
    up: geo.podH / 2 + cardH,
    down: geo.podH / 2 + (geo.compact ? 22 : 30),
  };
}

/** Where a seat's bet sits: just in front of the seat, toward the middle, off the board. */
export function betPoint(geo: TableGeometry, seat: Point, heroCards = false): Point {
  let ux = geo.cx - seat.x;
  let uy = geo.cy - seat.y;
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;
  const box = seatExtents(geo, heroCards);
  const tx = Math.abs(ux) > 1e-6 ? box.half / Math.abs(ux) : Infinity;
  const ty = uy < -1e-6 ? box.up / -uy : uy > 1e-6 ? box.down / uy : Infinity;
  // Clear the seat box by the bet's own half-size along the way out (chips + label ≈ 64×26).
  const own = Math.abs(ux) * (geo.compact ? 30 : 36) + Math.abs(uy) * (geo.compact ? 11 : 13);
  const d = Math.min(tx, ty) + own + 4;
  const p = { x: seat.x + ux * d, y: seat.y + uy * d };
  // Never on the pot + board block (bet chips + label are about 60×24).
  const bw = geo.compact ? 26 : 34;
  const bh = geo.compact ? 13 : 16;
  const left = geo.cx - geo.boardHalfW - bw;
  const right = geo.cx + geo.boardHalfW + bw;
  const top = geo.boardCy - geo.boardHalfH - 6 - geo.potH - bh;
  const bottom = geo.boardCy + geo.boardHalfH + bh;
  if (p.x > left && p.x < right && p.y > top && p.y < bottom) {
    if (Math.abs(seat.x - geo.cx) > geo.boardHalfW) {
      // Beside the board: slide up or down, staying in front of the seat.
      p.y = seat.y < geo.boardCy ? top : bottom;
    } else {
      // Above or below the board: slide sideways next to it.
      p.x = seat.x < geo.cx - 4 ? left : right;
    }
  }
  return p;
}

/** Dealer button: on the rail right beside the pod, one step clockwise (clear of cards, badge and bets). */
export function buttonPoint(geo: TableGeometry, seat: Point, heroCards = false): Point {
  const t = Math.atan2((seat.y - geo.cy) / geo.seatRy, (seat.x - geo.cx) / geo.seatRx);
  let tx = -geo.seatRx * Math.sin(t);
  let ty = geo.seatRy * Math.cos(t);
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  const box = seatExtents(geo, heroCards);
  const ex = Math.abs(tx) > 1e-6 ? box.half / Math.abs(tx) : Infinity;
  const ey = ty < -1e-6 ? box.up / -ty : ty > 1e-6 ? box.down / ty : Infinity;
  // A little extra room when the step is vertical (cards above / badge below the pod).
  const d = Math.min(ex, ey) + (geo.compact ? 8 : 16) + (Math.abs(ty) > 0.7 ? 6 : 0);
  return { x: seat.x + tx * d, y: seat.y + ty * d };
}
