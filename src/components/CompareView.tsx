import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { formatMetric, METRIC_INFO, prepare, PHASE_LABEL, type Prepared, type Stroke } from '../core';
import { STROKE_LABEL, fmtDate } from '../labels';
import { store, type Player, type Session, type SessionSummary } from '../storage/db';
import { cropAround, drawSkeleton, drawTrail, drawVideo, type View } from '../render/overlay';
import { canExportVideo } from '../render/export';
import { FrameGrabber } from '../render/grabber';
import { exportStudioCompare, type CompareSide } from '../render/reel';

interface Choice { sessionId: string; strokeId: string }
interface Source { session: Session; player: Player; prepared: Prepared; url: string; stroke: Stroke }

const key = (c?: Choice) => (c ? `${c.sessionId}|${c.strokeId}` : '');
const parse = (k: string): Choice | undefined => (k ? { sessionId: k.split('|')[0], strokeId: k.split('|')[1] } : undefined);

function useSource(choice: Choice | undefined, players: Player[]): Source | undefined {
  const [src, setSrc] = useState<Source>();
  useEffect(() => {
    if (!choice) { setSrc(undefined); return; }
    let url: string | undefined;
    let alive = true;
    (async () => {
      const session = await store.session(choice.sessionId);
      const blob = await store.video(choice.sessionId);
      const player = players.find((p) => p.id === session?.playerId);
      const stroke = session?.strokes.find((s) => s.id === choice.strokeId);
      if (!session || !blob || !player || !stroke || !alive) return;
      url = URL.createObjectURL(blob);
      setSrc({ session, player, stroke, url, prepared: prepare(session.frames, session.fps, player.hand) });
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [key(choice), players]);
  return src;
}

function Pane({ src, offset }: { src?: Source; offset: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !src || !v.videoWidth) return;
    const { session, stroke, prepared, player } = src;
    const W = 540, H = 720;
    c.width = W; c.height = H;
    const crop = cropAround(prepared.frames, stroke.startFrame, stroke.endFrame, v.videoWidth, v.videoHeight, W / H);
    const view: View = { ctx: c.getContext('2d')!, W, H, vw: v.videoWidth, vh: v.videoHeight, crop };
    const i = Math.max(0, Math.min(session.frames.length - 1, Math.round((v.currentTime - session.start) * session.fps)));
    drawVideo(view, v);
    drawTrail(view, prepared.frames, stroke, i, player.hand);
    drawSkeleton(view, prepared.frames[i]?.image ?? null);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const t = src.session.start + src.stroke.contactFrame / src.session.fps + offset;
    const lo = src.session.start + src.stroke.startFrame / src.session.fps;
    const hi = src.session.start + src.stroke.endFrame / src.session.fps;
    v.currentTime = Math.max(lo, Math.min(hi, t));
  }, [src, offset]);

  if (!src) return <div className="pane empty-pane">Pick a stroke</div>;
  return (
    <div className="pane">
      <canvas ref={canvasRef} />
      <video ref={videoRef} src={src.url} muted playsInline preload="auto" className="hidden-video" onSeeked={draw} onLoadedData={draw} />
      <p className="muted small">{src.player.name} · {src.session.title} · {fmtDate(src.session.createdAt)}</p>
    </div>
  );
}

export function CompareView({ playerId, strokeId }: { playerId: string; strokeId?: string }) {
  const { go, rules } = useApp();
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [a, setA] = useState<Choice>();
  const [b, setB] = useState<Choice>();
  const [offset, setOffset] = useState(-1.0);
  const [playing, setPlaying] = useState(false);
  const [labels, setLabels] = useState<[string, string]>(['', '']);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ps = await store.players();
      const ss = await store.sessions();
      setPlayers(ps);
      setSessions(ss);
      const mine = ss.filter((s) => s.playerId === playerId);
      const first = strokeId ? mine.find((s) => s.strokes.some((x) => x.id === strokeId)) : mine[0];
      const st = first?.strokes.find((x) => x.id === strokeId) ?? first?.strokes[0];
      if (first && st) {
        setA({ sessionId: first.id, strokeId: st.id });
        // Default comparison: the same stroke type in this player's previous session.
        const prev = mine.filter((s) => s.createdAt < first.createdAt).flatMap((s) => s.strokes.filter((x) => x.type === st.type).map((x) => ({ sessionId: s.id, strokeId: x.id })))[0];
        const sameSession = first.strokes.find((x) => x.type === st.type && x.id !== st.id);
        setB(prev ?? (sameSession ? { sessionId: first.id, strokeId: sameSession.id } : undefined));
      }
    })();
  }, [playerId, strokeId]);

  const srcA = useSource(a, players);
  const srcB = useSource(b, players);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setOffset((o) => {
        const n = o + dt * 0.25;
        if (n >= 0.8) { setPlaying(false); return 0.8; }
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const options = useMemo(() => sessions.flatMap((s) => {
    const p = players.find((x) => x.id === s.playerId);
    return s.strokes.map((st, i) => ({ value: key({ sessionId: s.id, strokeId: st.id }), label: `${p?.name ?? '?'} · ${s.title} · #${i + 1} ${STROKE_LABEL[st.type]}`, mine: s.playerId === playerId }));
  }), [sessions, players, playerId]);

  const exportSplit = async () => {
    if (!srcA || !srcB) return;
    const grabbers = [new FrameGrabber(srcA.url), new FrameGrabber(srcB.url)];
    const side = (s: Source, g: FrameGrabber, label: string): CompareSide => ({ grabber: g, session: s.session, frames: s.prepared.frames, player: s.player, stroke: s.stroke, label: label.trim() || s.player.name });
    setBusy('Split video 0%');
    try {
      await exportStudioCompare(side(srcA, grabbers[0], labels[0]), side(srcB, grabbers[1], labels[1]), (p) => setBusy(`Split video ${Math.round(p * 100)}%`));
    } catch (e: any) {
      alert(`Export failed: ${e?.message ?? e}`);
    } finally {
      grabbers.forEach((g) => g.dispose());
      setBusy(null);
    }
  };

  const type = srcA?.stroke.type;
  const rows = rules.filter((r) => r.enabled && type && r.strokes.includes(type));

  const picker = (value: Choice | undefined, set: (c?: Choice) => void) => (
    <select value={key(value)} onChange={(e) => set(parse(e.target.value))}>
      <option value="">Choose a stroke…</option>
      <optgroup label="This player">{options.filter((o) => o.mine).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
      <optgroup label="Other players and reference strokes">{options.filter((o) => !o.mine).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
    </select>
  );

  return (
    <div className="compare">
      <button className="link" onClick={() => go({ name: 'library', playerId })}>← Back</button>
      <h1>Compare strokes</h1>
      <p className="muted">Both strokes are lined up at contact. Compare against an earlier session, or against a coach's reference stroke imported as another player.</p>
      <div className="compare-grid">
        <div>{picker(a, setA)}<Pane src={srcA} offset={offset} /></div>
        <div>{picker(b, setB)}<Pane src={srcB} offset={offset} /></div>
      </div>
      <div className="controls">
        <button className="play" onClick={() => { if (offset >= 0.8) setOffset(-1.2); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play ¼×'}</button>
        <input type="range" min={-1.2} max={0.8} step={1 / 60} value={offset} onChange={(e) => { setPlaying(false); setOffset(+e.target.value); }} />
        <span className="time">{offset >= 0 ? '+' : ''}{offset.toFixed(2)} s from contact</span>
        <button onClick={() => { setPlaying(false); setOffset(0); }}>Jump to contact</button>
      </div>
      {canExportVideo() && (
        <div className="controls split-export">
          <input placeholder={srcA ? `Left label (${srcA.player.name})` : 'Left label'} value={labels[0]} onChange={(e) => setLabels([e.target.value, labels[1]])} />
          <input placeholder={srcB ? `Right label (${srcB.player.name})` : 'Right label'} value={labels[1]} onChange={(e) => setLabels([labels[0], e.target.value])} />
          {busy ? <span className="muted">{busy}</span> : <button className="primary" disabled={!srcA || !srcB} onClick={exportSplit}>Export split-screen studio video</button>}
          <span className="muted small">Try labels like PRO and BEGINNER.</span>
        </div>
      )}
      {srcA && (
        <table className="metrics-table">
          <thead><tr><th>Phase</th><th>Measure</th><th>Left</th><th>Right</th><th>Target</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const va = srcA.stroke.metrics[r.phase]?.[r.metric];
              const vb = srcB?.stroke.metrics[r.phase]?.[r.metric];
              const ok = (v?: number) => v === undefined ? '' : (r.min !== undefined && v < r.min) || (r.max !== undefined && v > r.max) ? 'fix' : 'good';
              return (
                <tr key={r.id}>
                  <td>{PHASE_LABEL[r.phase]}</td>
                  <td>{METRIC_INFO[r.metric].label}</td>
                  <td className={ok(va)}>{formatMetric(r.metric, va)}</td>
                  <td className={ok(vb)}>{srcB ? formatMetric(r.metric, vb) : '–'}</td>
                  <td className="muted">{r.min !== undefined ? formatMetric(r.metric, r.min) : '…'} to {r.max !== undefined ? formatMetric(r.metric, r.max) : '…'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
