import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame } from '../core';

export type ModelSize = 'full' | 'lite';

let cached: { size: ModelSize; landmarker: PoseLandmarker } | null = null;

async function getLandmarker(size: ModelSize): Promise<PoseLandmarker> {
  if (cached?.size === size) return cached.landmarker;
  cached?.landmarker.close();
  const base = import.meta.env.BASE_URL;
  const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${base}models/pose_landmarker_${size}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  let landmarker: PoseLandmarker;
  try {
    landmarker = await make('GPU');
  } catch {
    landmarker = await make('CPU');
  }
  cached = { size, landmarker };
  return landmarker;
}

export interface PoseRunOptions {
  fps: number;
  start: number;
  end: number;
  model: ModelSize;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not read the video at ' + t.toFixed(2) + 's')); };
    const cleanup = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = t;
  });
}

export function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('This video format could not be opened. Try MP4 (H.264) or MOV.'));
  });
}

/**
 * Run pose estimation over [start, end] of a video at `fps` samples per second.
 * Each sample seeks the video to an exact time, so results line up with playback frames.
 */
export async function runPose(url: string, opts: PoseRunOptions): Promise<PoseFrame[]> {
  const landmarker = await getLandmarker(opts.model);
  const video = await loadVideo(url);
  const end = Math.min(opts.end, video.duration);
  const total = Math.max(1, Math.floor((end - opts.start) * opts.fps) + 1);
  const frames: PoseFrame[] = [];
  let lastTs = -1;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const t = opts.start + i / opts.fps;
    await seek(video, t);
    const ts = Math.max(lastTs + 1, Math.round(t * 1000));
    lastTs = ts;
    const res = landmarker.detectForVideo(video, ts);
    const img = res.landmarks[0];
    const world = res.worldLandmarks[0];
    frames.push({
      t,
      image: img ? img.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 1 })) : null,
      world: world ? world.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null,
    });
    if (i % 3 === 0) opts.onProgress?.(i + 1, total);
  }
  opts.onProgress?.(total, total);
  video.removeAttribute('src');
  video.load();
  return frames;
}
