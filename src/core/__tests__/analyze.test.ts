import { describe, expect, it } from 'vitest';
import { analyze, applyRules, cleanFrames, DEFAULT_RULES, jointAngle, movePhase, retypeStroke, type PoseFrame } from '../index';
import { BACKHAND_1H, FOREHAND, SERVE, synthesize } from './synthetic';

const fps = 30;
const run = (frames: PoseFrame[], hand: 'right' | 'left' = 'right') => analyze({ frames, fps, hand, rules: DEFAULT_RULES });
const phaseFrame = (s: { phases: { id: string; frame: number }[] }, id: string) => s.phases.find((p) => p.id === id)!.frame;

describe('geometry', () => {
  it('measures a right angle and a straight arm', () => {
    expect(jointAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(jointAngle({ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(180);
  });
});

describe('forehand', () => {
  const { strokes } = run(synthesize(FOREHAND, fps));
  it('finds one forehand with contact near the speed peak', () => {
    expect(strokes).toHaveLength(1);
    expect(strokes[0].type).toBe('forehand');
    expect(Math.abs(strokes[0].contactFrame - 1.33 * fps)).toBeLessThanOrEqual(5);
  });
  it('orders six phases with the backswing near the furthest-back wrist', () => {
    const s = strokes[0];
    expect(s.phases.map((p) => p.id)).toEqual(['ready', 'unit-turn', 'backswing', 'racket-drop', 'contact', 'follow-through']);
    for (let i = 1; i < s.phases.length; i++) expect(s.phases[i].frame).toBeGreaterThan(s.phases[i - 1].frame);
    expect(Math.abs(phaseFrame(s, 'backswing') - 1.0 * fps)).toBeLessThanOrEqual(5);
  });
  it('measures a big shoulder turn and contact in front', () => {
    const s = strokes[0];
    expect(s.metrics.backswing!.shoulderTurn!).toBeGreaterThan(60);
    expect(s.metrics.contact!.contactForward!).toBeGreaterThan(0.1);
    expect(s.keyPoints.length).toBeGreaterThan(3);
    expect(s.callouts.length).toBe(s.keyPoints.length);
  });
  it('works the same for a left-hander', () => {
    const left = run(synthesize(FOREHAND, fps, 'left'), 'left').strokes;
    expect(left).toHaveLength(1);
    expect(left[0].type).toBe('forehand');
  });
});

describe('one-handed backhand', () => {
  const { strokes } = run(synthesize(BACKHAND_1H, fps));
  it('classifies the backhand and spots the hand on the throat', () => {
    expect(strokes).toHaveLength(1);
    expect(strokes[0].type).toBe('backhand-1h');
    const throat = strokes[0].keyPoints.find((k) => k.ruleId === 'bh1-hand-throat');
    expect(throat?.status).toBe('good');
    expect(throat?.text).toContain('Left hand');
  });
});

describe('serve', () => {
  const { strokes } = run(synthesize(SERVE, fps));
  it('classifies a serve with the trophy at the toss peak', () => {
    expect(strokes).toHaveLength(1);
    const s = strokes[0];
    expect(s.type).toBe('serve');
    expect(s.phases.map((p) => p.id)).toEqual(['ready', 'trophy', 'racket-drop', 'contact', 'follow-through']);
    expect(Math.abs(phaseFrame(s, 'trophy') - 0.9 * fps)).toBeLessThanOrEqual(4);
    expect(s.metrics.contact!.contactHeight!).toBeGreaterThan(0.35);
  });
});

describe('several strokes in one clip', () => {
  it('splits a rally of forehand, backhand, forehand', () => {
    const a = synthesize(FOREHAND, fps);
    const b = synthesize(BACKHAND_1H, fps);
    const c = synthesize(FOREHAND, fps);
    const all = [...a, ...b, ...c].map((f, i) => ({ ...f, t: i / fps }));
    const types = run(all).strokes.map((s) => s.type);
    expect(types).toEqual(['forehand', 'backhand-1h', 'forehand']);
  });
});

describe('coach corrections', () => {
  const r = run(synthesize(FOREHAND, fps));
  const p = r.prepared;
  const s = r.strokes[0];
  it('keeps an edited key point when rules re-run', () => {
    const edited = { ...s, keyPoints: s.keyPoints.map((k, i) => (i === 0 ? { ...k, text: 'Coach words', edited: true } : k)) };
    const again = applyRules(edited, DEFAULT_RULES, 'right');
    expect(again.keyPoints.filter((k) => k.text === 'Coach words')).toHaveLength(1);
    expect(again.keyPoints).toHaveLength(s.keyPoints.length);
  });
  it('re-types a stroke and finds the new phases', () => {
    const serve = retypeStroke(p, s, 'serve', DEFAULT_RULES);
    expect(serve.type).toBe('serve');
    expect(serve.typeLocked).toBe(true);
    expect(serve.phases.some((x) => x.id === 'trophy')).toBe(true);
  });
  it('moves a phase but never past its neighbours', () => {
    const moved = movePhase(p, s, 'contact', 0, DEFAULT_RULES);
    const back = phaseFrame(moved, 'racket-drop');
    expect(moved.contactFrame).toBe(back + 1);
  });
});

describe('cleanFrames', () => {
  it('fills a short gap', () => {
    const f = synthesize(FOREHAND, fps);
    f[10] = { ...f[10], world: null, image: null };
    f[11] = { ...f[11], world: null, image: null };
    const c = cleanFrames(f, 6, 0);
    expect(c[10].world).not.toBeNull();
    expect(c[11].image).not.toBeNull();
  });
});
