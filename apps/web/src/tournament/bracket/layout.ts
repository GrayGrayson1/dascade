/**
 * Spatial bracket layout (pure, no DOM): positions every match card and the connector lines of a
 * single- or double-elimination bracket.
 *
 *  - Each section (winners / losers / main) is a horizontal band; round n is column n.
 *  - First-round matches stack top to bottom. A later match sits at the vertical centre of the
 *    matches that feed it inside the same section (the classic bracket tree); matches fed only from
 *    another section (losers-bracket drop-ins) keep their order. Cards never overlap.
 *  - The finals (grand final + optional reset) sit to the right of both brackets, centred between
 *    the winners final and the losers final, with connectors from both.
 *  - Loser drops from the winners bracket into the losers bracket are NOT drawn (they would cross the
 *    whole chart); their slots say "Loser of W2·M1" instead, as most bracket sites do.
 */
import type { BracketVM, MatchVM, SectionId } from './types.ts';

export interface LayoutDims {
  cardW: number;
  cardH: number;
  /** Horizontal gap between round columns (connectors live here). */
  gapX: number;
  /** Minimum vertical gap between cards in one column. */
  gapY: number;
  /** Height of the round header row at the top of each band. */
  headerH: number;
  /** Vertical gap between the winners and losers bands. */
  sectionGap: number;
}

export const DEFAULT_DIMS: LayoutDims = { cardW: 224, cardH: 72, gapX: 56, gapY: 18, headerH: 40, sectionGap: 48 };

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  section: SectionId;
  round: number;
}

export interface Connector {
  key: string;
  from: string;
  to: string;
  slot: 0 | 1;
  /** SVG path (absolute coordinates). */
  d: string;
  /** The feeding match is decided (line drawn solid/bright). */
  decided: boolean;
  /** The target match involves the viewer (highlighted path). */
  mine: boolean;
}

export interface Band {
  id: SectionId;
  label: string;
  y: number;
  height: number;
}

export interface RoundHeader {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  section: SectionId;
  state: 'upcoming' | 'live' | 'done';
}

export interface BracketLayout {
  width: number;
  height: number;
  boxes: Record<string, Box>;
  connectors: Connector[];
  bands: Band[];
  headers: RoundHeader[];
}

/** Vertical centre of a card's slot (0 = top half, 1 = bottom half). */
export function slotY(box: Box, slot: 0 | 1): number {
  return box.y + (slot === 0 ? box.h * 0.25 : box.h * 0.75);
}

const DECIDED = new Set(['done', 'forfeit', 'bye', 'void']);

function elbow(x1: number, y1: number, x2: number, y2: number): string {
  const mid = Math.round(x1 + (x2 - x1) / 2);
  if (Math.abs(y1 - y2) < 0.5) return `M${x1} ${y1}H${x2}`;
  return `M${x1} ${y1}H${mid}V${y2}H${x2}`;
}

/** Lay out one band (winners, losers or main). Returns boxes relative to (0, top). */
function layoutBand(
  rounds: Array<{ matches: MatchVM[] }>,
  dims: LayoutDims,
  top: number,
  section: SectionId,
  boxes: Record<string, Box>,
): { height: number; columns: number } {
  const pitch = dims.cardH + dims.gapY;
  let bottom = top;
  rounds.forEach((round, col) => {
    const x = col * (dims.cardW + dims.gapX);
    const sorted = [...round.matches].sort((a, b) => a.order - b.order);
    let prevBottom = -Infinity;
    sorted.forEach((m, i) => {
      const inBand = m.feeders.map((f) => boxes[f.matchId]).filter((b): b is Box => Boolean(b && b.section === section));
      let y: number;
      if (col === 0 || inBand.length === 0) {
        y = col === 0 ? top + i * pitch : Number.isFinite(prevBottom) ? prevBottom + dims.gapY : top;
      } else {
        const centre = inBand.reduce((s, b) => s + b.y + b.h / 2, 0) / inBand.length;
        y = centre - dims.cardH / 2;
      }
      if (Number.isFinite(prevBottom)) y = Math.max(y, prevBottom + dims.gapY);
      y = Math.max(y, top);
      y = Math.round(y);
      boxes[m.id] = { id: m.id, x, y, w: dims.cardW, h: dims.cardH, section, round: m.round };
      prevBottom = y + dims.cardH;
      bottom = Math.max(bottom, prevBottom);
    });
  });
  return { height: bottom - top, columns: rounds.length };
}

