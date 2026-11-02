import { describe, expect, it } from 'vitest';
import { HEARTBEAT_WINDOW_MS, RoomCloseCode, SEAT_RESERVATION_SECONDS } from '@dascade/shared';
import {
  CLOSE_CONSENTED,
  CLOSE_FAILED_TO_RECONNECT,
  CLOSE_SERVER_SHUTDOWN,
  ERROR_RECONNECT_EXPIRED,
  RESTART_PROBE_MS,
  classifyClose,
  consentToLeave,
  fallbackAfterAnswers,
  noticeAfterFailedRejoin,
  toastsRoomError,
} from './reconnectPolicy.ts';

describe('fallbackAfterAnswers', () => {
  it('keeps the event-room fallback at two answered probes (about 10 s)', () => {
    expect(fallbackAfterAnswers(true)).toBe(2);
  });

  it('lets every other room wait until the server would have answered the parked reconnect itself', () => {
    const waitedMs = fallbackAfterAnswers(false) * RESTART_PROBE_MS;
    expect(waitedMs).toBeGreaterThan(HEARTBEAT_WINDOW_MS);
    expect(waitedMs).toBeGreaterThan(SEAT_RESERVATION_SECONDS * 1000);
    // …but not much longer: it's a safety net, not a second grace period.
    expect(waitedMs).toBeLessThanOrEqual(SEAT_RESERVATION_SECONDS * 1000 + RESTART_PROBE_MS);
  });
});

describe('classifyClose', () => {
  it('a removal the server announced, a kick or a closed room ends the visit', () => {
    expect(classifyClose(RoomCloseCode.KICKED, false)).toBe('removed');
    expect(classifyClose(RoomCloseCode.ROOM_CLOSED, false)).toBe('removed');
    expect(classifyClose(1006, true)).toBe('removed');
  });

  it('a consented close from the server is the seat opening elsewhere, never a reason to rejoin', () => {
    expect(classifyClose(CLOSE_CONSENTED, false)).toBe('taken_over');
  });

  it('a shutdown is a restart', () => {
    expect(classifyClose(CLOSE_SERVER_SHUTDOWN, false)).toBe('server_restarted');
  });

  it('a refused reconnect, used-up retries or an abnormal close may still have a seat to take back', () => {
    expect(classifyClose(CLOSE_FAILED_TO_RECONNECT, false)).toBe('dropped');
    expect(classifyClose(1006, false)).toBe('dropped');
    expect(classifyClose(4002, false)).toBe('dropped');
  });
});

describe('consentToLeave', () => {
  it('a late connection to the room the player is rejoining closes without consent (the seat stays)', () => {
    expect(consentToLeave('ABCDE', 'ABCDE')).toBe(false);
  });

  it('a connection to a room the player left or switched away from is left for good', () => {
    expect(consentToLeave('ABCDE', null)).toBe(true);
    expect(consentToLeave('ABCDE', 'FGHJK')).toBe(true);
  });
});

describe('toastsRoomError', () => {
  it('hides the raw "failed to reconnect" while reconnecting, and that error code at any time', () => {
    expect(toastsRoomError('reconnecting', 4002)).toBe(false);
    expect(toastsRoomError('connected', ERROR_RECONNECT_EXPIRED)).toBe(false);
  });

  it('still shows other room errors', () => {
    expect(toastsRoomError('connected', 4002)).toBe(true);
  });
});

describe('noticeAfterFailedRejoin', () => {
  it('keeps "Connection lost" (which rejoins once back online) for anything a retry could fix', () => {
    expect(noticeAfterFailedRejoin('server_unavailable')).toBe('reconnect_failed');
    expect(noticeAfterFailedRejoin('rate_limited')).toBe('reconnect_failed');
    expect(noticeAfterFailedRejoin('unknown')).toBe('reconnect_failed');
  });

  it('shows a final answer as it is', () => {
    for (const kind of ['not_found', 'kicked', 'room_full', 'room_locked', 'match_ended'] as const) {
      expect(noticeAfterFailedRejoin(kind)).toBe(kind);
    }
  });
});
