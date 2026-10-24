import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import {
  formatMetric, METRIC_INFO, movePhase, newId, prepare, retypeStroke, strokeAt, topFix,
  type AnchorJoint, type Callout, type KeyPoint, type Phase, type Stroke, type StrokeType,
} from '../core';
import { STROKE_LABEL, STROKE_TYPES, fmtTime } from '../labels';
import { store, TAGS, type Player, type Session } from '../storage/db';
import { drawCallouts, drawSkeleton, drawTrail, drawVideo, fullCrop, type LabelBox, type View } from '../render/overlay';
import { FrameGrabber } from '../render/grabber';
import { canExportVideo, exportCarousel, exportPdf, exportVideo, renderCard, type CardContext } from '../render/export';
import { exportStudioVideo, prepareStudio } from '../render/reel';
import { drawStudioFrame, type StudioTracks } from '../render/studio';

const ANCHORS: { id: AnchorJoint; label: string }[] = [
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'domShoulder', label: 'Hitting shoulder' },
  { id: 'domElbow', label: 'Hitting elbow' },
  { id: 'domWrist', label: 'Hitting hand' },
  { id: 'nonDomWrist', label: 'Other hand' },
  { id: 'hips', label: 'Hips' },
  { id: 'knee', label: 'Knee' },
  { id: 'head', label: 'Head' },
];

/** Tracks depend on the stroke's frames, so a moved contact or re-marked stroke tracks again. */
const tracksKey = (st: Stroke) => `${st.id}:${st.startFrame}:${st.endFrame}:${st.contactFrame}`;

