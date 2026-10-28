/**
 * The Awards desk (Production Desk, Awards A): the console drawer's Awards tab during the quiz, and
 * the presenter's results screen after it. Fill in each award's 1st, 2nd and 3rd — a name and, if you
 * like, a photo (paste a Teams screenshot with Ctrl/Cmd+V, drop a file, or pick one) — then run the
 * ceremony on the stage: Start, then Next for each step. A place's reveal plays the drumroll, then the
 * place and the applause; fireworks follow the last winner; then Thanks for playing.
 *
 * Nothing shows on the share until Start, and nothing here reaches the server: names and photos stay
 * in this browser (awards.ts).
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { SHOWDOWN_MSG, type ShowdownFinale } from '@dascade/shared/games/showdown';
import { Button, IconButton, PixelIcon, cx } from '@dascade/ui';
import { session } from '../../../net/hooks.ts';
import { sfx } from '../../../audio/audio.ts';
import {
  AWARD_CATEGORIES_MAX,
  AWARD_NAME_MAX,
  AWARD_TITLE_MAX,
  addCategory,
  awardSteps,
  awardsView,
  clearAwardPhoto,
  fillFromPodium,
  removeCategory,
  renameCategory,
  resetAwards,
  setAwardName,
  setAwardPhoto,
  setAwardsRolling,
  setAwardsStep,
  useAwards,
  type AwardCategory,
  type AwardPlace,
  type AwardStep,
} from '../awards.ts';
import { useSceneCard } from '../state.ts';
import { placeWord } from '../standings.ts';

/** The drumroll before a place comes up (the recorded roll's length). */
export const AWARD_ROLL_MS = 2600;

let rollTimer: ReturnType<typeof setTimeout> | null = null;

function stopRoll(): void {
  if (rollTimer) clearTimeout(rollTimer);
  rollTimer = null;
  if (awardsView().rolling) setAwardsRolling(false);
}

/** The ceremony's step `to`: a place gets the drumroll first, then comes up with the applause. */
function goStep(to: number): void {
  const steps = awardSteps(awardsView().categories);
  const target = steps[to];
  if (!target || awardsView().rolling) return;
  sfx('select');
  if (target.kind === 'place' && to > awardsView().at) {
    session.send(SHOWDOWN_MSG.cue, { cue: 'drumroll' });
    setAwardsRolling(true);
    rollTimer = setTimeout(() => {
      rollTimer = null;
      setAwardsStep(to);
      session.send(SHOWDOWN_MSG.cue, { cue: 'applause' });
    }, AWARD_ROLL_MS);
    return;
  }
  setAwardsStep(to);
  if (target.kind === 'thanks') session.send(SHOWDOWN_MSG.card, { card: 'thanks' });
}

/** Starts the ceremony on every stage (the title card first). False when there's nobody to award yet. */
export function startAwards(): boolean {
  const steps = awardSteps(awardsView().categories);
  if (!steps.some((s) => s.kind === 'place')) return false;
  stopRoll();
  setAwardsStep(0);
  sfx('select');
  session.send(SHOWDOWN_MSG.card, { card: 'awards' });
  return true;
}

/** What a step puts on the stage, in the console's words. */
export function awardStepWords(step: AwardStep | undefined, categories: readonly AwardCategory[]): string {
  if (!step) return '';
  switch (step.kind) {
    case 'title':
      return 'the awards’ title card';
    case 'category':
      return categories[step.cat]?.title ?? 'the next award';
    case 'place':
      return `${placeWord(step.place)} place · ${categories[step.cat]?.title ?? ''}`;
    case 'thanks':
      return 'Thanks for playing';
  }
}

