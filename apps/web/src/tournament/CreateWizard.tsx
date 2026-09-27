/**
 * "Create tournament" wizard: game → format & series → field & check-in → name & game settings.
 * Only tournament-capable games, only that game's formats / series lengths / field size. The config
 * is validated with the same TournamentConfigSchema the server uses before the kiosk room is created.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  GAME_CATALOG,
  SEEDING_LABELS,
  SERIES_RULES_TEXT,
  TOURNAMENT_FORMAT_BLURBS,
  TOURNAMENT_FORMAT_LABELS,
  TOURNAMENT_GAME_LIST,
  TOURNAMENT_LIMITS,
  TournamentConfigSchema,
  defaultTournamentConfig,
  tournamentConfigProblem,
  type GameId,
  type SeedingMethod,
  type TournamentConfig,
  type TournamentFormat,
} from '@dascade/shared';
import { TOURNAMENT_GAME_SETTINGS } from '@dascade/shared/tournamentGames';
import { Button, Field, NumberInput, PixelIcon, Segmented, Select, TextInput, Toggle, cx } from '@dascade/ui';
import { selectCanPlay, useApp } from '../app/store.ts';
import { session, useSessionStore } from '../net/session.ts';
import { sfx } from '../audio/audio.ts';
import { ProfileEditor, commitProfileName } from '../shell/common.tsx';

type Step = 'game' | 'format' | 'field' | 'finish';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'game', label: 'Game' },
  { id: 'format', label: 'Format' },
  { id: 'field', label: 'Players' },
  { id: 'finish', label: 'Name & go' },
];

const SEEDING_HELP: Record<SeedingMethod, string> = {
  random: 'A fair random draw by the server when the tournament starts.',
  manual: 'You put the players in order yourself before starting.',
  rating: 'Strongest DASCADE rating gets seed 1 (equal ratings are drawn by lot).',
};

const FORMAT_ICON: Record<TournamentFormat, 'trophy' | 'heart' | 'refresh' | 'star'> = {
  single_elimination: 'trophy',
  double_elimination: 'heart',
  round_robin: 'refresh',
  swiss: 'star',
};

export function isTournamentGame(id: string | null | undefined): id is GameId {
  return TOURNAMENT_GAME_LIST.some((g) => g.id === id);
}

function bestOfLabel(n: number): string {
  return n === 1 ? 'Single game' : n === 2 ? 'Best of 2 · mini-match' : `Best of ${n}`;
}

/** Plain object copy for the create options (the config interface has no index signature). */
function toSettings(config: TournamentConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

export function CreateWizard({ initialGame, onCancel }: { initialGame: GameId | null; onCancel: () => void }) {
  const navigate = useNavigate();
  const profileConfirmed = useApp((s) => s.profileConfirmed);
  // "Create" enables from the typed name (a tap on iOS doesn't blur the field to commit it).
  const canPlay = useApp(selectCanPlay);
  const profileName = useApp((s) => s.profile.name);
  const [step, setStep] = useState<Step>(initialGame ? 'format' : 'game');
  const [config, setConfig] = useState<TournamentConfig>(() => defaultTournamentConfig(initialGame ?? 'chess'));
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();

  const game = GAME_CATALOG[config.gameId];
  const cap = game.tournament!;
  const settingsFields = TOURNAMENT_GAME_SETTINGS[config.gameId] ?? [];
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const patch = (p: Partial<TournamentConfig>) => {
    setError(null);
    setConfig((c) => ({ ...c, ...p }));
  };

  const pickGame = (id: GameId) => {
    sfx('click');
    const next = defaultTournamentConfig(id);
    setConfig((c) => ({
      ...next,
      name: nameTouched ? c.name : next.name,
      visibility: c.visibility,
      checkIn: c.checkIn,
      checkInMinutes: c.checkInMinutes,
    }));
    setStep('format');
  };

  // Default the per-game settings (e.g. time control) whenever the game changes.
  useEffect(() => {
    setConfig((c) => {
      const gs: Record<string, unknown> = {};
      for (const f of TOURNAMENT_GAME_SETTINGS[c.gameId] ?? []) {
        const opt = f.options.find((o) => o.id === f.defaultId) ?? f.options[0];
        if (opt) gs[f.key] = opt.value;
      }
      return { ...c, gameSettings: gs };
    });
  }, [config.gameId]);

  const problem = useMemo(() => {
    if (!config.name.trim()) return 'Give your tournament a name.';
    return tournamentConfigProblem(config);
  }, [config]);

  const create = async () => {
    const parsed = TournamentConfigSchema.safeParse({ ...config, name: config.name.trim() });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the settings and try again.');
      return;
    }
    if (!commitProfileName()) {
      setError('Pick your organizer name first.');
      return;
    }
    setBusy(true);
    setError(null);
    sfx('start');
    const code = await session.createRoom('tournament', {
      settings: toSettings(parsed.data as TournamentConfig),
      roomName: parsed.data.name,
    });
    setBusy(false);
    if (code) navigate(`/room/${code}`);
    else setError(useSessionStore.getState().error?.message ?? 'Could not create the tournament. Try again.');
  };

  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!.id);
  const back = () => (stepIndex === 0 ? onCancel() : setStep(STEPS[stepIndex - 1]!.id));

  // Next/Back sit below long steps (phones, landscape): start each new step at the wizard's heading
  // instead of leaving the reader at the bottom of a page whose content just changed above them.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [step]);

  return (
    <section className="tc-wiz" data-part="tournament-wizard" aria-labelledby={headingId} ref={rootRef}>
      <header className="tc-wiz__head" data-part="tournament-wizard-header">
        <h2 id={headingId} className="tc-wiz__title">
          Create a tournament
        </h2>
        <ol className="tc-wiz__steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="tc-wiz__step"
                aria-current={s.id === step ? 'step' : undefined}
                data-done={i < stepIndex || undefined}
                disabled={i > stepIndex}
                onClick={() => setStep(s.id)}
              >
                <span className="tc-wiz__num dc-num">{i + 1}</span>
                <span className="tc-wiz__steplabel">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </header>

      <div className="tc-wiz__body">
        <div className="tc-wiz__main">
          {step === 'game' ? (
            <WizSection title="Pick the game" hint="Head-to-head games that support tournaments.">
              <div className="tc-games" role="radiogroup" aria-label="Game">
                {TOURNAMENT_GAME_LIST.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={g.id === config.gameId}
                    className="tc-game"
                    style={{ '--g': g.accent.primary, '--g2': g.accent.secondary } as React.CSSProperties}
                    onClick={() => pickGame(g.id)}
                  >
                    <span className="tc-game__marquee">{g.marquee}</span>
                    <span className="tc-game__tag">{g.tagline}</span>
                    <span className="tc-game__caps">
                      <span>{g.tournament!.formats.length} formats</span>
                      <span>Bo {g.tournament!.bestOf.join('/')}</span>
                      <span>≤ {g.tournament!.maxField}</span>
                    </span>
                  </button>
                ))}
              </div>
            </WizSection>
          ) : null}

          {step === 'format' ? (
            <>
              <WizSection title="Format" hint={`Formats available for ${game.title}.`}>
                <div className="tc-formats" role="radiogroup" aria-label="Format">
                  {cap.formats.map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={f === config.format}
                      className="tc-format"
                      onClick={() => {
                        sfx('click');
                        patch({ format: f });
                      }}
                    >
                      <PixelIcon name={FORMAT_ICON[f]} className="tc-format__icon" />
                      <span className="tc-format__name">{TOURNAMENT_FORMAT_LABELS[f]}</span>
                      <span className="tc-format__blurb">{TOURNAMENT_FORMAT_BLURBS[f]}</span>
                    </button>
                  ))}
                </div>
              </WizSection>
              <WizSection title="Match length" hint={cap.sides ? 'Games per match. Sides alternate every game.' : 'Games per match.'}>
                <Segmented<string>
                  label="Games per match"
                  value={String(config.bestOf)}
                  onChange={(v) => patch({ bestOf: Number(v) })}
                  options={cap.bestOf.map((n) => ({ value: String(n), label: n === 1 ? 'Single' : n === 2 ? 'Bo2' : `Bo${n}` }))}
                />
                <p className="dc-field__hint">
                  {bestOfLabel(config.bestOf)}. {config.bestOf > 1 ? SERIES_RULES_TEXT[0] : 'One game decides each match.'}
                </p>
                {config.format === 'swiss' ? (
                  <Field label="Swiss rounds" hint="Auto picks enough rounds for a clear winner (about log₂ of the field, at least 3).">
                    {({ id }) => (
                      <div className="dc-row">
                        <Toggle
                          label="Automatic"
                          checked={config.swissRounds === 0}
                          onChange={(on) => patch({ swissRounds: on ? 0 : 4 })}
                        />
                        {config.swissRounds > 0 ? (
                          <NumberInput
                            id={id}
                            min={1}
                            max={TOURNAMENT_LIMITS.swissRoundsMax}
                            value={config.swissRounds}
                            onChange={(n) => patch({ swissRounds: n })}
                            aria-label="Number of rounds"
                          />
                        ) : null}
                      </div>
                    )}
                  </Field>
                ) : null}
                {config.format === 'double_elimination' ? (
                  <Toggle
                    label="Bracket reset — if the losers-bracket champion wins the grand final, play one more match"
                    checked={config.grandFinalReset}
                    onChange={(grandFinalReset) => patch({ grandFinalReset })}
                  />
                ) : null}
              </WizSection>
            </>
          ) : null}

          {step === 'field' ? (
            <>
              <WizSection
                title="Field size"
                hint={`2 to ${cap.maxField} players for ${game.title}. Odd numbers are fine — byes are handed out fairly.`}
              >
                <Field label="Maximum players" aside={<span className="dc-num">{config.maxField}</span>}>
                  {({ id }) => (
                    <NumberInput
                      id={id}
                      min={TOURNAMENT_LIMITS.minField}
                      max={Math.min(cap.maxField, TOURNAMENT_LIMITS.maxField)}
                      value={config.maxField}
                      onChange={(maxField) => patch({ maxField })}
                    />
                  )}
                </Field>
              </WizSection>
              <WizSection title="Seeding" hint="How the bracket or first round is drawn. Recorded in the tournament log.">
                <Segmented<SeedingMethod>
                  label="Seeding method"
                  value={config.seeding}
                  onChange={(seeding) => patch({ seeding })}
                  options={(['random', 'rating', 'manual'] as const).map((m) => ({ value: m, label: SEEDING_LABELS[m] }))}
                />
                <p className="dc-field__hint">{SEEDING_HELP[config.seeding]}</p>
              </WizSection>
              <WizSection
                title="Check-in"
                hint="Ask registered players to confirm they are here before you start. No-shows are dropped from the field."
              >
                <Toggle label="Require check-in" checked={config.checkIn} onChange={(checkIn) => patch({ checkIn })} />
                {config.checkIn ? (
                  <Field label="Check-in window (minutes)" hint="Starts when you open check-in. 0 = open until you close it or start.">
                    {({ id }) => (
                      <NumberInput
                        id={id}
                        min={0}
                        max={TOURNAMENT_LIMITS.checkInMinutesMax}
                        value={config.checkInMinutes}
                        onChange={(checkInMinutes) => patch({ checkInMinutes })}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label="No-show forfeit (minutes)" hint="An absent player forfeits this long after their match opens. 0 = never.">
                  {({ id }) => (
                    <NumberInput
                      id={id}
                      min={0}
                      max={TOURNAMENT_LIMITS.noShowMinutesMax}
                      value={config.noShowMinutes}
                      onChange={(noShowMinutes) => patch({ noShowMinutes })}
                    />
                  )}
                </Field>
              </WizSection>
            </>
          ) : null}

          {step === 'finish' ? (
            <>
              <WizSection title="Name it">
                <Field label="Tournament name" hint={`${TOURNAMENT_LIMITS.name} characters max. Everyone sees it.`}>
                  {({ id, describedBy }) => (
                    <TextInput
                      id={id}
                      aria-describedby={describedBy}
                      value={config.name}
                      maxLength={TOURNAMENT_LIMITS.name}
                      placeholder={`${game.title} Open`}
                      onChange={(e) => {
                        setNameTouched(true);
                        patch({ name: e.currentTarget.value });
                      }}
                    />
                  )}
                </Field>
                <div className="dc-field">
                  <span className="dc-field__label">Listing</span>
                  <Segmented<'public' | 'unlisted'>
                    label="Listing"
                    value={config.visibility}
                    onChange={(visibility) => patch({ visibility })}
                    options={[
                      { value: 'public', label: 'Listed' },
                      { value: 'unlisted', label: 'Code only' },
                    ]}
                  />
                  <span className="dc-field__hint">
                    {config.visibility === 'public'
                      ? 'Shown on the Tournament Center board.'
                      : 'Hidden from the board — share the code or link.'}
                  </span>
                </div>
              </WizSection>
              {settingsFields.length > 0 ? (
                <WizSection title={`${game.title} settings`} hint="Every match of the tournament uses these. Players can’t change them.">
                  {settingsFields.map((f) => {
                    const current =
                      f.options.find((o) => JSON.stringify(o.value) === JSON.stringify(config.gameSettings[f.key])) ??
                      f.options.find((o) => o.id === f.defaultId);
                    return (
                      <Field key={f.key} label={f.label} hint={f.help}>
                        {({ id }) => (
                          <Select
                            id={id}
                            value={current?.id ?? f.defaultId}
                            onChange={(e) => {
                              const opt = f.options.find((o) => o.id === e.currentTarget.value);
                              if (opt) patch({ gameSettings: { ...config.gameSettings, [f.key]: opt.value } });
                            }}
                          >
                            {f.options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    );
                  })}
                </WizSection>
              ) : null}
              {!profileConfirmed ? (
                <WizSection title="Your organizer name" hint="You run the tournament: start rounds, fix problems, crown the champion.">
                  <ProfileEditor compact />
                </WizSection>
              ) : null}
            </>
          ) : null}
        </div>

        <aside className="tc-wiz__summary" aria-label="Summary" style={{ '--g': game.accent.primary } as React.CSSProperties}>
          <span className="dc-label">Summary</span>
          <p className="tc-wiz__sumname">{config.name.trim() || 'Untitled tournament'}</p>
          <dl className="tc-wiz__facts">
            <div>
              <dt>Game</dt>
              <dd>{game.title}</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>{TOURNAMENT_FORMAT_LABELS[config.format]}</dd>
            </div>
            <div>
              <dt>Matches</dt>
              <dd>{bestOfLabel(config.bestOf)}</dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>
                up to <span className="dc-num">{config.maxField}</span>
              </dd>
            </div>
            <div>
              <dt>Seeding</dt>
              <dd>{SEEDING_LABELS[config.seeding]}</dd>
            </div>
            <div>
              <dt>Check-in</dt>
              <dd>{config.checkIn ? (config.checkInMinutes ? `${config.checkInMinutes} min window` : 'Until closed') : 'Off'}</dd>
            </div>
            {settingsFields.map((f) => {
              const current = f.options.find((o) => JSON.stringify(o.value) === JSON.stringify(config.gameSettings[f.key]));
              return current ? (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{current.label}</dd>
                </div>
              ) : null;
            })}
            <div>
              <dt>Organizer</dt>
              <dd>{profileName || '—'}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <footer className="tc-wiz__foot">
        {error ? (
          <p className="dc-field__error tc-wiz__error" role="alert">
            {error}
          </p>
        ) : null}
        <Button variant="ghost" icon="arrow-left" onClick={back}>
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </Button>
        <span className="dc-spacer" />
        {step === 'finish' ? (
          <Button
            variant="gold"
            size="lg"
            icon="trophy"
            loading={busy}
            disabled={Boolean(problem) || !canPlay}
            onClick={create}
            title={problem ?? undefined}
          >
            Create tournament
          </Button>
        ) : step === 'game' ? null : (
          <Button
            variant="primary"
            size="lg"
            icon="arrow-right"
            onClick={next}
            disabled={step === 'format' && Boolean(tournamentConfigProblem(config))}
          >
            Next
          </Button>
        )}
      </footer>
    </section>
  );
}

function WizSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cx('tc-wiz__section')} aria-labelledby={id}>
      <h3 id={id} className="tc-wiz__h">
        {title}
      </h3>
      {hint ? <p className="tc-wiz__hint">{hint}</p> : null}
      <div className="tc-wiz__fields">{children}</div>
    </section>
  );
}
