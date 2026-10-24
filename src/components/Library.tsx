import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { newId, topFix, type Handedness } from '../core';
import { STROKE_LABEL, fmtDate } from '../labels';
import { store, type Player, type SessionSummary } from '../storage/db';

export function Library({ initialPlayerId }: { initialPlayerId?: string }) {
  const { go } = useApp();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<string | undefined>(initialPlayerId);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [name, setName] = useState('');
  const [hand, setHand] = useState<Handedness>('right');

  const reload = async () => {
    const ps = await store.players();
    setPlayers(ps);
    setSelected((cur) => cur ?? ps[0]?.id);
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (selected) store.sessions(selected).then(setSessions);
    else setSessions([]);
  }, [selected]);

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p: Player = { id: newId('pl'), name: name.trim(), hand, createdAt: Date.now() };
    await store.savePlayer(p);
    setName('');
    setSelected(p.id);
    reload();
  };

  const player = players.find((p) => p.id === selected);

  return (
    <div className="library">
      <aside className="players">
        <h2>Players</h2>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              <button className={p.id === selected ? 'selected' : ''} onClick={() => setSelected(p.id)}>
                <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  {p.name}
                  <small>{p.hand === 'right' ? 'Right-handed' : 'Left-handed'}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <form className="add-player" onSubmit={addPlayer}>
          <input placeholder="New player name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="seg">
            <button type="button" className={hand === 'right' ? 'on' : ''} onClick={() => setHand('right')}>Right-handed</button>
            <button type="button" className={hand === 'left' ? 'on' : ''} onClick={() => setHand('left')}>Left-handed</button>
          </div>
          <button className="primary" type="submit" disabled={!name.trim()}>Add player</button>
        </form>
      </aside>

      <section className="sessions">
        {!player ? (
          <div className="empty">
            <h1>Stroke breakdowns for players and coaches</h1>
            <p>Add a player on the left, then import a video of their forehand, backhand or serve. Courtside finds each stroke, splits it into phases and writes the key points.</p>
          </div>
        ) : (
          <>
            <div className="section-head">
              <div>
                <h1>{player.name}</h1>
                <p className="muted">{player.hand === 'right' ? 'Right-handed' : 'Left-handed'} · {sessions.length} session{sessions.length === 1 ? '' : 's'}</p>
              </div>
              <div className="actions">
                <button onClick={() => go({ name: 'trends', playerId: player.id })} disabled={!sessions.length}>Progress</button>
                <button onClick={() => go({ name: 'compare', playerId: player.id })} disabled={!sessions.length}>Compare strokes</button>
                <button className="primary" onClick={() => go({ name: 'import', playerId: player.id })}>New analysis</button>
              </div>
            </div>
            {sessions.length === 0 && (
              <div className="empty small">
                <p>No sessions yet. Film one player from the side or from behind, at 60 fps if your phone allows, and import the clip.</p>
              </div>
            )}
            <div className="session-grid">
              {sessions.map((s) => {
                const counts = s.strokes.reduce<Record<string, number>>((acc, st) => ({ ...acc, [st.type]: (acc[st.type] ?? 0) + 1 }), {});
                const fix = s.strokes.map(topFix).find(Boolean);
                return (
                  <button key={s.id} className="session-card" onClick={() => go({ name: 'session', id: s.id })}>
                    <h3>{s.title}</h3>
                    <p className="muted">{fmtDate(s.createdAt)} · {s.strokes.length} stroke{s.strokes.length === 1 ? '' : 's'}</p>
                    <p className="chips">
                      {Object.entries(counts).map(([t, n]) => (
                        <span key={t} className="chip">{n} {STROKE_LABEL[t as keyof typeof STROKE_LABEL]}</span>
                      ))}
                      {s.tags.map((t) => <span key={t} className="chip tag">{t}</span>)}
                    </p>
                    {fix && <p className="fix-line">Work on: {fix.text}</p>}
                  </button>
                );
              })}
            </div>
            <p className="danger-zone">
              <button
                className="link danger"
                onClick={async () => {
                  if (!confirm(`Delete ${player.name} and all their sessions?`)) return;
                  await store.deletePlayer(player.id);
                  setSelected(undefined);
                  reload();
                }}
              >
                Delete player
              </button>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
