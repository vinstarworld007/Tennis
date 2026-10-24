# Courtside

Tennis stroke analysis for players and coaches. Import a video of a forehand, backhand or serve and Courtside:

- tracks the player's body in every frame,
- finds each swing and labels it (forehand, one- or two-handed backhand, serve),
- splits it into numbered phases ("1 Ready, 2 Unit Turn, 3 Backswing, 4 Racket Drop, 5 Contact, 6 Follow-Through"; serves use Trophy instead of Unit Turn and Backswing),
- measures angles at each phase (shoulder turn, hitting-elbow angle, knee bend, contact point, finish),
- writes key points against coach-tunable target ranges, and draws callouts such as "LEFT HAND ON THROAT" on the frame.

**Studio look and coach reels.** Tick *Studio look* to see the session the way it exports: the court darkened to black and white, the player redrawn as a white mannequin from the pose, and neon overlays for the racket path, the ball's flight (red) and weight transfer (centre of mass over the feet, plus a back-foot to front-foot gauge). *Studio video* exports a 1080×1920 reel: a title, each phase in slow motion held with its callouts and step dots ("1 UNIT TURN · Shoulders and racket together."), then the full swing with the weight shift summed up. On the Compare screen, *Export split-screen studio video* puts two strokes side by side, lined up at contact, under labels such as PRO and BEGINNER.

Coaches can edit any key point or callout, drag labels, move a phase to a different frame, re-label a stroke, mark a missed stroke by hand, compare two strokes lined up at contact, follow a player's progress across sessions, and export a breakdown as a carousel of 1080×1350 images, a PDF report, or a 1080×1920 vertical video.

Courtside is a [Tauri 2](https://v2.tauri.app/) desktop app (Windows, macOS, Linux) with a React and TypeScript interface. All analysis runs on the device; nothing is uploaded.

## Run it

Needs Node 20+ and, for the desktop app, Rust and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install          # also downloads the pose models into public/models
npm run dev          # browser version at http://localhost:1420
npm run tauri dev    # desktop window with hot reload
npm run tauri build  # installer for this OS (.msi / .dmg / .AppImage)
npm test             # analysis core tests
```

The GitHub Actions workflow in `.github/workflows/desktop.yml` runs the tests and builds Windows, macOS and Linux installers on every push.

## Filming tips

One player, whole body in frame, filmed from the side or from behind, at 60 fps if the phone allows. Trim the clip to the strokes you want on the import screen.

## How it works

```
video ──▶ pose model (MediaPipe Pose, in the app) ──▶ 33 body landmarks per frame, 2D + 3D
      ──▶ src/core: clean gaps ▸ find swings from hitting-hand speed ▸ classify ▸ pick phase frames
          ▸ measure angles in 3D ▸ evaluate coach rules ▸ key points + callouts
      ──▶ React screens: breakdown, coach editing, compare, progress, export
```

| Folder | What lives there |
| --- | --- |
| `src/core` | The analysis core: pure TypeScript with no DOM, unit-tested (`npm test`). Stroke detection, phases, metrics, rules. |
| `src/pose` | Runs the pose model frame by frame over the chosen part of the video. |
| `src/render` | Canvas drawing (skeleton glow, hand trail, callouts, phase headers), the studio look (`studio.ts`), ball detection (`ballDetect.ts`) and exports, including coach reels (`reel.ts`). |
| `src/components` | Screens: players, import, breakdown, compare, progress, coach settings. |
| `src/storage` | Local database (IndexedDB) for players, sessions, videos and coach rules. |
| `src-tauri` | The desktop shell: window, native save dialog. |

Measurements use the model's 3D landmarks (metres, centred on the hips), so they do not depend on how far the camera is. Contact is taken as the peak of hitting-hand speed relative to the hips.

## Known limits in this first version

- **Not yet tuned on real footage.** The core is tested on synthetic swings; the default target ranges in Coach settings are broad starting points to adjust after trying real clips.
- **Ball tracking is colour and motion based.** It looks for small moving tennis-ball-yellow blobs and keeps only those that move like a ball in flight, so it can lose the ball against yellow-green backgrounds, in poor light, or when it is a blur of a few pixels. The flight is drawn only where it was found.
- **The racket is estimated, not detected.** Its position extends the hand and forearm direction, so the racket path is an approximation; contact still comes from hand speed and can be a frame or two off. A racket model is the next planned addition.
- **Weight transfer** is the centre of mass (from body-segment weights) projected between the ankles. It reads best when both feet are visible and apart.
- **Volleys** are not detected automatically; re-label them by hand.
- **Vertical video export** depends on the system's video encoder; it is hidden where the desktop webview does not support recording (some Linux setups). Images and PDF work everywhere.
- Only one camera, one player per clip; match stats from rally video are planned as phase 2.

## Licences

MediaPipe Pose (Apache 2.0) is the pose model; no AGPL components are used.
