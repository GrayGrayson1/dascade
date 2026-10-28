/**
 * Drawer tab "Scores" (two-tier scoring): the full live list for the presenter — rank, points, medals,
 * position hits, perfect lists, hidden gems — the medal wall (Spotlight Stars), the score record as
 * CSV or JSON, and "remove a wrong credit" for a tile credited to the hot seat by mistake (a chat
 * answer flipped mid-turn; the server logs it). Only the presenter and crew with `scores.export` get
 * the list (`showdown:scores`); the server checks every action again.
 */
import { useEffect, useState } from 'react';
import {
  SHOWDOWN_MEDAL_INFO,
  SHOWDOWN_MSG,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownScoresFile,
} from '@dascade/shared/games/showdown';
import { Button, PixelIcon } from '@dascade/ui';
import { useRoomMessage, useRoomSelector } from '../../../net/hooks.ts';
import { useSessionStore } from '../../../net/session.ts';
import { sfx } from '../../../audio/audio.ts';
import { showdownApi } from '../api.ts';
import { useCan, useScoresView, useShowdownSettings } from '../state.ts';
import { downloadCsv, downloadJson } from './download.ts';
import { medalSpeech, medalWords, scoresCsv, scoresFileName } from './scores.ts';
import './panels.css';

/** How long a download waits for the server's record before it says so. */
const ASK_MS = 6000;
/** A Remove press must be confirmed within this long. */
const CONFIRM_MS = 4000;

function usePresenter(): boolean {
  const myId = useSessionStore((s) => s.playerId);
  const presenterId = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId) ?? '';
  return Boolean(myId && myId === presenterId);
}