export function AwardsPanel({ finale = null }: { finale?: ShowdownFinale | null }) {
  const awards = useAwards();
  const up = useSceneCard() === 'awards';
  const steps = awardSteps(awards.categories);
  const winners = steps.filter((s) => s.kind === 'place').length;
  const at = Math.min(awards.at, steps.length - 1);
  const next = up ? steps[at + 1] : undefined;
  const podium = useMemo(() => finale?.podium ?? [], [finale]);

  // Leaving the Awards scene stops a drumroll that hadn't landed yet.
  useEffect(() => {
    if (!up) stopRoll();
  }, [up]);

  // Trivia Champions fill themselves from the finale's podium (once, while still empty).
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !awards.ready || !podium.length) return;
    filled.current = true;
    for (const c of awards.categories) if (c.finale && c.places.every((p) => !p.name.trim())) fillFromPodium(c.id, podium);
  }, [awards.ready, awards.categories, podium]);

  return (
    <div className="sdc-tab sdc-awards" data-part="showdown-awards-panel">
      <div className="sdc-tabsection sdc-awards__run">
        <h3 className="sd-panel__title">
          <PixelIcon name="trophy" /> The ceremony
        </h3>
        {up ? (
          <>
            <p className="sdc-awards__now" data-part="showdown-awards-now">
              On the stage: <b>{awardStepWords(steps[at], awards.categories)}</b>
              {awards.rolling ? ' · drumroll…' : ''}
            </p>
            <div className="sd-row sd-row--wrap">
              <Button
                size="sm"
                variant="ghost"
                icon="arrow-left"
                disabled={at <= 0 || awards.rolling}
                onClick={() => {
                  stopRoll();
                  setAwardsStep(at - 1);
                }}
              >
                Back
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={next?.kind === 'place' ? 'trophy' : 'arrow-right'}
                disabled={!next || awards.rolling}
                onClick={() => goStep(at + 1)}
                data-part="showdown-awards-next"
              >
                {next ? `Next: ${awardStepWords(next, awards.categories)}` : 'That’s the whole ceremony'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="sd-muted">
              Nothing here shows on the share until you press Start. {winners ? `${winners} winner${winners === 1 ? '' : 's'} ready.` : ''}
            </p>
            <Button size="sm" variant="primary" icon="trophy" disabled={!winners} onClick={startAwards} data-part="showdown-awards-start">
              Start the ceremony
            </Button>
          </>
        )}
      </div>

      <p className="sd-muted sdc-awards__how">
        Names and photos stay in this browser. Paste a Teams screenshot into a row (Ctrl/Cmd+V), drop a photo on it, or press its photo
        button.
      </p>
      {awards.categories.map((c) => (
        <CategoryEditor
          key={c.id}
          category={c}
          photos={awards.photos}
          podium={podium.length > 0}
          onFill={() => fillFromPodium(c.id, podium)}
        />
      ))}
      <div className="sd-row sd-row--wrap">
        <Button size="sm" variant="ghost" icon="plus" disabled={awards.categories.length >= AWARD_CATEGORIES_MAX} onClick={addCategory}>
          Add an award
        </Button>
        <ClearAll />
      </div>
    </div>
  );
}

function CategoryEditor({
  category,
  photos,
  podium,
  onFill,
}: {
  category: AwardCategory;
  photos: Readonly<Record<string, string>>;
  podium: boolean;
  onFill: () => void;
}) {
  return (
    <fieldset className="sdc-tabsection sdc-award" data-part="showdown-award">
      <legend className="sdc-award__head">
        <input
          className="dc-input sdc-award__title"
          value={category.title}
          maxLength={AWARD_TITLE_MAX}
          onChange={(e) => renameCategory(category.id, e.currentTarget.value)}
          aria-label="Award"
        />
        <IconButton icon="trash" size="sm" variant="ghost" label={`Remove ${category.title}`} onClick={() => removeCategory(category.id)} />
      </legend>
      {category.finale ? (
        podium ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={onFill}>
            Fill from the finale
          </Button>
        ) : (
          <p className="sd-muted">Fills itself from the finale’s podium after Finish show.</p>
        )
      ) : null}
      {([1, 2, 3] as const).map((place) => (
        <PlaceRow key={place} category={category} place={place} photo={photos[category.places[place - 1].photo]} />
      ))}
    </fieldset>
  );
}

function PlaceRow({ category, place, photo }: { category: AwardCategory; place: AwardPlace; photo?: string }) {
  const entry = category.places[place - 1];
  const file = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState('');
  const [over, setOver] = useState(false);
  const take = (blob: Blob | null | undefined) => {
    if (!blob) return;
    setSaid('Adding…');
    setAwardPhoto(category.id, place, blob).then(
      () => setSaid(''),
      () => setSaid('That isn’t a picture this browser can read.'),
    );
  };
  const onPaste = (e: ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    take(item.getAsFile());
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')));
  };
  const word = placeWord(place);
  return (
    <div
      className={cx('sdc-award__row', over && 'is-over')}
      data-place={place}
      onPaste={onPaste}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span className="sdc-award__place">{word}</span>
      <button
        type="button"
        className="sdc-award__photo"
        onClick={() => file.current?.click()}
        aria-label={photo ? `Change the photo for ${word} place` : `Add a photo for ${word} place`}
        data-part="showdown-award-photo"
      >
        {photo ? <img src={photo} alt="" /> : <PixelIcon name="plus" />}
      </button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        data-part="showdown-award-file"
        onChange={(e) => {
          take(e.currentTarget.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
      <input
        className="dc-input sdc-award__name"
        value={entry.name}
        maxLength={AWARD_NAME_MAX}
        placeholder="Name"
        onChange={(e) => setAwardName(category.id, place, e.currentTarget.value)}
        aria-label={`${category.title}: ${word} place`}
        data-part="showdown-award-name"
      />
      {photo ? (
        <IconButton
          icon="close"
          size="sm"
          variant="ghost"
          label={`Remove the photo for ${word} place`}
          onClick={() => clearAwardPhoto(category.id, place)}
        />
      ) : null}
      {said ? (
        <span className="sd-muted sdc-award__said" role="status">
          {said}
        </span>
      ) : null}
    </div>
  );
}

/** Clear everything: a second press within a few seconds confirms (the photos are deleted from this browser). */
function ClearAll() {
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(t);
  }, [arming]);
  return (
    <Button
      size="sm"
      variant={arming ? 'danger' : 'ghost'}
      icon="trash"
      onClick={() => {
        if (!arming) return setArming(true);
        setArming(false);
        resetAwards();
      }}
    >
      {arming ? 'Press again to clear every award' : 'Clear all'}
    </Button>
  );
}
