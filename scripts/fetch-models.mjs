// Copies the MediaPipe vision runtime into public/ and downloads the pose model once,
// so the app works offline (the desktop app never fetches models at runtime).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
mkdirSync(wasmDst, { recursive: true });
cpSync(wasmSrc, wasmDst, { recursive: true });

const models = {
  'pose_landmarker_full.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};
mkdirSync(join(root, 'public/models'), { recursive: true });
for (const [name, url] of Object.entries(models)) {
  const dst = join(root, 'public/models', name);
  if (existsSync(dst)) continue;
  process.stdout.write(`Downloading ${name}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  console.log('done');
}
