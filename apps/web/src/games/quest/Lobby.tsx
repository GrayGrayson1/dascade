/**
 * Lobby pieces: the per-player hero select (with saved-party claiming) and the
 * host's settings panel (pack, vote timer, difficulty, tie-breaks, duplicates and
 * "Continue a saved adventure").
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Badge, Button, Field, IconButton, PixelArt, Segmented, Select, Slider, Toggle, cx } from '@dascade/ui';
import {
  QUEST_ARCHETYPES,
  QUEST_ARCHETYPE_IDS,
  QUEST_MSG,
  QUEST_STATS,
  QUEST_STAT_INFO,
  type QuestArchetypeId,
  type QuestCheckpointPayload,
  type QuestPackSummary,
  type QuestPublicState,
  type QuestSaveInfo,
  type QuestSettings,
} from '@dascade/shared/games/quest';
import { useGame, useRoomSelector } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { persistence, type Preset } from '../../persistence/index.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import type { SettingsPanelProps } from '../types.ts';
import { PORTRAITS } from './art.ts';
import { Portrait } from './Party.tsx';
import { useJson } from './util.ts';

// ---------------------------------------------------------------------------
// Hero select
// ---------------------------------------------------------------------------

export function QuestPlayerSetup() {
  const game = useGame<QuestPublicState, QuestSettings>();
  const packs = useJson<QuestPackSummary[]>(game?.state.packsJson);
  const save = useJson<QuestSaveInfo>(game?.state.saveJson);
  const [focus, setFocus] = useState<QuestArchetypeId | null>(null);
  if (!game) return null;
  const { state, me, playerId, settings, seated } = game;
  const pack = packs?.find((p) => p.id === settings.pack);
  const allowed = pack?.archetypes ?? [...QUEST_ARCHETYPE_IDS];
  const myHero = playerId ? state.heroes[playerId] : undefined;
  const myPick = (myHero?.archetype || null) as QuestArchetypeId | null;
  const shown = focus ?? myPick ?? allowed[0]!;
  const color = me?.color ?? '#a3e635';
  const takenBy = (a: QuestArchetypeId) =>
    settings.allowDuplicates ? undefined : seated.find((p) => p.id !== playerId && state.heroes[p.id]?.archetype === a)?.name;

  if (me?.spectator) {
    return <p className="qs-empty">You’re spectating. Take a seat to pick a hero — or just enjoy the show.</p>;
  }

  const pick = (a: QuestArchetypeId) => {
    sfx('select');
    setFocus(a);
    session.send(QUEST_MSG.hero, { archetype: a });
  };

  return (
    <div className="qs-setup">
      {save ? <SavedPartyClaim save={save} /> : null}
      <div className="qs-setup__heading">
        <span className="dc-label">{save ? 'Or start a fresh hero' : 'Choose your hero'}</span>
        {myPick ? <Badge color="var(--accent)">Playing {QUEST_ARCHETYPES[myPick].name}</Badge> : <Badge color="var(--yellow)">Not picked yet</Badge>}
      </div>
      <div className="qs-heroes" role="radiogroup" aria-label="Hero archetype">
        {allowed.map((a) => {
          const arche = QUEST_ARCHETYPES[a];
          const taken = takenBy(a);
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={myPick === a}
              aria-label={`${arche.name}${taken ? ` (taken by ${taken})` : ''}`}
              disabled={Boolean(taken)}
              className={cx('qs-herocard', myPick === a && 'is-picked', shown === a && 'is-focused')}
              style={{ '--tint': arche.tint, '--hero': color } as CSSProperties}
              onClick={() => pick(a)}
              onMouseEnter={() => setFocus(a)}
              onFocus={() => setFocus(a)}
            >
              <PixelArt rows={PORTRAITS[a]} mainColor={color} className="qs-herocard__art" />
              <span className="qs-herocard__name">{arche.name}</span>
              <span className="qs-herocard__hp">{arche.maxHp} HP</span>
              {taken ? <span className="qs-herocard__taken">{taken}</span> : null}
            </button>
          );
        })}
      </div>
      <HeroDetail archetype={shown} color={color} kit={pack?.kits[shown]} />
      <PartyPreview />
    </div>
  );
}

function HeroDetail({ archetype, color, kit }: { archetype: QuestArchetypeId; color: string; kit?: Array<{ name: string; qty: number }> }) {
  const a = QUEST_ARCHETYPES[archetype];
  return (
    <div className="qs-herodetail" style={{ '--tint': a.tint } as CSSProperties} aria-live="polite">
      <div className="qs-herodetail__head">
        <PixelArt rows={PORTRAITS[archetype]} mainColor={color} className="qs-herodetail__art" />
        <div>
          <strong className="qs-herodetail__name">{a.name}</strong>
          <p className="qs-herodetail__tag">{a.tagline}</p>
        </div>
      </div>
      <p className="qs-herodetail__desc">{a.description}</p>
      <ul className="qs-stats" aria-label={`${a.name} stats`}>
        {QUEST_STATS.map((s) => (
          <li key={s} style={{ '--stat': QUEST_STAT_INFO[s].color } as CSSProperties} title={QUEST_STAT_INFO[s].description}>
            <span className="qs-stats__label">{QUEST_STAT_INFO[s].short}</span>
            <span className="qs-stats__bar" aria-hidden>
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} data-on={i < a.stats[s] ? 'true' : undefined} />
              ))}
            </span>
            <span className="qs-stats__val dc-num">+{a.stats[s]}</span>
          </li>
        ))}
      </ul>
      <div className="qs-ability">
        <span className="dc-label">Ability · {a.ability.name}</span>
        <p>{a.ability.description}</p>
      </div>
      {kit?.length ? (
        <p className="qs-herodetail__kit">
          <span className="dc-label">Brings</span> {kit.map((k) => `${k.qty > 1 ? `${k.qty}× ` : ''}${k.name}`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

function PartyPreview() {
  const game = useGame<QuestPublicState, QuestSettings>();
  if (!game) return null;
  const { seated, state, playerId } = game;
  return (
    <div className="qs-partypreview">
      <span className="dc-label">Party so far</span>
      <ul>
        {seated.map((p) => {
          const h = state.heroes[p.id];
          return (
            <li key={p.id} className={cx(p.id === playerId && 'is-me')} title={`${p.name}: ${h?.archetype ? QUEST_ARCHETYPES[h.archetype].name : 'choosing…'}`}>
              <Portrait hero={{ archetype: h?.archetype ?? '', color: p.color, ko: false }} size={30} />
              <span>{p.name}</span>
              <small>{h?.archetype ? QUEST_ARCHETYPES[h.archetype].name : 'Choosing…'}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SavedPartyClaim({ save }: { save: QuestSaveInfo }) {
  const game = useGame<QuestPublicState, QuestSettings>();
  if (!game) return null;
  const { state, playerId, players } = game;
  const claims = new Map(Object.values(state.heroes).filter((h) => h.slot >= 0).map((h) => [h.slot, h.playerId]));
  const mine = playerId ? state.heroes[playerId]?.slot ?? -1 : -1;
  return (
    <div className="qs-claim">
      <span className="dc-label">
        Saved party · Ch. {save.chapter}: {save.chapterTitle}
      </span>
      <p className="qs-claim__hint">Claim a hero to continue as them. Unclaimed heroes go to players in join order.</p>
      <ul className="qs-claim__list">
        {save.heroes.map((h) => {
          const owner = claims.get(h.slot);
          const ownerName = owner ? players.find((p) => p.id === owner)?.name : undefined;
          const isMine = mine === h.slot;
          return (
            <li key={h.slot}>
              <button
                type="button"
                className={cx('qs-claim__hero', isMine && 'is-mine')}
                disabled={Boolean(owner) && !isMine}
                aria-pressed={isMine}
                onClick={() => session.send(QUEST_MSG.claim, { slot: isMine ? -1 : h.slot })}
              >
                <Portrait hero={{ archetype: h.archetype, color: '#a3e635', ko: h.ko }} size={30} />
                <span className="qs-claim__text">
                  <span>
                    <b>{h.name}</b> the {QUEST_ARCHETYPES[h.archetype].name}
                  </span>
                  <small>
                    {h.hp}/{h.maxHp} HP{ownerName ? ` · claimed by ${ownerName}` : isMine ? ' · yours' : ''}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function QuestSettingsPanel({ settings, canEdit, update }: SettingsPanelProps<QuestSettings>) {
  const packsJson = useRoomSelector<QuestPublicState, string>((s) => s.packsJson);
  const packs = useJson<QuestPackSummary[]>(packsJson) ?? [];
  const pack = packs.find((p) => p.id === settings.pack);
  const [seconds, setSeconds] = useState(settings.voteSeconds);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setSeconds(settings.voteSeconds), [settings.voteSeconds]);
  useEffect(() => () => void (debounce.current && clearTimeout(debounce.current)), []);

  return (
    <div className="qs-settings">
      <Field label="Adventure" hint={pack ? `${pack.tagline} · ${pack.chapters} chapters · ${pack.nodes} scenes · ${pack.endings} endings · ${pack.length}` : undefined}>
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} value={settings.pack} disabled={!canEdit} onChange={(e) => update({ pack: e.currentTarget.value })}>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Vote timer" aside={<span className="dc-num">{seconds}s</span>} hint="How long the party has to decide each scene.">
        {({ id, describedBy }) => (
          <Slider
            id={id}
            aria-describedby={describedBy}
            min={15}
            max={120}
            step={5}
            value={seconds}
            disabled={!canEdit}
            onChange={(v) => {
              setSeconds(v);
              if (debounce.current) clearTimeout(debounce.current);
              debounce.current = setTimeout(() => update({ voteSeconds: v }), 350);
            }}
          />
        )}
      </Field>
      <div className="dc-field">
        <span className="dc-field__label">Difficulty</span>
        <Segmented
          label="Difficulty"
          value={settings.difficulty}
          disabled={!canEdit}
          onChange={(difficulty) => update({ difficulty })}
          options={[
            { value: 'story', label: 'Story (−2 DC)' },
            { value: 'normal', label: 'Normal' },
            { value: 'hard', label: 'Hard (+2 DC)' },
          ]}
        />
      </div>
      <div className="dc-field">
        <span className="dc-field__label">Tie-breaks</span>
        <Segmented
          label="Tie-breaks"
          value={settings.tieBreak}
          disabled={!canEdit}
          onChange={(tieBreak) => update({ tieBreak })}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'host', label: 'Host decides' },
          ]}
        />
        <span className="dc-field__hint">
          {settings.tieBreak === 'auto'
            ? 'Ties go to the choice with the best party odds, then the host’s vote, then a server coin flip.'
            : 'The host’s vote settles ties; otherwise the host picks (automatic rule if they don’t answer).'}
        </span>
      </div>
      <Toggle label="Allow duplicate heroes" checked={settings.allowDuplicates} disabled={!canEdit} onChange={(allowDuplicates) => update({ allowDuplicates })} />
      <SavedAdventures canEdit={canEdit} />
    </div>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** The server accepts save blobs of 16…120 000 characters (QuestLoadSchema). */
