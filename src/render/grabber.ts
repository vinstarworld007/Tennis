import { loadVideo } from '../pose/poseRunner';

/**
 * A private video element for rendering stills (thumbnails, exports) without
 * disturbing the main player. Requests are served one at a time.
 */
export class FrameGrabber {
  private video: Promise<HTMLVideoElement>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(url: string) {
    this.video = loadVideo(url);
  }

  /** Seek to `t` seconds, then run `use` with the video showing that frame. */
  at<T>(t: number, use: (v: HTMLVideoElement) => T | Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const v = await this.video;
      if (Math.abs(v.currentTime - t) > 1e-4 || v.readyState < 2) {
        await new Promise<void>((resolve) => {
          const done = () => { v.removeEventListener('seeked', done); resolve(); };
          v.addEventListener('seeked', done);
          v.currentTime = t;
        });
      }
      return use(v);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  async size() {
    const v = await this.video;
    return { w: v.videoWidth, h: v.videoHeight };
  }

  async dispose() {
    const v = await this.video;
    v.removeAttribute('src');
    v.load();
  }
}
