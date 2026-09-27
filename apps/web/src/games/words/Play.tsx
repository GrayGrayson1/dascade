/**
 * DASwords play screens: Letter Grid, Anagram Sprint, Forbidden Letter and Word Chain.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import { chainPrefixOf, type ChainLinkReveal, type ChainRule, type ChainTrailItem, type WordsPrivate, type WordsPublicState, type WordsSettings } from '@dascade/shared/games/words';
import { Avatar, Button, PixelArt, PixelIcon, cx } from '@dascade/ui';
import { GridBoard, previewPath } from './Board.tsx';
import { RackPlay } from './Rack.tsx';
import { EntryList, LetterTile, ScoreLegend, TileWord, VerdictLine, WordForm } from './Common.tsx';
import { HEART_ART, HEART_BROKEN_ART } from './art.ts';
import { lettersOnly, plural, submitWord, useJson } from './hooks.ts';
import { useMediaQuery } from '../_party/index.ts';

const COARSE = '(pointer: coarse)';

interface PlayProps {
  state: WordsPublicState;
  priv: WordsPrivate | null;
  meId: string | null;
  players: PlayerView[];
  spectator: boolean;
  settings: WordsSettings;
}

/** Flash feedback for the most recent submission once its verdict arrives. */
function useFlash(priv: WordsPrivate | null) {
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const seq = useRef<number | null>(priv?.seq ?? null);
  useEffect(() => {
    if (!priv) return;
    if (seq.current === null || priv.seq === seq.current) {
      seq.current = priv.seq;
      return;
    }
    seq.current = priv.seq;
    if (!priv.last) return;
    setFlash(priv.last.ok ? 'good' : 'bad');
    const t = setTimeout(() => setFlash(null), 520);
    return () => clearTimeout(t);
  }, [priv]);
  return flash;
}

