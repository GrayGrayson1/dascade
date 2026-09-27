/**
 * Room state reflection stays lean: a joining client is only told about its own room's schema
 * types, not every cabinet's (all room states inherit from BaseRoomState, and @colyseus/schema
 * otherwise pulls every registered subclass of an ancestor into the handshake).
 */
import { describe, expect, it } from 'vitest';
import { Encoder, Reflection, TypeContext, schema, t, type Schema } from '@colyseus/schema';
import { BaseRoomState, PlayerState } from '../src/schema/base.ts';
import { PartyRoomState } from '../src/rooms/party/schema.ts';
import { WheelState } from '../src/rooms/wheel/WheelState.ts';
import { primeRoomStateContext } from '../src/schema/typeContext.ts';

// Stand-ins for other cabinets' states (each with its own nested types).
const OtherPiece = schema({ kind: t.string().default(''), x: t.uint8().default(0) }, 'R5OtherPiece');
const OtherGameState = BaseRoomState.extend({ pieces: t.array(OtherPiece), note: t.string().default('') }, 'R5OtherGameState');
const PartyGameDetail = schema({ prompt: t.string().default('') }, 'R5PartyGameDetail');
const PartyGameState = PartyRoomState.extend({ detail: t.ref(PartyGameDetail), questionJson: t.string().default('') }, 'R5PartyGameState');
const SiblingPartyState = PartyRoomState.extend({ other: t.string().default('') }, 'R5SiblingPartyState');

/** schema() builder classes are Schema subclasses; TypeContext's API is typed with `typeof Schema`. */
const k = (builder: unknown) => builder as typeof Schema;

function typesOf(context: TypeContext): Set<unknown> {
  return new Set(context.schemas.keys());
}

describe('room state TypeContext', () => {
  it('without priming, a root state drags in every sibling subclass of BaseRoomState (the problem)', () => {
    const Probe = BaseRoomState.extend({ probe: t.string().default('') }, 'R5ProbeState');
    const context = new TypeContext(k(Probe));
    expect(context.has(k(OtherGameState))).toBe(true);
    expect(context.has(k(OtherPiece))).toBe(true);
  });

  it("describes only the room's own type chain and field types", () => {
    const context = primeRoomStateContext(new WheelState());
    const types = typesOf(context);
    expect(types.has(WheelState)).toBe(true);
    expect(types.has(BaseRoomState)).toBe(true);
    expect(types.has(PlayerState)).toBe(true);
    for (const foreign of [OtherGameState, OtherPiece, PartyRoomState, PartyGameState, SiblingPartyState, PartyGameDetail]) {
      expect(types.has(foreign)).toBe(false);
    }
    // The Encoder Colyseus builds for the room uses this cached context.
    const encoder = new Encoder(new WheelState());
    expect(encoder.context).toBe(context);
    expect(Reflection.encode(encoder).length).toBeLessThan(4096);
  });

  it('keeps kit parents and nested field types for multi-level states, and still decodes', () => {
    const state = new PartyGameState();
    state.detail = new PartyGameDetail();
    state.detail.prompt = 'Name a neon colour';
    state.questionJson = '{"q":1}';
    state.roomName = 'Lean room';
    const context = primeRoomStateContext(state);
    const types = typesOf(context);
    for (const own of [PartyGameState, PartyRoomState, BaseRoomState, PartyGameDetail, PlayerState]) expect(types.has(own)).toBe(true);
    for (const foreign of [SiblingPartyState, OtherGameState, WheelState]) expect(types.has(foreign)).toBe(false);

    // Round trip through reflection, as a client would decode it.
    const encoder = new Encoder(state);
    const decoder = Reflection.decode(Reflection.encode(encoder));
    decoder.decode(encoder.encodeAll());
    const decoded = decoder.state.toJSON() as Record<string, unknown>;
    expect(decoded.roomName).toBe('Lean room');
    expect(decoded.questionJson).toBe('{"q":1}');
    expect(decoded.detail).toEqual({ prompt: 'Name a neon colour' });
  });

  it('restores the global subclass registry, so every other room can be primed afterwards', () => {
    primeRoomStateContext(new WheelState());
    expect(TypeContext.inheritedTypes.get(k(BaseRoomState))?.has(k(OtherGameState))).toBe(true);
    expect(TypeContext.inheritedTypes.get(k(PartyRoomState))?.has(k(SiblingPartyState))).toBe(true);
    const sibling = typesOf(primeRoomStateContext(new SiblingPartyState()));
    expect(sibling.has(SiblingPartyState)).toBe(true);
    expect(sibling.has(PartyGameState)).toBe(false);
  });
});
