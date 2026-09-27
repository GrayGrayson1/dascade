/**
 * Round reveal: everyone's words (unique / shared / teammate / rare / full-rack marks), best words,
 * the longest word, what nobody found, and the anagram's long word.
 */
import { useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import { WORDS_MODE_INFO, type WordsPublicState, type WordsRevealPlayer, type WordsRevealWord, type WordsRoundReveal } from '@dascade/shared/games/words';
import { Avatar, Button, PixelArt, PixelIcon, cx } from '@dascade/ui';
import { TeamBadge } from '../_party/index.ts';
import { LetterTile, ModeGlyph, TileWord } from './Common.tsx';
import { GEM_ART, STAR_ART } from './art.ts';
import { plural } from './hooks.ts';

function wordTitle(w: WordsRevealWord): string {
  const bits: string[] = [];
  if (w.u) bits.push('only you / link maker');
  if (w.s) bits.push('also found by others');
  if (w.t) bits.push('a teammate found it first');
  if (w.r) bits.push('rare word');
  if (w.f) bits.push('uses every letter');
  if (w.h) bits.push('approved by the host');
  if (w.x) bits.push('rejected by the host');
  return `${w.w}: ${w.p} points${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

export function RevealWord({ w, crossOut }: { w: WordsRevealWord; crossOut?: boolean }) {
  return (
    <li className={cx('wd-rw', w.u && 'is-unique', (w.x || w.t || (crossOut && w.s && w.p === 0)) && 'is-void')} aria-label={wordTitle(w)} title={wordTitle(w)}>
      {w.u ? <PixelArt rows={STAR_ART} className="wd-rw__icon" /> : null}
      {w.r ? <PixelArt rows={GEM_ART} className="wd-rw__icon wd-rw__icon--gem" /> : null}
      <span className="wd-rw__word">{w.w}</span>
      {w.f ? <span className="wd-rw__tag">ALL</span> : null}
      {w.h ? <span className="wd-rw__tag">HOST ✓</span> : null}
      <span className="wd-rw__pts dc-num">{w.x ? '✕' : w.p}</span>
    </li>
  );
}

function PlayerResult({ r, player, place, me, teamMode, crossOut, open, onToggle, chain }: { r: WordsRevealPlayer; player: PlayerView | undefined; place: number; me: boolean; teamMode: boolean; crossOut: boolean; open: boolean; onToggle: () => void; chain: boolean }) {
  const uniques = r.words.filter((w) => w.u).length;
  return (
    <li className={cx('wd-result', me && 'is-me')} style={{ '--player': player?.color ?? 'var(--accent)' } as CSSProperties}>
      <div className="wd-result__head">
        <span className="wd-result__place dc-num">{place}</span>
        <Avatar avatar={player?.avatar ?? 'rocket'} color={player?.color ?? 'var(--accent)'} size={34} />
        <span className="wd-result__who">
          <span className="wd-result__name">
            {r.name}
            {me ? <span className="wd-result__you">You</span> : null}
            {teamMode && r.teamId ? <TeamBadge teamId={r.teamId} size="sm" short /> : null}
          </span>
          <span className="wd-result__meta">
            {plural(r.count, 'word')}
            {uniques ? (chain ? ` · ${plural(uniques, 'link')} made` : ` · ${uniques} only-yours`) : ''}
            {r.best ? (
              <>
                {' · best '}
                <strong>{r.best.toUpperCase()}</strong>
              </>
            ) : null}
          </span>
        </span>
        <span className="wd-result__pts dc-num">+{r.points}</span>
        {r.words.length ? (
          <Button size="sm" variant="ghost" className="wd-result__toggle" aria-expanded={open} onClick={onToggle} iconRight={open ? 'chevron-up' : 'chevron-down'}>
            {open ? 'Hide' : 'Words'}
          </Button>
        ) : null}
      </div>
      {open && r.words.length ? (
        <ul className="wd-result__words" aria-label={`${r.name}'s words`}>
          {r.words.map((w, i) => (
            <RevealWord key={`${w.w}-${i}`} w={w} crossOut={crossOut} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RoundReveal({ state, reveal, players, meId, uniqueOnly }: { state: WordsPublicState; reveal: WordsRoundReveal; players: PlayerView[]; meId: string | null; uniqueOnly: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(meId ? [meId] : reveal.players.slice(0, 1).map((p) => p.id)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const info = WORDS_MODE_INFO[reveal.mode];
  const places = new Map<string, number>();
  reveal.players.forEach((p, i) => {
    const prev = reveal.players[i - 1];
    places.set(p.id, prev && prev.points === p.points ? (places.get(prev.id) ?? i + 1) : i + 1);
  });
  const longestBy = reveal.longest ? reveal.longest.playerIds.map((id) => players.find((p) => p.id === id)?.name ?? reveal.players.find((p) => p.id === id)?.name ?? 'Player') : [];

  return (
    <div className="wd-reveal">
      <header className="wd-reveal__head">
        <ModeGlyph mode={reveal.mode} className="wd-reveal__glyph" />
        <div>
          <p className="wd-reveal__kicker">
            Round <span className="dc-num">{reveal.round}</span> results · {info.title}
          </p>
          <h2 className="wd-reveal__title">
            {reveal.mode === 'forbidden' && reveal.category ? (
              <>
                {reveal.category} <span className="wd-reveal__no">no {(reveal.forbidden ?? '').toUpperCase()}</span>
              </>
            ) : reveal.mode === 'chain' ? (
              <>A chain of {plural(reveal.links ?? 0, 'link')}</>
            ) : (
              <>
                {plural(reveal.found, 'word')} found
                {reveal.possible ? <span className="wd-reveal__of"> of {reveal.possible.toLocaleString('en-US')}</span> : null}
              </>
            )}
          </h2>
        </div>
      </header>

      <div className="wd-reveal__highlights">
        {reveal.mode === 'anagram' && reveal.seeds.length ? (
          <section className="wd-hl wd-hl--seed" aria-label="Words using every letter">
            <span className="dc-label">The long word</span>
            <div className="wd-hl__seeds">
              {reveal.seeds.slice(0, 3).map((s) => (
                <TileWord key={s} word={s} size="md" />
              ))}
            </div>
          </section>
        ) : null}
        {reveal.mode === 'grid' && state.grid.length ? (
          <section className="wd-hl wd-hl--board" aria-label="The board">
            <span className="dc-label">The board</span>
            <div className="wd-miniboard" style={{ '--n': state.gridSize } as CSSProperties} aria-hidden="true">
              {state.grid.map((t, i) => (
                <LetterTile key={i} letter={t} size="sm" />
              ))}
            </div>
          </section>
        ) : null}
        {reveal.longest ? (
          <section className="wd-hl wd-hl--longest" aria-label="Longest word">
            <span className="dc-label">Longest word</span>
            <strong className="wd-hl__word">{reveal.longest.word.toUpperCase()}</strong>
            <span className="wd-hl__by">{longestBy.join(', ')}</span>
          </section>
        ) : null}
        {reveal.mode === 'chain' && reveal.survivors ? (
          <section className="wd-hl" aria-label="Survivors">
            <span className="dc-label">Still standing</span>
            <strong className="wd-hl__word">{reveal.survivors.length ? reveal.survivors.map((id) => players.find((p) => p.id === id)?.name ?? 'Player').join(', ') : 'Nobody!'}</strong>
          </section>
        ) : null}
      </div>

      <ol className="wd-results" aria-label="Round scores">
        {reveal.players.map((r) => (
          <PlayerResult
            key={r.id}
            r={r}
            player={players.find((p) => p.id === r.id)}
            place={places.get(r.id) ?? 0}
            me={r.id === meId}
            teamMode={state.teamMode}
            crossOut={uniqueOnly}
            chain={reveal.mode === 'chain'}
            open={open.has(r.id)}
            onToggle={() => toggle(r.id)}
          />
        ))}
      </ol>

      {reveal.missed.length ? (
        <section className="wd-missed" aria-label="Words nobody found">
          <h3 className="wd-missed__title">
            <PixelIcon name="eye" size={14} /> Nobody found
          </h3>
          <ul className="wd-missed__list">
            {reveal.missed.map((w) => (
              <li key={w} className="wd-missed__word">
                {w}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