export function SessionView({ id }: { id: string }) {
  const { go, rules } = useApp();
  const [session, setSession] = useState<Session>();
  const [player, setPlayer] = useState<Player>();
  const [url, setUrl] = useState<string>();
  const [strokeId, setStrokeId] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [coach, setCoach] = useState(false);
  const [selCallout, setSelCallout] = useState<string>();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [studio, setStudio] = useState(false);
  const [tracks, setTracks] = useState<Record<string, StudioTracks>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxes = useRef<LabelBox[]>([]);
  const drag = useRef<{ id: string; offX: number; offY: number; ax: number; ay: number } | null>(null);
  const playUntil = useRef<number | null>(null);
  const grabber = useRef<FrameGrabber>();

  useEffect(() => {
    let objectUrl: string | undefined;
    (async () => {
      const s = await store.session(id);
      if (!s) return;
      const ps = await store.players();
      const blob = await store.video(id);
      setPlayer(ps.find((p) => p.id === s.playerId));
      setSession(s);
      setStrokeId(s.strokes[0]?.id);
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        grabber.current = new FrameGrabber(objectUrl);
        setUrl(objectUrl);
      }
    })();
    return () => {
      grabber.current?.dispose();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  const prepared = useMemo(() => (session && player ? prepare(session.frames, session.fps, player.hand) : null), [session?.frames, player]);
  const stroke = session?.strokes.find((s) => s.id === strokeId);
  const phaseHere = stroke?.phases.find((p) => p.frame === frame);
  const nFrames = session?.frames.length ?? 0;

  const timeToFrame = useCallback((t: number) => {
    if (!session) return 0;
    return Math.max(0, Math.min(session.frames.length - 1, Math.round((t - session.start) * session.fps)));
  }, [session]);
  const frameToTime = (i: number) => (session ? session.start + i / session.fps : 0);

  const save = useCallback((next: Session, persist = true) => {
    setSession(next);
    if (persist) store.saveSession(next);
  }, []);

  const updateStroke = useCallback((st: Stroke, persist = true) => {
    if (!session) return;
    const strokes = session.strokes.some((x) => x.id === st.id) ? session.strokes.map((x) => (x.id === st.id ? st : x)) : [...session.strokes, st];
    save({ ...session, strokes: strokes.sort((a, b) => a.startFrame - b.startFrame) }, persist);
  }, [session, save]);

  // Drawing reads the latest state through a ref, so the playback loop never sees stale data.
  const latest = useRef({ session, prepared, stroke, player, coach, selCallout, studio, tracks });
  latest.current = { session, prepared, stroke, player, coach, selCallout, studio, tracks };

  const draw = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    const { session: s, prepared: p, stroke: st, player: pl, selCallout: sel, studio: look, tracks: tr } = latest.current;
    if (!v || !c || !s || !p || !pl || !v.videoWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr);
    const H = Math.round((W * v.videoHeight) / v.videoWidth);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const view: View = { ctx: c.getContext('2d')!, W, H, vw: v.videoWidth, vh: v.videoHeight, crop: fullCrop(v.videoWidth, v.videoHeight) };
    const i = Math.max(0, Math.min(s.frames.length - 1, Math.round((v.currentTime - s.start) * s.fps)));
    const inStroke = st && i >= st.startFrame && i <= st.endFrame ? st : s.strokes.find((x) => i >= x.startFrame && i <= x.endFrame);
    if (look) {
      drawStudioFrame(view, v, p.frames, inStroke, i, pl.hand, (inStroke && tr[tracksKey(inStroke)]) || { ball: null, weight: null }, { gauge: true });
    } else {
      drawVideo(view, v);
      if (inStroke) drawTrail(view, p.frames, inStroke, i, pl.hand);
      drawSkeleton(view, p.frames[i]?.image ?? null);
    }
    boxes.current = [];
    if (inStroke && v.paused) {
      const ph = inStroke.phases.find((x) => x.frame === i);
      if (ph) boxes.current = drawCallouts(view, p.frames[i], inStroke.callouts.filter((x) => x.phaseId === ph.id), pl.hand, sel);
    }
  }, []);

  useEffect(() => { draw(); }, [draw, session, frame, coach, selCallout, prepared, studio, tracks]);

  // Studio look: track the ball and weight for the selected stroke once, then reuse.
  useEffect(() => {
    if (!studio || !stroke || !grabber.current || !prepared || !session || !player || tracks[tracksKey(stroke)]) return;
    let cancelled = false;
    setBusy('Tracking ball 0%');
    prepareStudio(grabber.current, session, prepared.frames, player, stroke, (p) => !cancelled && setBusy(`Tracking ball ${Math.round(p * 100)}%`))
      .then((t) => { if (!cancelled) setTracks((all) => ({ ...all, [tracksKey(stroke)]: t })); })
      .catch((e) => alert(`Ball tracking failed: ${e?.message ?? e}`))
      .finally(() => !cancelled && setBusy(null));
    return () => { cancelled = true; setBusy(null); };
  }, [studio, stroke?.id, stroke?.startFrame, stroke?.endFrame, stroke?.contactFrame, prepared]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const tick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const i = timeToFrame(v.currentTime);
    if (playUntil.current !== null && i >= playUntil.current) {
      v.pause();
      playUntil.current = null;
    }
    setFrame(i);
    draw();
    if (!v.paused) requestAnimationFrame(tick);
  }, [draw, timeToFrame]);

  const seekFrame = (i: number) => {
    const v = videoRef.current;
    if (!v || !session) return;
    v.pause();
    playUntil.current = null;
    const f = Math.max(0, Math.min(nFrames - 1, i));
    v.currentTime = frameToTime(f);
    setFrame(f);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (timeToFrame(v.currentTime) >= nFrames - 1) v.currentTime = frameToTime(0);
      v.playbackRate = rate;
      v.play();
    } else v.pause();
  };

  const playStroke = (st: Stroke) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = frameToTime(st.startFrame);
    v.playbackRate = 0.25;
    setRate(0.25);
    playUntil.current = st.endFrame;
    v.play();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { seekFrame(frame + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { seekFrame(frame - 1); e.preventDefault(); }
      if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Phase thumbnails for the selected stroke.
  const thumbKey = (st: Stroke, p: Phase) => `${st.id}:${p.id}:${p.frame}:${st.callouts.filter((c) => c.phaseId === p.id).map((c) => `${c.label}${c.dx}${c.dy}${c.hidden}`).join()}`;
  useEffect(() => {
    if (!stroke || !grabber.current || !prepared || !session || !player) return;
    let cancelled = false;
    const ctx: CardContext = { grabber: grabber.current, session, frames: prepared.frames, player };
    (async () => {
      for (const p of stroke.phases) {
        const key = thumbKey(stroke, p);
        if (thumbs[key]) continue;
        const card = await renderCard(ctx, stroke, p, 240, 300, { header: false });
        if (cancelled) return;
        setThumbs((t) => ({ ...t, [key]: card.toDataURL('image/jpeg', 0.8) }));
      }
    })();
    return () => { cancelled = true; };
  }, [stroke, prepared]);

  if (!session || !player || !prepared) return <div className="loading">Loading session…</div>;

  const cardCtx = (): CardContext => ({ grabber: grabber.current!, session, frames: prepared.frames, player });
  const runExport = async (label: string, fn: (ctx: CardContext, st: Stroke, onP: (p: number) => void) => Promise<unknown>) => {
    if (!stroke || !grabber.current) return;
    setBusy(`${label} 0%`);
    try {
      await fn(cardCtx(), stroke, (p) => setBusy(`${label} ${Math.round(p * 100)}%`));
    } catch (e: any) {
      alert(`Export failed: ${e?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  // Coach edits
  const editKp = (k: KeyPoint, patch: Partial<KeyPoint>) => stroke && updateStroke({ ...stroke, keyPoints: stroke.keyPoints.map((x) => (x.id === k.id ? { ...x, ...patch, edited: true } : x)) });
  const delKp = (k: KeyPoint) => stroke && updateStroke({ ...stroke, keyPoints: stroke.keyPoints.filter((x) => x.id !== k.id) });
  const addKp = (phaseId: Phase['id']) => stroke && updateStroke({ ...stroke, keyPoints: [...stroke.keyPoints, { id: newId('kp'), phaseId, text: 'New key point', status: 'fix', edited: true }] });
  const editCo = (c: Callout, patch: Partial<Callout>, persist = true) => stroke && updateStroke({ ...stroke, callouts: stroke.callouts.map((x) => (x.id === c.id ? { ...x, ...patch, edited: true } : x)) }, persist);
  const delCo = (c: Callout) => stroke && updateStroke({ ...stroke, callouts: stroke.callouts.filter((x) => x.id !== c.id) });
  const addCo = (phaseId: Phase['id']) => {
    if (!stroke) return;
    const c: Callout = { id: newId('co'), phaseId, label: 'New callout', anchor: 'domWrist', status: 'good', dx: 0.15, dy: -0.1, edited: true };
    updateStroke({ ...stroke, callouts: [...stroke.callouts, c] });
    setSelCallout(c.id);
  };

  const canvasPoint = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!coach) return;
    const p = canvasPoint(e);
    const hit = boxes.current.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (!hit) { setSelCallout(undefined); return; }
    setSelCallout(hit.id);
    drag.current = { id: hit.id, offX: p.x - (hit.x + hit.w / 2), offY: p.y - (hit.y + hit.h / 2), ax: hit.ax, ay: hit.ay };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !stroke) return;
    const p = canvasPoint(e);
    const H = canvasRef.current!.height;
    const c = stroke.callouts.find((x) => x.id === d.id);
    if (c) editCo(c, { dx: (p.x - d.offX - d.ax) / H, dy: (p.y - d.offY - d.ay) / H }, false);
  };
  const onPointerUp = () => {
    if (drag.current && session) store.saveSession(session);
    drag.current = null;
  };

  const phaseKps = (pid: Phase['id']) => stroke?.keyPoints.filter((k) => k.phaseId === pid) ?? [];
  const phaseCos = (pid: Phase['id']) => stroke?.callouts.filter((c) => c.phaseId === pid) ?? [];
  const insideStroke = stroke && frame >= stroke.startFrame && frame <= stroke.endFrame;

  return (
    <div className="session">
      <div className="session-head">
        <button className="link" onClick={() => go({ name: 'library', playerId: player.id })}>← {player.name}</button>
        <input className="title-input" value={session.title} onChange={(e) => save({ ...session, title: e.target.value }, false)} onBlur={() => store.saveSession(session)} />
        <div className="chips">
          {TAGS.map((t) => (
            <button key={t} className={`chip tag ${session.tags.includes(t) ? 'on' : ''}`} onClick={() => save({ ...session, tags: session.tags.includes(t) ? session.tags.filter((x) => x !== t) : [...session.tags, t] })}>{t}</button>
          ))}
        </div>
        <div className="spacer" />
        <label className="toggle" title="White mannequin on a dark court, with racket path, ball flight and weight transfer"><input type="checkbox" checked={studio} onChange={(e) => setStudio(e.target.checked)} /> Studio look</label>
        <label className="toggle"><input type="checkbox" checked={coach} onChange={(e) => setCoach(e.target.checked)} /> Coach editing</label>
        <div className="export">
          {busy ? <span className="muted">{busy}</span> : (
            <>
              <button disabled={!stroke} onClick={() => runExport('Images', exportCarousel)}>Export images</button>
              <button disabled={!stroke} onClick={() => runExport('PDF', exportPdf)}>PDF report</button>
              {canExportVideo() && <button disabled={!stroke} onClick={() => runExport('Video', exportVideo)}>Vertical video</button>}
              {canExportVideo() && <button className="primary" disabled={!stroke} onClick={() => runExport('Studio video', (c, st, onP) => exportStudioVideo(c, st, onP, tracks[tracksKey(st)]))}>Studio video</button>}
            </>
          )}
        </div>
      </div>

      <div className="session-body">
        <aside className="stroke-list">
          <h3>Strokes</h3>
          {session.strokes.length === 0 && <p className="muted small">No swings were detected. Scrub to a contact and use the button below to mark one by hand.</p>}
          {session.strokes.map((s, i) => {
            const fix = topFix(s);
            return (
              <button key={s.id} className={`stroke-item ${s.id === strokeId ? 'selected' : ''}`} onClick={() => { setStrokeId(s.id); seekFrame(s.phases[0]?.frame ?? s.startFrame); }}>
                <span className="n">{i + 1}</span>
                <span>
                  <strong>{STROKE_LABEL[s.type]}</strong>
                  <small>{fmtTime(frameToTime(s.contactFrame))}</small>
                  {fix ? <em className="fix">{fix.text}</em> : <em className="good">No fixes flagged</em>}
                </span>
              </button>
            );
          })}
          <button className="mark" onClick={() => { const st = strokeAt(prepared, frame, rules); updateStroke(st); setStrokeId(st.id); }}>
            + Mark contact at {fmtTime(frameToTime(frame))}
          </button>
          <label className="notes">Session notes
            <textarea value={session.notes} onChange={(e) => save({ ...session, notes: e.target.value }, false)} onBlur={() => store.saveSession(session)} placeholder="Conditions, goals for the session…" />
          </label>
        </aside>

        <section className="stage">
          <div className="canvas-wrap" style={{ aspectRatio: `${session.width} / ${session.height}` }}>
            <canvas
              ref={canvasRef}
              className={coach ? 'editing' : ''}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            {phaseHere && stroke && (
              <div className="phase-badge"><span>{phaseHere.index}</span>{phaseHere.label}</div>
            )}
            {url && (
              <video
                ref={videoRef}
                src={url}
                muted
                playsInline
                preload="auto"
                className="hidden-video"
                onLoadedData={() => seekFrame(stroke?.phases[0]?.frame ?? 0)}
                onSeeked={() => draw()}
                onPlay={() => { setPlaying(true); requestAnimationFrame(tick); }}
                onPause={() => { setPlaying(false); setFrame(timeToFrame(videoRef.current!.currentTime)); draw(); }}
              />
            )}
          </div>

          <div className="controls">
            <button onClick={() => seekFrame(frame - 1)} title="Previous frame (←)">‹</button>
            <button className="play" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            <button onClick={() => seekFrame(frame + 1)} title="Next frame (→)">›</button>
            <div className="seg">
              {[1, 0.5, 0.25].map((r) => (
                <button key={r} className={rate === r ? 'on' : ''} onClick={() => { setRate(r); if (videoRef.current) videoRef.current.playbackRate = r; }}>{r === 1 ? '1×' : r === 0.5 ? '½×' : '¼×'}</button>
              ))}
            </div>
            {stroke && <button onClick={() => playStroke(stroke)}>Play stroke in slow motion</button>}
            <span className="time">{fmtTime(frameToTime(frame))} · frame {frame + 1}/{nFrames}</span>
          </div>

          <div className="scrubber">
            <div className="marks">
              {session.strokes.map((s) => (
                <div key={s.id} className={`mark-band ${s.id === strokeId ? 'on' : ''}`} style={{ left: `${(s.startFrame / nFrames) * 100}%`, width: `${((s.endFrame - s.startFrame) / nFrames) * 100}%` }} onClick={() => setStrokeId(s.id)} />
              ))}
              {stroke?.phases.map((p) => <div key={p.id} className="tick" style={{ left: `${(p.frame / nFrames) * 100}%` }} title={p.label} />)}
            </div>
            <input type="range" min={0} max={nFrames - 1} value={frame} onChange={(e) => seekFrame(+e.target.value)} />
          </div>

          {stroke && (
            <div className="phase-cards">
              {stroke.phases.map((p) => {
                const fix = phaseKps(p.id).some((k) => k.status === 'fix');
                const src = thumbs[thumbKey(stroke, p)];
                return (
                  <button key={p.id} className={`phase-card ${phaseHere?.id === p.id ? 'on' : ''}`} onClick={() => seekFrame(p.frame)}>
                    <div className="thumb">{src ? <img src={src} alt="" /> : <div className="ph" />}</div>
                    <div className="cap"><span className="num">{p.index}</span>{p.label}<i className={fix ? 'dot fix' : 'dot good'} /></div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="side">
          {!stroke ? <p className="muted">Select a stroke.</p> : (
            <>
              <div className="stroke-head">
                <select value={stroke.type} onChange={(e) => updateStroke(retypeStroke(prepared, stroke, e.target.value as StrokeType, rules))}>
                  {STROKE_TYPES.map((t) => <option key={t} value={t}>{STROKE_LABEL[t]}</option>)}
                </select>
                <button onClick={() => go({ name: 'compare', playerId: player.id, strokeId: stroke.id })}>Compare</button>
              </div>
              {Number.isFinite(stroke.peakSpeed) && <p className="muted small">Peak hand speed {stroke.peakSpeed.toFixed(1)} m/s relative to the hips.</p>}

              {coach && insideStroke && !phaseHere && (
                <div className="move-phase">
                  <span>Move a phase to this frame:</span>
                  <div className="chips">
                    {stroke.phases.map((p) => <button key={p.id} className="chip" onClick={() => updateStroke(movePhase(prepared, stroke, p.id, frame, rules))}>{p.index} {p.label}</button>)}
                  </div>
                </div>
              )}

              {(phaseHere ? [phaseHere] : stroke.phases).map((p) => (
                <div key={p.id} className="phase-block">
                  <h4><span className="num">{p.index}</span>{p.label}{!phaseHere && <button className="link" onClick={() => seekFrame(p.frame)}>view</button>}</h4>
                  <ul className="kps">
                    {phaseKps(p.id).map((k) => (
                      <li key={k.id} className={k.status}>
                        {coach ? (
                          <div className="kp-edit">
                            <textarea value={k.text} onChange={(e) => editKp(k, { text: e.target.value })} rows={2} />
                            <div className="row">
                              <select value={k.status} onChange={(e) => editKp(k, { status: e.target.value as KeyPoint['status'] })}>
                                <option value="good">Good</option><option value="fix">Fix</option><option value="info">Note</option>
                              </select>
                              <button className="link danger" onClick={() => delKp(k)}>Remove</button>
                            </div>
                          </div>
                        ) : <p>{k.text}</p>}
                        {k.metric && k.value !== undefined && (
                          <small>
                            {METRIC_INFO[k.metric].label} {formatMetric(k.metric, k.value)}
                            {(k.min !== undefined || k.max !== undefined) && ` · target ${k.min !== undefined ? formatMetric(k.metric, k.min) : ''}${k.min !== undefined && k.max !== undefined ? '–' : k.min !== undefined ? '+' : 'up to '}${k.max !== undefined ? formatMetric(k.metric, k.max) : ''}`}
                          </small>
                        )}
                      </li>
                    ))}
                    {phaseKps(p.id).length === 0 && <li className="info"><p className="muted">No key points for this phase.</p></li>}
                  </ul>
                  {coach && <button className="link" onClick={() => addKp(p.id)}>+ Add key point</button>}
                  {coach && phaseHere && (
                    <div className="callouts">
                      <h5>Callouts on the video <small className="muted">drag labels to move them</small></h5>
                      {phaseCos(p.id).map((c) => (
                        <div key={c.id} className={`co-row ${selCallout === c.id ? 'sel' : ''}`} onClick={() => setSelCallout(c.id)}>
                          <input value={c.label} onChange={(e) => editCo(c, { label: e.target.value })} />
                          <select value={c.anchor} onChange={(e) => editCo(c, { anchor: e.target.value as AnchorJoint })}>
                            {ANCHORS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                          <select value={c.status} onChange={(e) => editCo(c, { status: e.target.value as Callout['status'] })}>
                            <option value="good">Lime</option><option value="fix">Coral</option>
                          </select>
                          <button className="link" onClick={() => editCo(c, { hidden: !c.hidden })}>{c.hidden ? 'Show' : 'Hide'}</button>
                          <button className="link danger" onClick={() => delCo(c)}>✕</button>
                        </div>
                      ))}
                      <button className="link" onClick={() => addCo(p.id)}>+ Add callout</button>
                    </div>
                  )}
                </div>
              ))}

              <label className="notes">Coach notes for this stroke
                <textarea value={stroke.note ?? ''} onChange={(e) => updateStroke({ ...stroke, note: e.target.value }, false)} onBlur={() => store.saveSession(session)} placeholder="What to practise next…" />
              </label>
              {coach && (
                <button className="link danger" onClick={() => { if (confirm('Delete this stroke?')) { save({ ...session, strokes: session.strokes.filter((s) => s.id !== stroke.id) }); setStrokeId(undefined); } }}>Delete stroke</button>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