function SpectatorNote() {
  return (
    <p className="wd-note" role="status">
      <PixelIcon name="eye" size={14} /> You’re spectating — words are for players only.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Letter Grid
// ---------------------------------------------------------------------------

export function GridPlay({ state, priv, spectator, settings }: PlayProps) {
  const round = state.round;
  const coarse = useMediaQuery(COARSE);
  const [typed, setTyped] = useState('');
  const [showType, setShowType] = useState(false);
  const [hover, setHover] = useState<number[] | null>(null);
  const lastPath = useRef<number[]>([]);
  const flash = useFlash(priv);
  const locked = spectator || state.stage !== 'play' || state.paused;
  const tiles = state.grid;

  const onTrace = useCallback(
    (word: string, path: number[]) => {
      lastPath.current = path;
      submitWord(round, word, path);
    },
    [round],
  );
  const onType = (word: string) => {
    lastPath.current = previewPath(tiles, lettersOnly(word)) ?? [];
    submitWord(round, word);
  };
  const preview = typed ? previewPath(tiles, lettersOnly(typed)) : null;
  const entries = priv?.entries ?? [];
  const typing = !coarse || showType;

  return (
    <div className="wd-play wd-play--grid">
      <div className="wd-play__board">
        <GridBoard
          tiles={tiles}
          disabled={locked}
          minLength={state.minLength}
          highlight={hover ?? preview}
          flash={flash && lastPath.current.length ? { path: lastPath.current, tone: flash } : null}
          onSubmit={onTrace}
        />
        <VerdictLine priv={priv} idle={spectator ? 'Spectating' : `${plural(state.possible, 'word')} hide on this board. Min ${state.minLength} letters.`} />
      </div>
      <div className="wd-play__side">
        {spectator ? <SpectatorNote /> : null}
        {!spectator && typing ? (
          <WordForm label="Type a word" placeholder="…or type a word" disabled={locked} onSubmit={onType} onChange={setTyped} autoFocus={!coarse} resetKey={round} />
        ) : null}
        {!spectator && !typing ? (
          <Button variant="ghost" size="sm" icon="pencil" onClick={() => setShowType(true)} className="wd-typeswitch">
            Type instead
          </Button>
        ) : null}
        {!spectator ? <EntryList entries={entries} onHover={coarse ? undefined : (e) => setHover(e?.path ?? null)} compact={coarse} /> : null}
        <ScoreLegend mode="grid" uniqueOnly={settings.uniqueOnly} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anagram Sprint
// ---------------------------------------------------------------------------

export function AnagramPlay({ state, priv, spectator }: PlayProps) {
  const flash = useFlash(priv);
  const locked = spectator || state.stage !== 'play' || state.paused;
  const onSubmit = useCallback((w: string) => submitWord(state.round, w), [state.round]);
  return (
    <div className="wd-play wd-play--anagram">
      <div className="wd-play__board">
        <RackPlay rack={state.rack} disabled={locked} onSubmit={onSubmit} flash={flash} />
        <VerdictLine priv={priv} idle={spectator ? 'Spectating' : `${plural(state.possible, 'word')} in this rack — one uses every letter. Tap letters or just type.`} />
      </div>
      <div className="wd-play__side">
        {spectator ? <SpectatorNote /> : <EntryList entries={priv?.entries ?? []} />}
        <ScoreLegend mode="anagram" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forbidden Letter
// ---------------------------------------------------------------------------

export function ForbiddenCard({ category, hint, letter, compact }: { category: string; hint: string; letter: string; compact?: boolean }) {
  return (
    <section className={cx('wd-forbid', compact && 'wd-forbid--compact')} data-part="prompt-card" aria-label={`Category ${category}, forbidden letter ${letter.toUpperCase()}`}>
      <div className="wd-forbid__text">
        <p className="wd-forbid__kicker">Name things in this category</p>
        <h2 className="wd-forbid__category">{category}</h2>
        {hint && !compact ? <p className="wd-forbid__hint">{hint}</p> : null}
      </div>
      <div className="wd-forbid__ban" aria-hidden="true">
        <span className="wd-forbid__no">No</span>
        <LetterTile letter={letter} size="xl" state="ban" />
      </div>
    </section>
  );
}

export function ForbiddenPlay({ state, priv, spectator }: PlayProps) {
  const locked = spectator || state.stage !== 'play' || state.paused;
  return (
    <div className="wd-play wd-play--forbidden">
      <div className="wd-play__board">
        <ForbiddenCard category={state.category} hint={state.categoryHint} letter={state.forbidden} />
        {spectator ? (
          <SpectatorNote />
        ) : (
          <WordForm
            label="Type an answer"
            placeholder={`Type an answer without “${state.forbidden.toUpperCase()}”`}
            phrase
            forbidden={state.forbidden}
            disabled={locked}
            maxLength={30}
            submitLabel="Send"
            resetKey={state.round}
            onSubmit={(w) => submitWord(state.round, w)}
            autoFocus
            hint="Up to three words. Real dictionary words only."
          />
        )}
        <VerdictLine priv={priv} idle="Known answers are approved instantly; the host checks the rest." />
      </div>
      <div className="wd-play__side">
        {spectator ? null : <EntryList title="Your answers" entries={priv?.entries ?? []} empty="Nothing yet — how many can you name?" />}
        <ScoreLegend mode="forbidden" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word Chain
// ---------------------------------------------------------------------------

function Hearts({ lives, max, label }: { lives: number; max: number; label?: string }) {
  return (
    <span className="wd-hearts" role="img" aria-label={label ?? `${lives} of ${max} hearts`}>
      {Array.from({ length: max }, (_, i) => (
        <PixelArt key={i} rows={i < lives ? HEART_ART : HEART_BROKEN_ART} className="wd-heart" data-lost={i >= lives ? 'true' : undefined} />
      ))}
    </span>
  );
}

/** Previous links (the current word is shown large separately). */
export function ChainTrail({ trail, current, rule }: { trail: ChainTrailItem[]; current: string; rule: ChainRule }) {
  let idx = -1;
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i]!.word === current) idx = idx < 0 ? i : idx;
  const prev = (idx >= 0 ? trail.slice(0, idx) : trail).slice(-5);
  if (prev.length === 0) return null;
  return (
    <ol className="wd-trail" aria-label="The chain so far">
      {prev.map((t) => (
        <li key={`${t.link}-${t.word}`} className="wd-trail__item">
          <span className="wd-trail__word">{t.word}</span>
          {t.name ? <span className="wd-trail__by">{t.name}</span> : null}
          <span className="wd-trail__link" aria-hidden="true">
            {chainPrefixOf(t.word, rule).toUpperCase()}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ChainPlay({ state, priv, meId, players, spectator, settings }: PlayProps) {
  const trail = useJson<ChainTrailItem[]>(state.chainJson, []);
  const link = useJson<ChainLinkReveal | null>(state.linkJson, null);
  const rule = (state.chainRule === 'last2' ? 'last2' : 'last') as ChainRule;
  const me = meId ? state.progress[meId] : undefined;
  const maxLives = settings.chainLives;
  const out = Boolean(me?.out);
  const answer = priv?.link === state.chainLink ? priv.chainAnswer : null;
  const revealing = state.stage === 'linkReveal' && link;
  const locked = spectator || out || Boolean(answer) || state.stage !== 'link' || state.paused;
  const current = revealing ? link.from : state.chainWord;
  const prefix = revealing ? link.prefix : state.chainPrefix;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Player';
  const seated = players.filter((p) => !p.spectator);

  return (
    <div className="wd-play wd-play--chain">
      <div className="wd-play__board">
        <div className="wd-chain" data-part="chain" data-revealing={revealing ? 'true' : undefined}>
          <ChainTrail trail={trail} current={current} rule={rule} />
          <div className="wd-chain__current">
            <p className="wd-chain__kicker">
              Link <span className="dc-num">{state.chainLink}</span> of <span className="dc-num">{state.chainLinks}</span>
            </p>
            <TileWord word={current} size="lg" highlightFrom={Math.max(0, current.length - prefix.length)} />
            <p className="wd-chain__rule">
              Next word starts with <strong className="wd-chain__prefix">{prefix.toUpperCase()}…</strong>
            </p>
          </div>
        </div>

        {revealing ? (
          <LinkRevealCard link={link} nameOf={nameOf} meId={meId} />
        ) : spectator ? (
          <SpectatorNote />
        ) : out ? (
          <p className="wd-note wd-note--out" role="status">
            <PixelArt rows={HEART_BROKEN_ART} className="wd-heart" /> Out of hearts — cheer on the others. Everyone’s back for the next chain.
          </p>
        ) : answer ? (
          <p className="wd-note wd-note--locked" role="status">
            <PixelIcon name="check" size={14} /> Locked in <strong>{answer.toUpperCase()}</strong> — waiting for the others…
          </p>
        ) : (
          <WordForm
            label="Your link word"
            placeholder={`${prefix.toUpperCase()}…`}
            initial={prefix}
            resetKey={`${state.round}:${state.chainLink}`}
            disabled={locked}
            submitLabel="Link it"
            onSubmit={(w) => submitWord(state.round, w)}
            autoFocus
            hint={`At least ${state.minLength} letters. No repeats.`}
          />
        )}
        {!revealing && !answer && !out && priv?.last && !priv.last.ok ? <VerdictLine priv={priv} /> : null}
      </div>
      <div className="wd-play__side">
        {!spectator && me ? (
          <div className="wd-mystatus">
            <span className="dc-label">Your hearts</span>
            <Hearts lives={me.lives} max={maxLives} />
          </div>
        ) : null}
        <ul className="wd-chainplayers" data-part="players-strip" aria-label="Players">
          {seated.map((p) => {
            const prog = state.progress[p.id];
            const answered = Boolean(state.seats[p.id]?.answered) && state.stage === 'link';
            return (
              <li key={p.id} className={cx('wd-chainplayer', prog?.out && 'is-out', p.id === meId && 'is-me')} style={{ '--player': p.color } as CSSProperties}>
                <Avatar avatar={p.avatar} color={p.color} size={26} offline={!p.connected} />
                <span className="wd-chainplayer__name">{p.name}</span>
                {prog ? <Hearts lives={prog.lives} max={maxLives} label={`${p.name}: ${prog.lives} hearts${prog.out ? ', out' : ''}`} /> : null}
                <span className="wd-chainplayer__state" aria-label={prog?.out ? 'Out' : answered ? 'Answered' : 'Thinking'}>
                  {prog?.out ? 'OUT' : answered ? <PixelIcon name="check" size={12} /> : '…'}
                </span>
              </li>
            );
          })}
        </ul>
        <ScoreLegend mode="chain" />
      </div>
    </div>
  );
}

function LinkRevealCard({ link, nameOf, meId }: { link: ChainLinkReveal; nameOf: (id: string) => string; meId: string | null }) {
  return (
    <section className="wd-linkreveal" aria-label={`Link ${link.link} results`}>
      {link.answers.length === 0 ? (
        <p className="wd-linkreveal__none">Nobody linked it! DASwords picks the next word.</p>
      ) : (
        <ul className="wd-linkreveal__list">
          {link.answers.map((a) => (
            <li key={a.playerId} className={cx('wd-linkreveal__row', a.maker && 'is-maker', a.playerId === meId && 'is-me')}>
              <span className="wd-linkreveal__name">{nameOf(a.playerId)}</span>
              <span className="wd-linkreveal__word">{a.word}</span>
              {a.maker ? <span className="wd-linkreveal__tag">NEXT LINK</span> : null}
              <span className="wd-linkreveal__pts dc-num">+{a.points}</span>
            </li>
          ))}
        </ul>
      )}
      {link.missed.length ? (
        <p className="wd-linkreveal__missed">
          <PixelArt rows={HEART_BROKEN_ART} className="wd-heart" /> Lost a heart: {link.missed.map(nameOf).join(', ')}
          {link.eliminated.length ? <strong> · Out: {link.eliminated.map(nameOf).join(', ')}</strong> : null}
        </p>
      ) : null}
      {link.next ? (
        <p className="wd-linkreveal__next">
          Next link: <strong>{link.next.toUpperCase()}</strong>
          {link.fallback ? ' (picked by DASwords)' : ''}
        </p>
      ) : (
        <p className="wd-linkreveal__next">That’s the end of the chain!</p>
      )}
    </section>
  );
}
