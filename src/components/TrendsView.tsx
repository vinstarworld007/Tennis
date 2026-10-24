import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { formatMetric, METRIC_INFO, PHASE_LABEL, type Rule, type StrokeType } from '../core';
import { STROKE_LABEL, fmtDate } from '../labels';
import { store, type Player, type SessionSummary } from '../storage/db';

interface Point { t: number; v: number; label: string }

/** Average of a rule's metric per session, oldest first. */
function series(sessions: SessionSummary[], rule: Rule, type: StrokeType): Point[] {
  return [...sessions]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((s) => {
      const vals = s.strokes.filter((x) => x.type === type).map((x) => x.metrics[rule.phase]?.[rule.metric]).filter((v): v is number => v !== undefined);
      return vals.length ? { t: s.createdAt, v: vals.reduce((a, b) => a + b, 0) / vals.length, label: s.title } : null;
    })
    .filter((p): p is Point => p !== null);
}

function Spark({ pts, rule }: { pts: Point[]; rule: Rule }) {
  const W = 260, H = 72, pad = 6;
  const vals = pts.map((p) => p.v).concat([rule.min, rule.max].filter((x): x is number => x !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const x = (i: number) => (pts.length === 1 ? W / 2 : pad + (i / (pts.length - 1)) * (W - 2 * pad));
  const bandTop = y(rule.max ?? hi), bandBot = y(rule.min ?? lo);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label={`${METRIC_INFO[rule.metric].label} over sessions`}>
      <rect x={0} y={bandTop} width={W} height={Math.max(0, bandBot - bandTop)} className="band" />
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} className="line" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={3.5} className="pt"><title>{`${p.label}: ${formatMetric(rule.metric, p.v)}`}</title></circle>)}
    </svg>
  );
}

export function TrendsView({ playerId }: { playerId: string }) {
  const { go, rules } = useApp();
  const [player, setPlayer] = useState<Player>();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  useEffect(() => {
    store.players().then((ps) => setPlayer(ps.find((p) => p.id === playerId)));
    store.sessions(playerId).then(setSessions);
  }, [playerId]);

  const types = [...new Set(sessions.flatMap((s) => s.strokes.map((x) => x.type)))].filter((t) => t !== 'unknown') as StrokeType[];

  return (
    <div className="trends">
      <button className="link" onClick={() => go({ name: 'library', playerId })}>← {player?.name}</button>
      <h1>Progress</h1>
      <p className="muted">Each point is a session's average. The shaded band is the target range from Coach settings.</p>
      {types.length === 0 && <p className="muted">No classified strokes yet.</p>}
      {types.map((type) => (
        <section key={type}>
          <h2>{STROKE_LABEL[type]}</h2>
          <div className="trend-grid">
            {rules.filter((r) => r.enabled && r.strokes.includes(type)).map((r) => {
              const pts = series(sessions, r, type);
              if (!pts.length) return null;
              const last = pts[pts.length - 1];
              const inRange = (r.min === undefined || last.v >= r.min) && (r.max === undefined || last.v <= r.max);
              return (
                <div key={r.id} className="trend-card">
                  <h4>{METRIC_INFO[r.metric].label} <small className="muted">at {PHASE_LABEL[r.phase].toLowerCase()}</small></h4>
                  <p className={`big ${inRange ? 'good' : 'fix'}`}>{formatMetric(r.metric, last.v)}</p>
                  <Spark pts={pts} rule={r} />
                  <p className="muted small">{pts.length} session{pts.length === 1 ? '' : 's'} · latest {fmtDate(last.t)}</p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
