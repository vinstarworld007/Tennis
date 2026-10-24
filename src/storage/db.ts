import { openDB, type IDBPDatabase } from 'idb';
import type { Handedness, PoseFrame, Rule, Stroke } from '../core';
import { DEFAULT_RULES } from '../core';

export interface Player {
  id: string;
  name: string;
  hand: Handedness;
  createdAt: number;
}

export type Tag = 'Technique' | 'Tactics' | 'Footwork';
export const TAGS: Tag[] = ['Technique', 'Tactics', 'Footwork'];

export interface Session {
  id: string;
  playerId: string;
  title: string;
  createdAt: number;
  fps: number;
  start: number;
  end: number;
  duration: number;
  width: number;
  height: number;
  frames: PoseFrame[];
  strokes: Stroke[];
  tags: Tag[];
  notes: string;
}

/** The session list view, without the heavy pose data. */
export type SessionSummary = Omit<Session, 'frames'>;

const DB_NAME = 'courtside';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('players', { keyPath: 'id' });
      const s = d.createObjectStore('sessions', { keyPath: 'id' });
      s.createIndex('playerId', 'playerId');
      d.createObjectStore('videos');
      d.createObjectStore('settings');
    },
  });
  return dbp;
}

export const store = {
  async players(): Promise<Player[]> {
    return ((await (await db()).getAll('players')) as Player[]).sort((a, b) => a.name.localeCompare(b.name));
  },
  async savePlayer(p: Player) {
    await (await db()).put('players', p);
  },
  async deletePlayer(id: string) {
    const d = await db();
    for (const s of await this.sessions(id)) await this.deleteSession(s.id);
    await d.delete('players', id);
  },
  async sessions(playerId?: string): Promise<SessionSummary[]> {
    const d = await db();
    const all = (playerId ? await d.getAllFromIndex('sessions', 'playerId', playerId) : await d.getAll('sessions')) as Session[];
    return all.map(({ frames: _f, ...rest }) => rest).sort((a, b) => b.createdAt - a.createdAt);
  },
  async session(id: string): Promise<Session | undefined> {
    return (await db()).get('sessions', id);
  },
  async saveSession(s: Session) {
    await (await db()).put('sessions', s);
  },
  async deleteSession(id: string) {
    const d = await db();
    await d.delete('sessions', id);
    await d.delete('videos', id);
  },
  async saveVideo(id: string, blob: Blob) {
    await (await db()).put('videos', blob, id);
  },
  async video(id: string): Promise<Blob | undefined> {
    return (await db()).get('videos', id);
  },
  async rules(): Promise<Rule[]> {
    const saved = (await (await db()).get('settings', 'rules')) as Rule[] | undefined;
    if (!saved) return DEFAULT_RULES;
    // New default rules appear automatically; saved edits win for existing ids.
    const byId = new Map(saved.map((r) => [r.id, r]));
    return [...DEFAULT_RULES.map((r) => byId.get(r.id) ?? r), ...saved.filter((r) => !DEFAULT_RULES.some((d) => d.id === r.id))];
  },
  async saveRules(rules: Rule[]) {
    await (await db()).put('settings', rules, 'rules');
  },
};
