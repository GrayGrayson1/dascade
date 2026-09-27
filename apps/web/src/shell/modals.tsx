/** Global modals: Settings, Help / How to play, Profile, Join-by-code. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CABINET_LIST, GAME_CATALOG, GAME_LIST, ROOM_CODE_LENGTH, cabinetForGame, isGameId, normalizeRoomCode, type GameId } from '@dascade/shared';
import { Badge, Button, Field, Modal, PixelIcon, Segmented, Select, Slider, Tabs, TextInput, Toggle, getTheme, useThemeId } from '@dascade/ui';
import { useApp, type FxLevel } from '../app/store.ts';
import { persistence } from '../persistence/index.ts';
import { session } from '../net/session.ts';
import { sfx } from '../audio/audio.ts';
import { ProfileEditor } from './common.tsx';
import { crumbCabinet } from './crumbs.ts';
import { ProfileTabs } from './profile/ProfileTabs.tsx';

export function GlobalModals() {
  const modal = useApp((s) => s.modal);
  const close = useApp((s) => s.closeModal);
  return (
    <>
      <SettingsModal open={modal === 'settings'} onClose={close} />
      <HelpModal open={modal === 'help'} onClose={close} />
      <Modal open={modal === 'profile'} onClose={close} title="Your profile" footer={<Button variant="primary" onClick={close}>Done</Button>}>
        <ProfileTabs onSubmit={close} />
      </Modal>
      <JoinModal open={modal === 'join'} onClose={close} />
    </>
  );
}

// ---------------------------------------------------------------------------
function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const [tab, setTab] = useState<'sound' | 'display' | 'profile' | 'account'>('sound');
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const fullscreenSupported = typeof document.documentElement.requestFullscreen === 'function';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Modal open={open} onClose={onClose} title="Settings" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <Tabs
        label="Settings sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'sound', label: 'Sound' },
          { value: 'display', label: 'Display' },
          { value: 'profile', label: 'Profile' },
          { value: 'account', label: 'Account' },
        ]}
      />
      <div className="settings-body">
        {tab === 'sound' ? (
          <div className="dc-col" style={{ gap: 18 }}>
            <Toggle label="Mute everything" checked={settings.muted} onChange={(muted) => update({ muted })} />
            <Field label="Master volume" aside={pct(settings.masterVolume)}>
              {({ id }) => (
                <Slider id={id} min={0} max={1} step={0.05} value={settings.masterVolume} onChange={(masterVolume) => update({ masterVolume })} />
              )}
            </Field>
            <Field label="Sound effects" aside={pct(settings.sfxVolume)}>
              {({ id }) => (
                <Slider
                  id={id}
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.sfxVolume}
                  onChange={(sfxVolume) => update({ sfxVolume })}
                  onPointerUp={() => sfx('coin')}
                />
              )}
            </Field>
            <Toggle label="Background music (procedural, subtle)" checked={settings.musicEnabled} onChange={(musicEnabled) => update({ musicEnabled })} />
            <Field label="Music volume" aside={pct(settings.musicVolume)}>
              {({ id }) => (
                <Slider
                  id={id}
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.musicVolume}
                  disabled={!settings.musicEnabled}
                  onChange={(musicVolume) => update({ musicVolume })}
                />
              )}
            </Field>
            <p className="dc-field__hint">Sound starts after your first click or key press, as browsers require.</p>
          </div>
        ) : null}
        {tab === 'display' ? (
          <div className="dc-col" style={{ gap: 18 }}>
            <Toggle
              label="Reduce motion (calmer animations, no screen shake)"
              checked={settings.reducedMotion}
              onChange={(reducedMotion) => update({ reducedMotion })}
            />
            <div className="dc-field">
              <span className="dc-field__label">Visual effects</span>
              <Segmented<FxLevel>
                label="Visual effects intensity"
                value={settings.fx}
                onChange={(fx) => update({ fx })}
                options={[
                  { value: 'high', label: 'Full glow' },
                  { value: 'low', label: 'Reduced' },
                  { value: 'off', label: 'Off' },
                ]}
              />
              <span className="dc-field__hint">Lower this on older laptops or if the neon is too much.</span>
            </div>
            <ThemeLine />
            {fullscreenSupported ? (
              <Toggle
                label="Fullscreen"
                checked={fullscreen}
                onChange={(on) => {
                  if (on) void document.documentElement.requestFullscreen().catch(() => undefined);
                  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                }}
              />
            ) : (
              <p className="dc-field__hint">Fullscreen isn’t supported by this browser.</p>
            )}
          </div>
        ) : null}
        {tab === 'profile' ? <ProfileEditor /> : null}
        {tab === 'account' ? <AccountPanel /> : null}
      </div>
    </Modal>
  );
}

/** Read-only for now: DASCADE ships one theme. The line becomes a picker when more themes ship. */
function ThemeLine() {
  const theme = getTheme(useThemeId());
  return (
    <div className="dc-field">
      <span className="dc-field__label">Theme</span>
      <div className="theme-line">
        <span className="theme-line__swatch" aria-hidden>
          <i style={{ background: theme.renderer.accent }} />
          <i style={{ background: theme.renderer.accent2 }} />
          <i style={{ background: theme.renderer.surface }} />
        </span>
        <span className="theme-line__text">
          <strong className="theme-line__name">Theme: {theme.name}</strong>
          <span className="dc-field__hint">{theme.description}</span>
        </span>
      </div>
    </div>
  );
}

