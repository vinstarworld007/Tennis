import { useState } from 'react';
import { useApp } from '../App';
import { applyRules, DEFAULT_RULES, METRIC_INFO, PHASE_LABEL, type Rule, type StrokeType } from '../core';
import { STROKE_LABEL } from '../labels';
import { store } from '../storage/db';

const TYPES: StrokeType[] = ['forehand', 'backhand-1h', 'backhand-2h', 'serve'];

export function RulesView() {
  const { rules, setRules } = useApp();
  const [type, setType] = useState<StrokeType>('forehand');
  const [draft, setDraft] = useState<Rule[]>(rules);
  const [status, setStatus] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);

  const edit = (id: string, patch: Partial<Rule>) => setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const applyEverywhere = async (next: Rule[]) => {
    setStatus('Updating key points in every session…');
    const players = await store.players();
    for (const summary of await store.sessions()) {
      const s = await store.session(summary.id);
      const hand = players.find((p) => p.id === s?.playerId)?.hand;
      if (!s || !hand) continue;
      s.strokes = s.strokes.map((st) => ({ ...st, ...applyRules(st, next, hand) }));
      await store.saveSession(s);
    }
    setStatus('Saved. Key points in every session now use these ranges; your own edits were kept.');
  };

  return (
    <div className="rules">
      <h1>Coach settings</h1>
      <p className="muted">Target ranges decide which key points read as good or as a fix. The defaults are broad starting points; tune them to how you coach. Angles are in degrees, distances in metres.</p>
      <div className="seg">
        {TYPES.map((t) => <button key={t} className={t === type ? 'on' : ''} onClick={() => setType(t)}>{STROKE_LABEL[t]}</button>)}
      </div>
      <div className="rule-list">
        {draft.filter((r) => r.strokes.includes(type)).map((r) => (
          <div key={r.id} className={`rule ${r.enabled ? '' : 'off'}`}>
            <div className="rule-head">
              <label className="toggle"><input type="checkbox" checked={r.enabled} onChange={(e) => edit(r.id, { enabled: e.target.checked })} /> {PHASE_LABEL[r.phase]} · {METRIC_INFO[r.metric].label}</label>
              <span className="range">
                <input type="number" step="any" placeholder="min" value={r.min ?? ''} onChange={(e) => edit(r.id, { min: num(e.target.value) })} />
                to
                <input type="number" step="any" placeholder="max" value={r.max ?? ''} onChange={(e) => edit(r.id, { max: num(e.target.value) })} />
                {METRIC_INFO[r.metric].unit}
              </span>
            </div>
            <div className="rule-texts">
              <label>When good<input value={r.good} onChange={(e) => edit(r.id, { good: e.target.value })} /></label>
              {r.min !== undefined && <label>When too low<input value={r.fixLow} onChange={(e) => edit(r.id, { fixLow: e.target.value })} /></label>}
              {r.max !== undefined && <label>When too high<input value={r.fixHigh ?? ''} onChange={(e) => edit(r.id, { fixHigh: e.target.value })} /></label>}
              <label>Callout (good)<input value={r.goodLabel} onChange={(e) => edit(r.id, { goodLabel: e.target.value })} /></label>
              <label>Callout (fix)<input value={r.fixLabel} onChange={(e) => edit(r.id, { fixLabel: e.target.value })} /></label>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">Use {'{nonDom}'} or {'{dom}'} in text for "left" or "right", matched to each player's hand.</p>
      <div className="row sticky">
        <button onClick={() => setDraft(DEFAULT_RULES)}>Reset to defaults</button>
        <button className="primary" disabled={!dirty} onClick={async () => { await setRules(draft); await applyEverywhere(draft); }}>Save and update sessions</button>
        <span className="muted">{status}</span>
      </div>
    </div>
  );
}
