/**
 * Forbidden Letter host review: the host approves or rejects answers DASwords couldn't place in
 * the category. The list is anonymous (authors are revealed with the scores).
 */
import { WORDS_MSG, type WordsPrivate, type WordsPublicState, type WordsReviewItem } from '@dascade/shared/games/words';
import { Button, PixelIcon, cx } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { ForbiddenCard } from './Play.tsx';
import { useJson } from './hooks.ts';

const STATUS_LABEL = { pending: 'Waiting', accepted: 'Approved', rejected: 'Rejected' } as const;

export function ReviewStage({ state, isHost, priv }: { state: WordsPublicState; isHost: boolean; priv: WordsPrivate | null }) {
  const items = useJson<WordsReviewItem[]>(state.reviewJson, []);
  const mine = new Set((priv?.entries ?? []).filter((e) => e.status !== 'rejected' || e.reason === 'category').map((e) => e.word));
  const pending = items.filter((i) => i.status === 'pending').length;
  const decide = (id: string, verdict: 'accept' | 'reject') => session.send(WORDS_MSG.review, { round: state.round, id, verdict });
  const decideAll = (verdict: 'accept' | 'reject') => session.send(WORDS_MSG.reviewAll, { round: state.round, verdict });

  return (
    <div className="wd-review">
      <ForbiddenCard category={state.category} hint={state.categoryHint} letter={state.forbidden} compact />
      <section className="wd-review__panel" aria-label="Answers to review">
        <header className="wd-review__head">
          <h2 className="wd-review__title">
            <PixelIcon name="help" size={16} /> {isHost ? 'Do these fit the category?' : 'The host is checking these answers'}
          </h2>
          <p className="wd-review__sub">
            Spelling and the forbidden letter are already checked. {isHost ? 'Judge only whether each one fits.' : 'Authors stay hidden until the scores.'}{' '}
            <span className="dc-num">{pending}</span> left.
          </p>
          {isHost && pending > 0 ? (
            <div className="wd-review__all">
              <Button size="sm" variant="success" icon="check" onClick={() => decideAll('accept')}>
                Approve all left
              </Button>
              <Button size="sm" variant="ghost" icon="close" onClick={() => decideAll('reject')}>
                Reject all left
              </Button>
            </div>
          ) : null}
        </header>
        <ul className="wd-review__list">
          {items.map((item) => (
            <li key={item.id} className={cx('wd-review__item', mine.has(item.text) && 'is-mine')} data-status={item.status}>
              <span className="wd-review__text">{item.text}</span>
              {item.count > 1 ? <span className="wd-review__count dc-num">×{item.count}</span> : null}
              {mine.has(item.text) ? <span className="wd-review__mine">yours</span> : null}
              {isHost && item.status === 'pending' ? (
                <span className="wd-review__actions">
                  <Button size="sm" variant="success" icon="check" aria-label={`Fits: approve ${item.text}`} onClick={() => decide(item.id, 'accept')}>
                    Fits
                  </Button>
                  <Button size="sm" variant="danger" icon="close" aria-label={`Nope: reject ${item.text}`} onClick={() => decide(item.id, 'reject')}>
                    Nope
                  </Button>
                </span>
              ) : (
                <span className="wd-review__status" data-status={item.status}>
                  {item.status === 'accepted' ? <PixelIcon name="check" size={12} /> : item.status === 'rejected' ? <PixelIcon name="close" size={12} /> : null}
                  {STATUS_LABEL[item.status]}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="wd-review__foot">Anything not reviewed when the timer ends is approved.</p>
      </section>
    </div>
  );
}
