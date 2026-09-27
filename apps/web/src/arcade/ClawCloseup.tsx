/**
 * The claw machine, up close — you walk up to the floor's claw machine (or press the quick Claw button
 * where the floor has no room for it) and it grows into this: the same machine, big enough to operate.
 * A modal dialog (native <dialog>: focus stays inside, Esc leaves, focus returns to what opened it).
 *
 * The machine is the interface: the joystick and the big button on its control deck ARE the controls
 * (arrow keys / WASD, Space / Enter and a gamepad work too). The physics is clawPhysics.ts on a fixed
 * 120 Hz step; clawRender.ts draws the inside of the glass; the chrome (marquee, bulbs, deck, prize
 * door, shelf) is HTML/SVG styled with the cabinet tokens (clawCloseup.css).
 *
 * Closing rule: before you drop, closing hands the token back (nothing happened). Once you've dropped,
 * the try plays out — closing just settles it instantly (the same steps, not drawn), so a prize is
 * never lost or counted twice. Unmounting (a route change) does the same.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useApp } from '../app/store.ts';
import { spritePaths, spriteColor, spriteSize } from './clawArt.ts';
import { ClawMotor, clawSound } from './clawAudio.ts';
import { ClawConfetti } from './ClawConfetti.tsx';
import { STOCK, kindName, needsRestock, pileToToys, shelfTotal, urlClawSeed, useClaw, type Shelf } from './clawInventory.ts';
import {
  AIM_TIME,
  DT,
  GANTRY,
  KINDS,
  TOY_KINDS,
  buriedLoad,
  cancelAim,
  createSim,
  fastForward,
  insertToken,
  restock,
  settleFully,
  stepClaw,
  type ClawEvent,
  type ClawInput,
  type ClawSim,
  type ClawToy,
  type GripReport,
  type ToyKind,
} from './clawPhysics.ts';
import { VIEW, ageLife, burstBits, drawClawScene, lifeOf, type RenderFx } from './clawRender.ts';
import './clawCloseup.css';

type Lights = 'idle' | 'aim' | 'tense' | 'win' | 'sad' | 'restock';
interface Sign {
  word: string;
  lights: Lights;
}
const IDLE_SIGN: Sign = { word: 'INSERT TOKEN', lights: 'idle' };

const GRIP_LINE: Record<GripReport['quality'], (name: string) => string> = {
  great: (n) => `A firm grip on the ${n}!`,
  good: (n) => `It's got the ${n}… hold on…`,
  weak: (n) => `Only a weak grip on the ${n}.`,
  nudge: (n) => `One prong caught the ${n} — just a shove.`,
  none: () => 'Nothing under the claw.',
};

interface Prize {
  key: number;
  kind: ToyKind;
  color: number;
}

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, 1],
  s: [0, -1],
  A: [-1, 0],
  D: [1, 0],
  W: [0, 1],
  S: [0, -1],
};

const settings = () => useApp.getState().settings;
const motionOn = () => !settings().reducedMotion && settings().fx !== 'off';

export default function ClawCloseup() {
  const shelf = useClaw((s) => s.inv.shelf);
  const shelfColors = useClaw((s) => s.inv.colors);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fxLevel = useApp((s) => s.settings.fx);
  const titleId = useId();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const machineRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const goRef = useRef<HTMLButtonElement>(null);

  const [sign, setSign] = useState<Sign>(IDLE_SIGN);
  const [phase, setPhase] = useState<ClawSim['phase']>('idle');
  const [timer, setTimer] = useState(AIM_TIME);
  const [prize, setPrize] = useState<Prize | null>(null);
  const [burst, setBurst] = useState(0);
  const [said, setSaid] = useState('');
  const [closing, setClosing] = useState(false);

  // ---- the machine (created once per visit from the shared inventory) ----
  const simRef = useRef<ClawSim | null>(null);
  if (!simRef.current) {
    const inv = useClaw.getState().inv;
    const toys = pileToToys(inv.pile);
    const sim = createSim(toys, urlClawSeed() ?? inv.seed ?? 1, inv.misses);
    simRef.current = sim;
  }
  const fxRef = useRef<RenderFx>({ motion: 1, time: 0, life: new Map(), shake: 0, light: 1, lightTint: '#ffe9b0', focus: 0, bits: [] });
  const input = useRef({
    keys: new Map<string, [number, number]>(),
    stick: [0, 0] as [number, number],
    drop: false,
    pad: [0, 0] as [number, number],
    padA: false,
  });
  const motor = useRef<ClawMotor | null>(null);
  const settled = useRef(false);
  const timers = useRef<number[]>([]);
  const signTimer = useRef(0);
  const prizeKey = useRef(0);

  const later = useCallback((ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      fn();
    }, ms);
    timers.current.push(t);
    return t;
  }, []);

  const flash = useCallback(
    (next: Sign, ms: number, after: Sign | (() => Sign) = IDLE_SIGN) => {
      window.clearTimeout(signTimer.current);
      setSign(next);
      signTimer.current = later(ms, () => setSign(typeof after === 'function' ? after() : after));
    },
    [later],
  );

  /** Saves the machine (and a prize) to the shared inventory. */
  const commit = useCallback((won?: ClawToy) => {
    const sim = simRef.current!;
    useClaw.getState().commit(
      sim.toys.filter((t) => t.mode !== 'chute'),
      sim.misses,
      sim.seed,
      won ? { kind: won.kind, color: won.color } : undefined,
    );
  }, []);

  const celebrate = useCallback(
    (toy: ClawToy) => {
      commit(toy);
      prizeKey.current += 1;
      const key = prizeKey.current;
      setPrize({ key, kind: toy.kind, color: toy.color });
      later(4200, () => setPrize((p) => (p?.key === key ? null : p)));
      flash({ word: 'WINNER!', lights: 'win' }, 4200);
      fxRef.current.light = 1.6;
      fxRef.current.lightTint = '#ffd23f';
      const fx = settings().fx;
      if (!settings().reducedMotion && fx !== 'off') setBurst((n) => n + 1);
      clawSound.door();
      later(150, () => clawSound.win());
      setSaid(`You won a ${kindName(toy.kind)} plush! It's on your shelf.`);
    },
    [commit, flash, later],
  );

  const doRestock = useCallback(() => {
    const sim = simRef.current!;
    const added = restock(sim, STOCK);
    if (!added) return;
    if (!motionOn()) settleFully(sim.toys);
    useClaw.getState().restocked(sim.toys, sim.seed);
    clawSound.restock();
    flash({ word: 'RESTOCKED!', lights: 'restock' }, 2200);
    setSaid('The attendant restocked the machine with fresh plushies.');
  }, [flash]);

  /** Reacts to what the machine did (sounds, the marquee, the plushies' faces, announcements). */
  const handle = useCallback(
    (events: ClawEvent[], live: boolean) => {
      const sim = simRef.current!;
      const fx = fxRef.current;
      for (const e of events) {
        switch (e.type) {
          case 'token':
            if (live) clawSound.token();
            flash({ word: 'GO!', lights: 'aim' }, 1100, () => ({ word: 'AIM', lights: 'aim' }));
            setSaid(
              `Token in — free play. Move the claw with the arrow keys or the joystick, drop it with Space or the big button. ${AIM_TIME} seconds.`,
            );
            break;
          case 'tick':
            if (live) clawSound.tick();
            if (e.left <= 3) setSaid(`${e.left}…`);
            break;
          case 'bump':
            if (live) clawSound.bump();
            break;
          case 'drop':
            if (live) clawSound.press();
            window.clearTimeout(signTimer.current);
            setSign({ word: e.auto ? "TIME'S UP" : 'DROP!', lights: 'tense' });
            setSaid(e.auto ? "Time's up — the claw drops." : 'Claw dropped.');
            break;
          case 'touch':
            if (live) clawSound.touch(e.onToy);
            break;
          case 'close':
            if (live) clawSound.clack();
            break;
          case 'grip': {
            const t = e.report.toy !== null ? sim.toys.find((x) => x.id === e.report.toy) : undefined;
            setSaid(GRIP_LINE[e.report.quality](t ? kindName(t.kind) : 'plush'));
            if (t && e.report.quality === 'nudge') lifeOf(fx, t.id).wobble = 1;
            break;
          }
          case 'lifted':
            setSign({ word: 'HOLD ON…', lights: 'tense' });
            break;
          case 'top':
            if (live) clawSound.top();
            break;
          case 'slip': {
            if (live) clawSound.whoops();
            lifeOf(fx, e.toy).sweat = 1.2;
            lifeOf(fx, e.toy).wobble = 1;
            if (e.cause !== 'liftoff') {
              setSign({ word: 'WHOOPS!', lights: 'sad' });
              fx.light = 0.65;
              setSaid('It slipped!');
            } else setSaid('It slid out of the prongs.');
            break;
          }
          case 'land': {
            if (live) clawSound.thud(e.hard);
            const l = lifeOf(fx, e.toy);
            l.squash = e.hard ? 1 : 0.6;
            const t = sim.toys.find((x) => x.id === e.toy);
            if (t && e.hard) burstBits(fx, t.x, t.y, t.z, 'dust', 8);
            if (t) {
              for (const o of sim.toys) {
                if (o.id === t.id || o.mode !== 'pile') continue;
                const d = Math.hypot(o.x - t.x, o.z - t.z);
                if (d < 14) lifeOf(fx, o.id).wobble = Math.max(lifeOf(fx, o.id).wobble, (1 - d / 14) * (e.hard ? 1 : 0.6));
              }
            }
            if (e.hard && settings().fx === 'high' && !settings().reducedMotion) fx.shake = 1.4;
            break;
          }
          case 'release':
            if (live) clawSound.clack();
            break;
          case 'chute':
            if (live) clawSound.tumble();
            lifeOf(fx, e.toy).happy = 3;
            {
              const t = sim.toys.find((x) => x.id === e.toy);
              if (t) burstBits(fx, t.x, 2, t.z, 'sparkle', 14);
            }
            break;
          case 'win':
            celebrate(e.toy);
            break;
          case 'done': {
            const sim = simRef.current!;
            if (e.result !== 'win') {
              commit();
              if (live) (e.result === 'slip' ? clawSound.sad : clawSound.buzz)();
              flash(e.result === 'slip' ? { word: 'SO CLOSE', lights: 'sad' } : { word: 'TRY AGAIN', lights: 'sad' }, 2600);
              const q = sim.grip?.toy != null ? sim.grip.quality : 'none';
              setSaid(
                e.result === 'slip'
                  ? 'So close — it slipped out of the claw. Press the button to play again.'
                  : q === 'none'
                    ? 'Missed — the claw came up empty. Press the button to play again.'
                    : q === 'nudge'
                      ? 'Just a shove — the claw came up empty. Press the button to play again.'
                      : "It wouldn't come up — the claw couldn't hold it. Press the button to play again.",
              );
            } else commit();
            later(1600, () => {
              fx.light = 1;
              fx.lightTint = '#ffe9b0';
            });
            // Nearly cleaned out: the attendant tops it up.
            if (sim.toys.length < 3) {
              later(2800, () => {
                if (simRef.current?.phase !== 'idle') return;
                doRestock();
              });
            }
            break;
          }
        }
      }
    },
    [celebrate, commit, doRestock, flash, later],
  );

  /** Settles whatever is in progress (close / unmount): see the closing rule above. */
  const settleNow = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    const sim = simRef.current!;
    motor.current?.stop();
    if (sim.phase === 'aim') {
      cancelAim(sim);
      return;
    }
    if (sim.phase === 'idle' && !sim.toys.some((t) => t.mode !== 'pile')) return;
    const events = fastForward(sim);
    for (const e of events)
      if (e.type === 'win') useClaw.getState().commit(sim.toys, sim.misses, sim.seed, { kind: e.toy.kind, color: e.toy.color });
    commit();
  }, [commit]);

  // ---- primary action: the big button / Space / Enter / pad A ----
  const primary = useCallback(() => {
    const sim = simRef.current!;
    if (settled.current) return; // leaving
    if (sim.phase === 'idle') {
      if (sim.toys.length === 0) {
        doRestock();
        return;
      }
      const events: ClawEvent[] = [];
      if (insertToken(sim, events)) handle(events, true);
    } else if (sim.phase === 'aim') input.current.drop = true;
  }, [doRestock, handle]);

  // ---- open: show the dialog, restock if due, zoom out of the machine that opened it ----
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    goRef.current?.focus({ preventScroll: true });
    if (needsRestock(useClaw.getState().inv)) doRestock();
    const machine = machineRef.current;
    const from = useClaw.getState().open?.rect;
    if (!machine) return;
    if (settings().reducedMotion || !from || typeof machine.animate !== 'function') {
      machine.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      return;
    }
    const to = machine.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sx = Math.max(0.05, from.width / to.width);
    const sy = Math.max(0.05, from.height / to.height);
    machine.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, filter: 'brightness(0.6)' },
        { opacity: 1, offset: 0.35 },
        { transform: 'none', opacity: 1, filter: 'none' },
      ],
      { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [doRestock]);

  const close = useCallback(() => {
    if (closing) return;
    settleNow();
    const done = () => {
      const op = useClaw.getState().open;
      // Close the modal first: nothing outside it can take focus while it's open.
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
      useClaw.getState().closeCloseup();
      const el = op?.el;
      if (el?.isConnected) el.focus({ preventScroll: true });
    };
    const machine = machineRef.current;
    const opener = useClaw.getState().open;
    // Zoom back into the machine on the floor (if it's still standing there).
    const floor = opener?.from === 'floor' ? document.querySelector<HTMLElement>('[data-part="claw-machine"] .clw__machine') : null;
    const target = floor?.getBoundingClientRect() ?? (opener?.el?.isConnected ? opener.el.getBoundingClientRect() : null);
    if (!machine || settings().reducedMotion || !target || target.width === 0 || typeof machine.animate !== 'function') {
      done();
      return;
    }
    setClosing(true);
    const to = machine.getBoundingClientRect();
    const dx = target.left + target.width / 2 - (to.left + to.width / 2);
    const dy = target.top + target.height / 2 - (to.top + to.height / 2);
    const anim = machine.animate(
      [
        { transform: 'none', opacity: 1 },
        { opacity: 1, offset: 0.7 },
        { transform: `translate(${dx}px, ${dy}px) scale(${target.width / to.width}, ${target.height / to.height})`, opacity: 0 },
      ],
      { duration: 340, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' },
    );
    anim.onfinish = done;
    anim.oncancel = done;
  }, [closing, settleNow]);

  // ---- the loop: fixed-step physics, draw, motor, knob ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sim = simRef.current!;
    const fx = fxRef.current;
    motor.current = new ClawMotor();
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let scale = 1;
    let shownPhase = sim.phase;
    let shownTimer = Math.ceil(sim.timer);
    let lastDir = '';
    let cable = 0;
    let padWasA = false;
    const root = dialogRef.current;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round((r.width * dpr * VIEW.h) / VIEW.w));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      scale = w / VIEW.w;
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const readInput = (): ClawInput => {
      const inp = input.current;
      let x = inp.stick[0] + inp.pad[0];
      let z = inp.stick[1] + inp.pad[1];
      for (const [dx, dz] of inp.keys.values()) {
        x += dx;
        z += dz;
      }
      x = Math.max(-1, Math.min(1, x));
      z = Math.max(-1, Math.min(1, z));
      const drop = inp.drop;
      inp.drop = false;
      return { x, z, drop };
    };

    const pollPad = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = Array.from(pads ?? []).find((p) => p && p.connected);
      const inp = input.current;
      if (!pad) {
        inp.pad = [0, 0];
        return;
      }
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
      inp.pad = [dz(pad.axes[0] ?? 0), -dz(pad.axes[1] ?? 0)];
      const a = !!pad.buttons[0]?.pressed;
      if (a && !padWasA) primary();
      padWasA = a;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      acc += dt;
      pollPad();
      const events: ClawEvent[] = [];
      let steps = 0;
      const inp = readInput();
      while (acc >= DT && steps < 24) {
        stepClaw(sim, steps === 0 ? inp : { ...inp, drop: false }, events);
        acc -= DT;
        steps++;
      }
      if (steps === 0 && inp.drop) input.current.drop = true; // keep it for the next step
      if (events.length) handle(events, true);

      // Motor: the gantry's speed, the winch's direction.
      const speed = Math.hypot(sim.vx, sim.vz) / GANTRY.maxSpeed;
      const winch =
        sim.phase === 'drop' ? -Math.min(1, Math.abs(sim.vy) / 30) : sim.phase === 'lift' ? Math.min(1, Math.abs(sim.vy) / 24) : 0;
      if (!settled.current) motor.current?.update(speed, winch);
      // The winch's ratchet clicks as the cable runs (faster as it speeds up).
      if (winch !== 0) {
        cable += Math.abs(sim.vy) * dt;
        if (cable > 4) {
          cable = 0;
          clawSound.ratchet(winch > 0);
        }
      }
      const tense = sim.phase === 'drop' || sim.phase === 'close' || sim.phase === 'lift' || sim.phase === 'top';
      fx.focus += ((tense ? 1 : 0) - fx.focus) * Math.min(1, dt * 3);

      // Render.
      const motionOk = !useApp.getState().settings.reducedMotion && useApp.getState().settings.fx !== 'off';
      fx.motion = motionOk ? 1 : 0;
      fx.time += dt;
      fx.shake = Math.max(0, fx.shake - dt * 6);
      if (sim.held) {
        const t = sim.toys.find((x) => x.id === sim.held!.id);
        if (t) {
          const off = Math.hypot(sim.held.ox, sim.held.oz) / KINDS[t.kind].r;
          if (off > 0.45) lifeOf(fx, t.id).sweat = Math.max(lifeOf(fx, t.id).sweat, Math.min(1, (off - 0.45) * 3));
        }
      }
      ageLife(fx, dt);
      drawClawScene(ctx, sim, fx, scale);

      // The joystick shows where it's pushed (pointer, keys or pad).
      const vx = Math.max(-1, Math.min(1, inp.x));
      const vz = Math.max(-1, Math.min(1, inp.z));
      if (knobRef.current) knobRef.current.style.setProperty('--jx', vx.toFixed(3));
      if (knobRef.current) knobRef.current.style.setProperty('--jz', vz.toFixed(3));
      const dir = sim.phase === 'aim' ? `${Math.sign(Math.round(vx))},${Math.sign(Math.round(vz))}` : '0,0';
      if (dir !== lastDir) {
        if (dir !== '0,0') clawSound.click();
        lastDir = dir;
      }

      if (sim.phase !== shownPhase) {
        shownPhase = sim.phase;
        setPhase(sim.phase);
      }
      const tm = Math.ceil(sim.timer);
      if (tm !== shownTimer) {
        shownTimer = tm;
        setTimer(tm);
      }
      if (root) {
        root.dataset.gx = sim.gx.toFixed(1);
        root.dataset.gz = sim.gz.toFixed(1);
        root.dataset.toys = String(sim.toys.length);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onBlur = () => {
      input.current.keys.clear();
      input.current.stick = [0, 0];
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      motor.current?.stop();
      motor.current = null;
    };
  }, [handle, primary]);

  // ---- unmount: settle the try, clear timers ----
  useEffect(() => {
    settled.current = false;
    return () => {
      settleNow();
      for (const t of timers.current) window.clearTimeout(t);
      window.clearTimeout(signTimer.current);
      // (Unmounting takes the dialog out of the top layer; closing it here would fire onClose.)
    };
  }, [settleNow]);

  // ---- test hook (harmless: this machine is local and cosmetic) ----
  useEffect(() => {
    const w = window as unknown as { __dascadeClaw?: unknown };
    w.__dascadeClaw = {
      state: () => {
        const s = simRef.current!;
        return { phase: s.phase, gx: s.gx, gz: s.gz, toys: s.toys.length, result: s.result, misses: s.misses };
      },
      /** The most exposed plush (where a careful player would aim). */
      target: () => {
        const t = exposedToy(simRef.current!);
        return t ? { x: t.x, z: t.z, kind: t.kind } : null;
      },
      /** Lines the claw up over the most exposed plush and makes the coil strong: a sure win. */
      rig: () => {
        const s = simRef.current!;
        const best = exposedToy(s);
        if (!best) return false;
        s.strengthScale = 6;
        s.gx = Math.max(GANTRY.minX, Math.min(GANTRY.maxX, best.x));
        s.gz = Math.max(GANTRY.minZ, Math.min(GANTRY.maxZ, best.z));
        s.vx = s.vz = s.sx = s.sz = s.svx = s.svz = 0;
        return true;
      },
    };
    return () => {
      delete w.__dascadeClaw;
    };
  }, []);

  // ---- keyboard ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = KEY_DIRS[e.key];
    if (dir) {
      e.preventDefault();
      input.current.keys.set(e.key.toLowerCase(), dir);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      const t = e.target as HTMLElement;
      // A focused button handles its own activation (the big one is `primary` too).
      if (t.closest('button')) return;
      e.preventDefault();
      if (!e.repeat) {
        pressFlash();
        primary();
      }
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (KEY_DIRS[e.key]) input.current.keys.delete(e.key.toLowerCase());
  };
  const pressFlash = () => {
    const b = goRef.current;
    if (!b) return;
    b.dataset.pressed = 'true';
    later(140, () => delete b.dataset.pressed);
  };

  const sim = simRef.current!;
  const confetti = reduced || fxLevel === 'off' ? 0 : fxLevel === 'low' ? 50 : 140;
  const mode = phase === 'idle' ? 'start' : phase === 'aim' ? 'drop' : 'busy';
  const goLabel = mode === 'start' ? 'Insert a free token and start' : mode === 'drop' ? 'Drop the claw' : 'The claw is busy';
  const total = shelfTotal(shelf);
  const timerShown = phase === 'aim' ? timer : null;

  return (
    <dialog
      ref={dialogRef}
      className="clwx"
      aria-labelledby={titleId}
      data-part="claw-closeup"
      data-phase={phase}
      data-closing={closing ? 'true' : undefined}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        // Closed natively (a browser's repeated-Esc escape hatch): settle and leave like the button.
        if (!useClaw.getState().open) return;
        settleNow();
        const op = useClaw.getState().open;
        useClaw.getState().closeCloseup();
        if (op?.el?.isConnected) op.el.focus({ preventScroll: true });
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <h2 id={titleId} className="visually-hidden">
        Claw machine
      </h2>
      <div className="clwx__stage">
        <div ref={machineRef} className="clwx__machine" data-lights={sign.lights}>
          {/* marquee */}
          <div className="clwx__marquee" data-area="marquee">
            <Bulbs />
            <div className="clwx__sign">
              <span className="clwx__word" data-part="claw-sign" data-len={sign.word.length > 9 ? 'long' : undefined}>
                {sign.word === 'AIM' && timerShown !== null ? 'AIM!' : sign.word}
              </span>
              <span className="clwx__timer" data-urgent={timerShown !== null && timerShown <= 5 ? 'true' : undefined} aria-hidden>
                {timerShown !== null ? `0:${String(timerShown).padStart(2, '0')}` : 'FREE'}
              </span>
            </div>
          </div>

          {/* the glass case */}
          <div className="clwx__case" data-area="case">
            <canvas ref={canvasRef} className="clwx__view" width={VIEW.w} height={VIEW.h} aria-hidden />
            <span className="clwx__glass" aria-hidden />
            <span className="clwx__post clwx__post--l" aria-hidden />
            <span className="clwx__post clwx__post--r" aria-hidden />
            {burst && confetti ? <ClawConfetti key={burst} amount={confetti} originY={0.02} /> : null}
          </div>

          {/* control deck */}
          <div className="clwx__joy" data-area="joy">
            <Joystick knobRef={knobRef} input={input} disabled={phase !== 'aim'} />
          </div>
          <div className="clwx__coin" data-area="coin">
            <button
              type="button"
              className="clwx__slot"
              onClick={() => sim.phase === 'idle' && primary()}
              aria-label="Insert a free token"
              aria-disabled={phase !== 'idle'}
              tabIndex={-1}
            >
              <span className="clwx__slot-hole" aria-hidden />
            </button>
            <span className="clwx__free" aria-hidden>
              FREE PLAY
            </span>
          </div>
          <div className="clwx__go-wrap" data-area="go">
            <button
              ref={goRef}
              type="button"
              className="clwx__go"
              data-mode={mode}
              data-part="claw-go"
              aria-label={goLabel}
              aria-disabled={mode === 'busy' || undefined}
              onClick={() => primary()}
            >
              <span className="clwx__go-cap">
                <span className="clwx__go-label" aria-hidden>
                  {mode === 'start' ? 'START' : 'DROP'}
                </span>
              </span>
            </button>
          </div>

          {/* prize door + shelf */}
          <div className="clwx__door" data-area="door" data-open={prize ? 'true' : undefined}>
            <span className="clwx__door-label" aria-hidden>
              PRIZE
            </span>
            <span className="clwx__door-hole" aria-hidden>
              {prize ? (
                <span className="clwx__prize" key={prize.key} data-part="claw-prize">
                  <PlushSvg kind={prize.kind} color={prize.color} />
                </span>
              ) : null}
              <span className="clwx__flap" />
            </span>
          </div>
          <div className="clwx__plate" data-area="plate" aria-hidden>
            <span className="clwx__plate-top">WIN A</span>
            <span className="clwx__plate-big">PLUSH!</span>
          </div>
          <div
            className="clwx__shelf"
            data-area="shelf"
            data-part="claw-shelf"
            aria-label={`Prize shelf: ${total} plush${total === 1 ? '' : 'ies'} won`}
            role="group"
          >
            <ShelfRow shelf={shelf} colors={shelfColors} />
          </div>
        </div>

        <button type="button" className="clwx__close" onClick={close} aria-label="Leave the claw machine" title="Leave (Esc)">
          <svg viewBox="0 0 12 12" aria-hidden focusable="false">
            <path d="M2 2h2v1h1v1h2V3h1V2h2v2H9v1H8v2h1v1h1v2H8V9H7V8H5v1H4v1H2V8h1V7h1V5H3V4H2z" fill="currentColor" />
          </svg>
        </button>
        <p className="clwx__help" aria-hidden>
          <kbd>←</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <kbd>→</kbd> move · <kbd>Space</kbd> {mode === 'start' ? 'start' : 'drop'} · <kbd>Esc</kbd> leave
        </p>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite" data-part="claw-status">
        {said}
      </p>
    </dialog>
  );
}