export function layoutBracket(vm: BracketVM, dims: LayoutDims = DEFAULT_DIMS): BracketLayout {
  const boxes: Record<string, Box> = {};
  const bands: Band[] = [];
  const headers: RoundHeader[] = [];
  const colW = dims.cardW + dims.gapX;
  let y = 0;
  let maxColumns = 0;
  const trees = vm.sections.filter((s) => s.id !== 'finals');
  for (const section of trees) {
    if (section.rounds.length === 0) continue;
    const bandTop = y;
    const { height, columns } = layoutBand(section.rounds, dims, bandTop + dims.headerH, section.id, boxes);
    section.rounds.forEach((r, col) =>
      headers.push({ key: r.key, label: r.label, x: col * colW, y: bandTop, w: dims.cardW, section: section.id, state: r.state }),
    );
    bands.push({ id: section.id, label: section.label, y: bandTop, height: dims.headerH + height });
    maxColumns = Math.max(maxColumns, columns);
    y = bandTop + dims.headerH + height + dims.sectionGap;
  }
  const treesBottom = Math.max(0, y - dims.sectionGap);

  // Finals column(s): right of both trees, centred on their feeders.
  const finals = vm.sections.find((s) => s.id === 'finals');
  if (finals && finals.rounds.length > 0) {
    let prevCentre: number | null = null;
    finals.rounds.forEach((round, i) => {
      const col = maxColumns + i;
      const x = col * colW;
      headers.push({ key: round.key, label: round.label, x, y: 0, w: dims.cardW, section: 'finals', state: round.state });
      const sorted = [...round.matches].sort((a, b) => a.order - b.order);
      sorted.forEach((m, j) => {
        const feeders = m.feeders.map((f) => boxes[f.matchId]).filter((b): b is Box => Boolean(b));
        let centre: number;
        if (feeders.length > 0) centre = feeders.reduce((s, b) => s + b.y + b.h / 2, 0) / feeders.length;
        else if (prevCentre !== null) centre = prevCentre;
        else centre = dims.headerH + dims.cardH / 2;
        const top = Math.max(dims.headerH, Math.round(centre - dims.cardH / 2 + j * (dims.cardH + dims.gapY)));
        boxes[m.id] = { id: m.id, x, y: top, w: dims.cardW, h: dims.cardH, section: 'finals', round: m.round };
        prevCentre = top + dims.cardH / 2;
      });
    });
    bands.push({ id: 'finals', label: finals.label, y: 0, height: Math.max(treesBottom, dims.headerH + dims.cardH) });
    maxColumns += finals.rounds.length;
  }

  // Connectors: winner paths inside a band, plus everything that feeds the finals.
  const connectors: Connector[] = [];
  const byId = new Map<string, MatchVM>();
  for (const s of vm.sections) for (const r of s.rounds) for (const m of r.matches) byId.set(m.id, m);
  for (const m of byId.values()) {
    const to = boxes[m.id];
    if (!to) continue;
    for (const f of m.feeders) {
      const from = boxes[f.matchId];
      const src = byId.get(f.matchId);
      if (!from || !src) continue;
      const sameBand = from.section === to.section;
      const intoFinals = to.section === 'finals';
      if (!intoFinals && (!sameBand || f.take !== 'winner')) continue;
      if (from.x >= to.x) continue;
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = slotY(to, f.slot);
      connectors.push({
        key: `${f.matchId}>${m.id}:${f.slot}`,
        from: f.matchId,
        to: m.id,
        slot: f.slot,
        d: elbow(x1, y1, x2, y2),
        decided: DECIDED.has(src.status),
        mine: m.involvesMe && src.involvesMe,
      });
    }
  }

  let height = 0;
  for (const b of Object.values(boxes)) height = Math.max(height, b.y + b.h);
  for (const b of bands) height = Math.max(height, b.y + b.height);
  const width = Math.max(0, maxColumns * colW - dims.gapX);
  return { width, height, boxes, connectors, bands, headers };
}