/** Download CSV / Download JSON: asks the server for the record, then builds the file here. */
export function ScoresDownloads({ code, size = 'sm' }: { code: string; size?: 'sm' | 'md' }) {
  const presenter = usePresenter();
  const allowed = useCan('scores.export') || presenter;
  const [asked, setAsked] = useState<'csv' | 'json' | null>(null);
  const [said, setSaid] = useState('');

  useRoomMessage<ShowdownScoresFile>(SHOWDOWN_MSG.scoresExport, (file) => {
    if (!asked || !file) return;
    const kind = asked;
    setAsked(null);
    const name = scoresFileName(code, kind);
    const ok = kind === 'csv' ? downloadCsv(name, scoresCsv(file)) : downloadJson(name, file);
    const n = file.people.length;
    setSaid(ok ? `Scores downloaded: ${n} ${n === 1 ? 'person' : 'people'} (${name}).` : 'This browser couldn’t save the file.');
  });
  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => {
      setAsked(null);
      setSaid('The scores didn’t arrive. Try the download again.');
    }, ASK_MS);
    return () => clearTimeout(t);
  }, [asked]);

  if (!allowed) return null;
  const ask = (kind: 'csv' | 'json') => {
    sfx('select');
    setSaid('');
    setAsked(kind);
    showdownApi.exportScores();
  };
  return (
    <div className="sdp-scoredl">
      <div className="sdp-scoredl__btns">
        <Button
          size={size}
          variant="secondary"
          icon="share"
          loading={asked === 'csv'}
          disabled={asked !== null}
          onClick={() => ask('csv')}
          data-part="showdown-scores-csv"
        >
          Download CSV
        </Button>
        <Button
          size={size}
          variant="ghost"
          icon="share"
          loading={asked === 'json'}
          disabled={asked !== null}
          onClick={() => ask('json')}
          data-part="showdown-scores-json"
        >
          Download JSON
        </Button>
      </div>
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

export function ScoresPanel({ look, code }: { look: ShowdownLook; code: string }) {
  const view = useScoresView();
  const settings = useShowdownSettings();
  const presenter = usePresenter();
  const canFix = useCan('scores.fix') || presenter;
  const [confirm, setConfirm] = useState<{ key: string; at: number } | null>(null);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirm]);

  const points = settings?.points ?? false;
  const medals = (settings?.medals ?? 'never') !== 'never';
  const people = view?.people ?? [];
  const shown = points ? people.filter((p) => p.points > 0 || p.calls > 0) : people;

  const remove = (round: number, slot: number, name: string) => {
    const key = `${round}:${slot}`;
    if (!confirm || confirm.key !== key) {
      setConfirm({ key, at: Date.now() });
      setSaid(`Press Remove again to take #${slot + 1} (round ${round + 1}) off ${name}.`);
      return;
    }
    sfx('select');
    setConfirm(null);
    showdownApi.removeCredit(round, slot);
    setSaid(`Took #${slot + 1} (round ${round + 1}) off ${name}. It’s in the log.`);
  };

  return (
    <section className="sdp-panel sdp-scorespanel" data-look={look} aria-labelledby="sdp-scores-title" data-part="showdown-scores-panel">
      <h3 className="sd-panel__title" id="sdp-scores-title">
        <PixelIcon name="trophy" /> Scores
      </h3>
      {!view ? (
        <p className="sdp-empty">
          Scores show here once the show is running with <b>Score the crowd</b> or medals switched on (setup → Scoring).
        </p>
      ) : (
        <>
          <p className="sdp-lead">
            {points
              ? 'Only you see this whole list — the stage shows the top five, and each phone its own rank.'
              : 'Score the crowd is off.'}{' '}
            Scores follow the board: an Undo takes points and medals back.
          </p>
          <ScoresDownloads code={code} />

          {points ? (
            <>
              <h4 className="sdp-sub">
                Guessers <span className="dc-num">({shown.length})</span>
              </h4>
              {shown.length ? (
                <div className="sdp-scorewrap" role="region" aria-labelledby="sdp-scores-guessers" tabIndex={0}>
                  <table className="sdp-scoretable" data-part="showdown-scores-table">
                    <caption id="sdp-scores-guessers" className="visually-hidden">
                      Every guesser, best first
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Name</th>
                        <th scope="col">Points</th>
                        {medals ? <th scope="col">Medals</th> : null}
                        <th scope="col">
                          <abbr title="Answers called in the right spot">Spot</abbr>
                        </th>
                        <th scope="col">
                          <abbr title="Perfect lists (+20)">Perfect</abbr>
                        </th>
                        <th scope="col">
                          <abbr title="Hidden gems (double points)">Gems</abbr>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr key={p.playerId} data-name={p.name}>
                          <td className="dc-num">{p.rank > 0 ? p.rank : '–'}</td>
                          <th scope="row">{p.name}</th>
                          <td className="dc-num">{p.points}</td>
                          {medals ? (
                            <td>
                              <span aria-label={medalSpeech(p.medals)}>{medalWords(p.medals) || '–'}</span>
                            </td>
                          ) : null}
                          <td className="dc-num">{p.positionHits}</td>
                          <td className="dc-num">{p.perfect}</td>
                          <td className="dc-num">{p.gems}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="sdp-empty">No points yet — they arrive as answers flip.</p>
              )}
            </>
          ) : null}

          {medals ? (
            <>
              <h4 className="sdp-sub">
                Spotlight Stars <span className="dc-num">({view.stars.length})</span>
              </h4>
              {view.stars.length ? (
                <ol className="sdp-stars" aria-label="Spotlight Stars, Olympic order" data-part="showdown-scores-stars">
                  {view.stars.map((s) => (
                    <li key={s.playerId}>
                      <b>{s.name}</b>{' '}
                      <span className="sdp-stars__medals" aria-label={medalSpeech(s.medals)}>
                        {medalWords(s.medals)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="sdp-empty">No medals yet — they pin on when someone in the hot seat gets an answer flipped.</p>
              )}
            </>
          ) : null}

          {canFix && view.credits.length ? (
            <>
              <h4 className="sdp-sub">Hot-seat credits</h4>
              <p className="sdp-note">
                Credited to the wrong person (a chat answer flipped mid-turn)? Remove takes the credit and its medal off.
              </p>
              <ul className="sdp-credits" aria-label="Hot-seat credits">
                {view.credits.map((c) => {
                  const key = `${c.round}:${c.slot}`;
                  const arming = confirm?.key === key;
                  return (
                    <li key={key}>
                      <span>
                        <span aria-hidden>{SHOWDOWN_MEDAL_INFO[c.medal].icon}</span> Round <span className="dc-num">{c.round + 1}</span> · #
                        <span className="dc-num">{c.slot + 1}</span> · <b>{c.name}</b>
                      </span>
                      <Button
                        size="sm"
                        variant={arming ? 'danger' : 'ghost'}
                        icon="close"
                        onClick={() => remove(c.round, c.slot, c.name)}
                        aria-label={
                          arming ? `Confirm: remove #${c.slot + 1} from ${c.name}` : `Remove ${c.name}’s credit for #${c.slot + 1}`
                        }
                        data-part="showdown-credit-remove"
                        data-slot={c.slot}
                        data-round={c.round}
                      >
                        {arming ? 'Remove?' : 'Remove'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </>
      )}
      <p className="sdp-notice" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
