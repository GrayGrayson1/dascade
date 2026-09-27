import { describe, expect, it } from 'vitest';
import { roomCodeFromPath, shouldLeaveBeforeResolving, shouldLeaveOnExit, type SessionPeek } from './roomPath.ts';

const inRoom = (code: string, status: SessionPeek['status'] = 'connected'): SessionPeek => ({ code, hasRoom: true, status });

describe('roomCodeFromPath', () => {
  it('reads (and normalizes) the code of a room path', () => {
    expect(roomCodeFromPath('/room/K7QXM')).toBe('K7QXM');
    expect(roomCodeFromPath('/room/k7qxm/')).toBe('K7QXM');
    expect(roomCodeFromPath('/room/k7-qxm')).toBe('K7QXM');
  });

  it('is null for every other place', () => {
    for (const path of ['/', '/play/holdem', '/cabinet/dasino', '/tournaments', '/r/K7QXM', '/room', '/room/', '/room/K7QXM/extra']) {
      expect(roomCodeFromPath(path)).toBeNull();
    }
  });
});

describe('shouldLeaveOnExit', () => {
  it('leaves when Back (or any link) takes the player off the room screen', () => {
    expect(shouldLeaveOnExit('K7QXM', '/play/holdem', inRoom('K7QXM'))).toBe(true);
    expect(shouldLeaveOnExit('K7QXM', '/', inRoom('K7QXM', 'reconnecting'))).toBe(true);
    // Still connecting (resume after refresh, join prompt): the connection must not land later as a ghost.
    expect(shouldLeaveOnExit('K7QXM', '/', { code: 'K7QXM', hasRoom: false, status: 'connecting' })).toBe(true);
  });

  it('stays for a remount on the same room (StrictMode, error boundary)', () => {
    expect(shouldLeaveOnExit('K7QXM', '/room/K7QXM', inRoom('K7QXM'))).toBe(false);
    expect(shouldLeaveOnExit('K7QXM', '/room/k7qxm', inRoom('K7QXM'))).toBe(false);
  });

  it('defers room → room switches to the next room screen (it takes over)', () => {
    expect(shouldLeaveOnExit('K7QXM', '/room/ABCDE', inRoom('ABCDE'))).toBe(false);
    expect(shouldLeaveOnExit('K7QXM', '/room/ABCDE', inRoom('K7QXM'))).toBe(false);
  });

  it('has nothing to leave once the session is idle or already left', () => {
    expect(shouldLeaveOnExit('K7QXM', '/', { code: null, hasRoom: false, status: 'idle' })).toBe(false);
    expect(shouldLeaveOnExit('K7QXM', '/', { code: 'K7QXM', hasRoom: false, status: 'lost' })).toBe(false);
  });
});

describe('shouldLeaveBeforeResolving', () => {
  it('leaves the room held when another room’s link is opened', () => {
    expect(shouldLeaveBeforeResolving('ABCDE', inRoom('K7QXM'))).toBe(true);
    expect(shouldLeaveBeforeResolving('ABCDE', inRoom('K7QXM', 'reconnecting'))).toBe(true);
    expect(shouldLeaveBeforeResolving('ABCDE', { code: 'K7QXM', hasRoom: false, status: 'connecting' })).toBe(true);
  });

  it('keeps hops that joined the room first, and has nothing to leave when idle', () => {
    expect(shouldLeaveBeforeResolving('ABCDE', inRoom('ABCDE'))).toBe(false);
    expect(shouldLeaveBeforeResolving('ABCDE', { code: 'ABCDE', hasRoom: false, status: 'connecting' })).toBe(false);
    expect(shouldLeaveBeforeResolving('ABCDE', { code: null, hasRoom: false, status: 'idle' })).toBe(false);
    expect(shouldLeaveBeforeResolving('ABCDE', { code: 'K7QXM', hasRoom: false, status: 'lost' })).toBe(false);
  });
});