const SAVE_BLOB_MIN = 16;
const SAVE_BLOB_MAX = 120_000;

/**
 * Stored saves come from this device's storage (or a synced profile), so they are untrusted:
 * only list ones whose display info has the expected shape, so a damaged entry can't crash
 * the settings panel. The server re-verifies the signed blob itself.
 */
function isUsableSave(p: Preset<QuestCheckpointPayload>): boolean {
  const d = p.data as Partial<QuestCheckpointPayload> | null | undefined;
  const info = d?.info as Partial<QuestSaveInfo> | undefined;
  return (
    typeof d?.blob === 'string' &&
    d.blob.length >= SAVE_BLOB_MIN &&
    d.blob.length <= SAVE_BLOB_MAX &&
    !!info &&
    typeof info.packTitle === 'string' &&
    typeof info.chapterTitle === 'string' &&
    Number.isFinite(info.chapter) &&
    Array.isArray(info.heroes) &&
    info.heroes.every((h) => !!h && typeof h === 'object' && (QUEST_ARCHETYPE_IDS as readonly string[]).includes(h.archetype) && Number.isFinite(h.slot))
  );
}

function SavedAdventures({ canEdit }: { canEdit: boolean }) {
  const saveJson = useRoomSelector<QuestPublicState, string>((s) => s.saveJson);
  const loaded = useJson<QuestSaveInfo>(saveJson);
  const [saves, setSaves] = useState<Array<Preset<QuestCheckpointPayload>> | null>(null);
  const [rev, setRev] = useState(0);
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    let alive = true;
    persistence()
      .listPresets<QuestCheckpointPayload>('quest-save')
      .then((list) => alive && setSaves(list.filter(isUsableSave)))
      .catch(() => alive && setSaves([]));
    return () => {
      alive = false;
    };
  }, [rev]);

  return (
    <div className="qs-saves">
      <span className="dc-field__label">Continue a saved adventure</span>
      {loaded ? (
        <div className="qs-saves__loaded" role="status">
          <span>
            <b>Loaded:</b> {loaded.packTitle} — Ch. {loaded.chapter}: {loaded.nodeTitle}. Players claim their heroes under <i>Your setup</i>.
          </span>
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => session.send(QUEST_MSG.unload, {})}>
              Set aside
            </Button>
          ) : null}
        </div>
      ) : null}
      {!canEdit ? (
        loaded ? null : <p className="dc-field__hint">The host can resume a saved adventure from their device.</p>
      ) : saves === null ? (
        <p className="dc-field__hint">Looking for saves…</p>
      ) : saves.length === 0 ? (
        <p className="dc-field__hint">No saves yet. Checkpoints at the start of each chapter are saved to the host’s device automatically.</p>
      ) : (
        <ul className="qs-saves__list">
          {saves.map((s) => (
            <li key={s.id} className="qs-save">
              <div className="qs-save__party" aria-hidden>
                {s.data.info.heroes.slice(0, 4).map((h) => (
                  <Portrait key={h.slot} hero={{ archetype: h.archetype, color: '#a3e635', ko: h.ko }} size={20} />
                ))}
              </div>
              <div className="qs-save__text">
                <b>{s.data.info.packTitle}</b>
                <small>
                  Ch. {s.data.info.chapter}: {s.data.info.chapterTitle} · {s.data.info.heroes.length} hero{s.data.info.heroes.length === 1 ? '' : 'es'} · {ago(s.updatedAt)}
                </small>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (s.data.blob.length < SAVE_BLOB_MIN || s.data.blob.length > SAVE_BLOB_MAX) {
                    toast('error', 'That save is damaged and can’t be loaded.');
                    return;
                  }
                  sfx('coin');
                  session.send(QUEST_MSG.load, { blob: s.data.blob });
                }}
              >
                Continue
              </Button>
              <IconButton
                icon="trash"
                size="sm"
                label={`Delete save: ${s.name}`}
                onClick={async () => {
                  try {
                    await persistence().deletePreset('quest-save', s.id);
                    toast('info', 'Save deleted.');
                  } catch {
                    toast('error', 'That save could not be deleted.');
                  }
                  setRev((r) => r + 1);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