function AccountPanel() {
  const p = persistence();
  const info = p.account();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<string | null>(null);
  return (
    <div className="dc-col" style={{ gap: 14 }}>
      <div className="dc-row dc-row--wrap">
        <Badge color={info.kind === 'supabase' ? 'var(--green)' : 'var(--cyan)'} icon="user">
          {info.kind === 'supabase' ? (info.isAnonymous ? 'Cloud guest' : 'Cloud account') : 'Local guest'}
        </Badge>
        {info.email ? <span className="dc-muted">{info.email}</span> : null}
      </div>
      {info.kind === 'local' ? (
        <p className="dc-muted">
          You’re playing as a guest. Your name, settings, wheel presets, bingo patterns and car designs are saved in this browser. No
          account needed.
        </p>
      ) : info.isAnonymous && p.upgradeAccount ? (
        <form
          className="dc-col"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await p.upgradeAccount!(email);
            setResult(r.message);
          }}
        >
          <p className="dc-muted">Your saves sync to the cloud. Add an email to keep them if you switch devices.</p>
          <Field label="Email">
            {({ id }) => <TextInput id={id} type="email" value={email} required onChange={(e) => setEmail(e.currentTarget.value)} />}
          </Field>
          <Button type="submit" variant="primary">
            Keep my account
          </Button>
          {result ? <p role="status">{result}</p> : null}
        </form>
      ) : (
        <p className="dc-muted">Your profile and presets are saved to your account.</p>
      )}
      <p className="dc-field__hint">DASCADE uses virtual arcade chips only — no real money, purchases or payouts, ever.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Unique games per cabinet (DASino lists its tables separately; help is per game). */