function exposedToy(s: ClawSim): ClawToy | null {
  let best: ClawToy | null = null;
  let score = -Infinity;
  for (const t of s.toys) {
    if (t.mode !== 'pile') continue;
    const v = t.y + KINDS[t.kind].h - buriedLoad(s.toys, t) * 8;
    if (v > score) {
      score = v;
      best = t;
    }
  }
  return best;
}

/** The marquee's chaser bulbs (CSS animates them by the machine's data-lights). */
function Bulbs() {
  return (
    <span className="clwx__bulbs" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <i key={`t${i}`} className={i % 2 ? 'b' : undefined} style={{ '--i': i } as CSSProperties} data-row="top" />
      ))}
      {Array.from({ length: 18 }, (_, i) => (
        <i key={`b${i}`} className={i % 2 ? undefined : 'b'} style={{ '--i': i } as CSSProperties} data-row="bottom" />
      ))}
    </span>
  );
}

export function PlushSvg({ kind, color, className }: { kind: ToyKind; color: number; className?: string }) {
  const { w, h } = spriteSize(kind);
  return (
    <svg className={className ?? 'clwx-plush'} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden focusable="false">
      {spritePaths(kind).map(({ ch, d }) => (
        <path key={ch} d={d} fill={spriteColor(ch, color) ?? 'none'} />
      ))}
    </svg>
  );
}

