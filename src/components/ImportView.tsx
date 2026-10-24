import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { analyze, newId } from '../core';
import { runPose, type ModelSize } from '../pose/poseRunner';
import { store, type Player, type Session } from '../storage/db';
import { fmtTime } from '../labels';

export function ImportView({ playerId }: { playerId: string }) {
  const { go, rules } = useApp();
  const [player, setPlayer] = useState<Player>();
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState<string>();
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [fps, setFps] = useState(30);
  const [model, setModel] = useState<ModelSize>('full');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController>();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { store.players().then((ps) => setPlayer(ps.find((p) => p.id === playerId))); }, [playerId]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(undefined);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const start = async () => {
    if (!file || !url || !player) return;
    setError(undefined);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const frames = await runPose(url, {
        fps, start: range[0], end: range[1], model, signal: abort.current.signal,
        onProgress: (d, t) => setProgress(d / t),
      });
      const found = frames.filter((f) => f.world).length;
      if (found < frames.length * 0.2) throw new Error('No player was found in most of the clip. Film one player, large in frame, with their whole body visible.');
      const { strokes } = analyze({ frames, fps, hand: player.hand, rules });
      const v = videoRef.current!;
      const session: Session = {
        id: newId('se'), playerId, title: title || 'Session', createdAt: Date.now(),
        fps, start: range[0], end: range[1], duration, width: v.videoWidth, height: v.videoHeight,
        frames, strokes, tags: ['Technique'], notes: '',
      };
      await store.saveVideo(session.id, file);
      await store.saveSession(session);
      go({ name: 'session', id: session.id });
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? String(e));
      setProgress(null);
    }
  };

  const samples = Math.max(0, Math.floor((range[1] - range[0]) * fps));

  return (
    <div className="import">
      <button className="link" onClick={() => go({ name: 'library', playerId })}>← {player?.name ?? 'Back'}</button>
      <h1>New analysis</h1>
      {!url && (
        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          <input type="file" accept="video/*" onChange={(e) => pick(e.target.files?.[0])} hidden />
          <strong>Choose a video</strong>
          <span>or drop an MP4 or MOV here</span>
          <small>Best results: one player, whole body in frame, filmed from the side or behind, 60 fps.</small>
        </label>
      )}
      {url && (
        <div className="import-grid">
          <video
            ref={videoRef}
            src={url}
            controls
            playsInline
            muted
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setDuration(d);
              setRange([0, Math.min(d, 60)]);
            }}
          />
          <div className="panel">
            <label>Session name<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>
              Analyse from {fmtTime(range[0])} to {fmtTime(range[1])}
              <div className="range2">
                <input type="range" min={0} max={duration} step={0.1} value={range[0]} onChange={(e) => { const v = +e.target.value; setRange([Math.min(v, range[1] - 0.5), range[1]]); if (videoRef.current) videoRef.current.currentTime = v; }} />
                <input type="range" min={0} max={duration} step={0.1} value={range[1]} onChange={(e) => { const v = +e.target.value; setRange([range[0], Math.max(v, range[0] + 0.5)]); if (videoRef.current) videoRef.current.currentTime = v; }} />
              </div>
              <small className="muted">Use the current video position: <button className="link" onClick={() => setRange([videoRef.current!.currentTime, range[1]])}>set start</button> · <button className="link" onClick={() => setRange([range[0], videoRef.current!.currentTime])}>set end</button></small>
            </label>
            <label>
              Samples per second
              <div className="seg">
                {[30, 60].map((f) => <button key={f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)}>{f}</button>)}
              </div>
              <small className="muted">Use 60 only if the video was filmed at 60 fps or more.</small>
            </label>
            <label>
              Pose model
              <div className="seg">
                <button className={model === 'full' ? 'on' : ''} onClick={() => setModel('full')}>Accurate</button>
                <button className={model === 'lite' ? 'on' : ''} onClick={() => setModel('lite')}>Fast</button>
              </div>
            </label>
            <p className="muted">{samples} frames will be analysed for {player?.name} ({player?.hand}-handed).</p>
            {error && <p className="error">{error}</p>}
            {progress === null ? (
              <div className="row">
                <button onClick={() => { setUrl(undefined); setFile(undefined); }}>Choose another video</button>
                <button className="primary" onClick={start} disabled={samples < 10}>Analyse</button>
              </div>
            ) : (
              <div>
                <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <p className="muted">Tracking the player… {Math.round(progress * 100)}%</p>
                <button onClick={() => abort.current?.abort()}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