const HELP_GROUPS = CABINET_LIST.map((cabinet) => ({
  cabinet,
  games: [...new Set(cabinet.games.map((g) => g.gameId))].map((id) => GAME_CATALOG[id]),
}));
const PLATFORM_GAMES = GAME_LIST.filter((g) => g.cabinet === null);

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const helpGameId = useApp((s) => s.helpGameId);
  const [tab, setTab] = useState<string>(helpGameId && isGameId(helpGameId) ? helpGameId : 'dascade');
  useEffect(() => {
    if (open) setTab(helpGameId && isGameId(helpGameId) ? helpGameId : 'dascade');
  }, [open, helpGameId]);
  const game = isGameId(tab) ? GAME_CATALOG[tab] : null;
  const cabinet = game ? cabinetForGame(game.id) : undefined;
  const siblings = cabinet ? [...new Set(cabinet.games.map((g) => g.gameId))] : [];
  return (
    <Modal open={open} onClose={onClose} wide title="How to play" footer={<Button variant="primary" onClick={onClose}>Got it</Button>}>
      <div className="help-nav">
        <Field label="Help topic" className="help-nav__topic">
          {({ id }) => (
            <Select id={id} value={tab} onChange={(e) => setTab(e.currentTarget.value)}>
              <option value="dascade">DASCADE basics</option>
              {HELP_GROUPS.map(({ cabinet: c, games }) => (
                <optgroup key={c.id} label={c.title}>
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              ))}
              {PLATFORM_GAMES.length ? (
                <optgroup label="Platform">
                  {PLATFORM_GAMES.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          )}
        </Field>
        {siblings.length > 1 && cabinet ? (
          <Tabs
            className="help-nav__siblings"
            label={`${cabinet.title} games`}
            value={tab as GameId}
            onChange={setTab}
            tabs={siblings.map((id) => ({ value: id, label: GAME_CATALOG[id].title }))}
          />
        ) : null}
      </div>
      <div className="help-body">
        {game ? (
          <>
            {crumbCabinet(game.id) ? <p className="help-body__crumb">{cabinet?.title}</p> : null}
            <h3 className="dc-display help-body__title" style={{ color: game.accent.primary }}>
              {game.title}
            </h3>
            <p className="dc-muted help-body__desc">{game.description}</p>
            <ol className="help-steps">
              {game.howToPlay.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <h4 className="dc-label help-body__label">Controls</h4>
            <ul className="help-controls">
              {game.controls.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="dc-field__hint help-body__meta">
              {game.capacity.minPlayers === 1 ? 'Playable solo' : `${game.capacity.minPlayers}+ players`} · up to {game.capacity.maxPlayersLimit} players
              {game.capacity.supportsSpectators ? ' · spectators welcome' : ''}
              {game.virtualChips ? ' · virtual chips only, no real money' : ''}
            </p>
          </>
        ) : (
          <div className="dc-stack">
            <h3 className="dc-display dc-neon help-body__title">Welcome to DASCADE</h3>
            <p>
              The Delta Alpha Sierra Arcade: {CABINET_LIST.length} cabinets and {GAME_LIST.filter((g) => g.cabinet !== null).length} multiplayer
              games you can play right in your browser — no account needed.
            </p>
            <ol className="help-steps">
              <li>
                Walk up to a cabinet (some hold several games — pick one), then choose <strong>Create game</strong>.
              </li>
              <li>Share the 5-letter room code (or the link) with your team.</li>
              <li>Everyone joins the lobby, the host tweaks settings, then hits <strong>Start</strong>.</li>
              <li>
                Already have a code? Use <strong>Join with code</strong> on the arcade floor.
              </li>
            </ol>
            <p className="dc-muted">
              Lost connection? DASCADE reconnects you automatically and keeps your seat. Refreshing the page puts you right back in your
              room — and if the network stays down, <strong>Rejoin my seat</strong> takes it back.
            </p>
            <p className="dc-field__hint">
              All casino-style games use meaningless virtual chips. There is no real-money wagering, purchasing or cash-out of any kind.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function JoinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const profileConfirmed = useApp((s) => s.profileConfirmed);
  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    const c = normalizeRoomCode(code);
    if (c.length !== ROOM_CODE_LENGTH) {
      setError('Room codes are 5 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await session.joinRoom(c);
    setBusy(false);
    if (res.ok) {
      session.clearNotices();
      onClose();
      navigate(`/room/${c}`);
    } else setError(`${res.error.title}. ${res.error.message}`);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join with a code"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} icon="play" onClick={submit} disabled={!profileConfirmed}>
            Join game
          </Button>
        </>
      }
    >
      <form
        className="dc-col"
        style={{ gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Room code" error={error}>
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              className="dc-input--code"
              value={code}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={7}
              placeholder="ABCDE"
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setCode(normalizeRoomCode(e.currentTarget.value).slice(0, 5))}
            />
          )}
        </Field>
        <ProfileEditor compact />
        {!profileConfirmed ? (
          <p className="dc-field__hint">
            <PixelIcon name="info" /> Pick a name first so your team knows who you are.
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