function ShelfRow({ shelf, colors }: { shelf: Shelf; colors: Shelf }) {
  return (
    <>
      <span className="clwx__shelf-title" aria-hidden>
        Your shelf
      </span>
      <span className="clwx__shelf-row">
        {TOY_KINDS.map((k, i) => (
          <span
            key={k}
            className="clwx__shelf-item"
            data-has={shelf[k] > 0 ? 'true' : undefined}
            aria-label={`${kindName(k)}: ${shelf[k]}`}
            role="img"
          >
            <PlushSvg kind={k} color={shelf[k] > 0 ? colors[k] : i} />
            <span className="clwx__shelf-n">×{shelf[k]}</span>
          </span>
        ))}
      </span>
    </>
  );
}

/**
 * The deck's joystick: drag the ball (it springs back). The loop moves the knob from the combined
 * input (--jx / --jz), so keys and a gamepad move it too.
 */
function Joystick({
  knobRef,
  input,
  disabled,
}: {
  knobRef: React.RefObject<HTMLSpanElement | null>;
  input: React.RefObject<{ stick: [number, number] }>;
  disabled: boolean;
}) {
  const baseRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef<number | null>(null);
  const update = (e: ReactPointerEvent) => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const reach = r.width * 0.34;
    let x = (e.clientX - (r.left + r.width / 2)) / reach;
    let y = -(e.clientY - (r.top + r.height / 2)) / reach;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const dead = 0.14;
    input.current.stick = [Math.abs(x) < dead ? 0 : x, Math.abs(y) < dead ? 0 : y];
  };
  const release = () => {
    dragging.current = null;
    input.current.stick = [0, 0];
    baseRef.current?.removeAttribute('data-dragging');
  };
  return (
    <span
      ref={baseRef}
      className="clwx-joy"
      data-part="claw-joystick"
      data-disabled={disabled ? 'true' : undefined}
      role="img"
      aria-label="Joystick — drag it, or use the arrow keys, to move the claw"
      onPointerDown={(e) => {
        if (dragging.current !== null) return;
        dragging.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.setAttribute('data-dragging', 'true');
        update(e);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (dragging.current === e.pointerId) update(e);
      }}
      onPointerUp={(e) => dragging.current === e.pointerId && release()}
      onPointerCancel={(e) => dragging.current === e.pointerId && release()}
      onLostPointerCapture={(e) => dragging.current === e.pointerId && release()}
    >
      <span className="clwx-joy__plate" />
      <span className="clwx-joy__boot" />
      <span ref={knobRef} className="clwx-joy__stick">
        <span className="clwx-joy__shaft" />
        <span className="clwx-joy__ball" />
      </span>
    </span>
  );
}
