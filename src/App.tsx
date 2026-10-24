import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Rule } from './core';
import { store } from './storage/db';
import { Library } from './components/Library';
import { ImportView } from './components/ImportView';
import { SessionView } from './components/SessionView';
import { CompareView } from './components/CompareView';
import { TrendsView } from './components/TrendsView';
import { RulesView } from './components/RulesView';

export type Route =
  | { name: 'library'; playerId?: string }
  | { name: 'import'; playerId: string }
  | { name: 'session'; id: string }
  | { name: 'compare'; playerId: string; strokeId?: string }
  | { name: 'trends'; playerId: string }
  | { name: 'rules' };

interface AppCtx {
  route: Route;
  go: (r: Route) => void;
  rules: Rule[];
  setRules: (r: Rule[]) => Promise<void>;
}

const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'library' });
  const [rules, setRulesState] = useState<Rule[] | null>(null);

  useEffect(() => {
    store.rules().then(setRulesState);
  }, []);

  const setRules = useCallback(async (r: Rule[]) => {
    setRulesState(r);
    await store.saveRules(r);
  }, []);

  if (!rules) return <div className="loading">Loading…</div>;

  return (
    <Ctx.Provider value={{ route, go: setRoute, rules, setRules }}>
      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={() => setRoute({ name: 'library' })}>
            <img src="/icon.svg" alt="" /> Courtside
          </button>
          <nav>
            <button className={route.name !== 'rules' ? 'active' : ''} onClick={() => setRoute({ name: 'library' })}>Players</button>
            <button className={route.name === 'rules' ? 'active' : ''} onClick={() => setRoute({ name: 'rules' })}>Coach settings</button>
          </nav>
        </header>
        <main>
          {route.name === 'library' && <Library initialPlayerId={route.playerId} />}
          {route.name === 'import' && <ImportView playerId={route.playerId} />}
          {route.name === 'session' && <SessionView id={route.id} />}
          {route.name === 'compare' && <CompareView playerId={route.playerId} strokeId={route.strokeId} />}
          {route.name === 'trends' && <TrendsView playerId={route.playerId} />}
          {route.name === 'rules' && <RulesView />}
        </main>
      </div>
    </Ctx.Provider>
  );
}
