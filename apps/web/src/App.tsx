import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { Theme } from '@cf13/theme';
import { api, type Me, type PlanSummary } from './api';
import { applyTheme } from './theme';
import { Shell } from './ui/Shell';
import { SignIn, SignUp } from './screens/Auth';
import { Overview } from './screens/Overview';
import { CashFlow } from './screens/CashFlow';
import { Balances } from './screens/Balances';
import { Branding } from './screens/Branding';
import { Activity } from './screens/Activity';
import { Analysis } from './screens/Analysis';
import { VarianceScreen } from './screens/Variance';
import { Board } from './screens/Board';
import { Pnl } from './screens/Pnl';
import { BudgetHome, CompanyBudget, DeptBudget } from './screens/Budget';
import { BudgetActuals, BudgetVariance, ComparePlans } from './screens/BudgetCycle';
import { People } from './screens/People';
import { Join } from './screens/Join';

export interface Session {
  me: Me;
  tenant: { id: string; slug: string; name: string; nameAr: string | null; template: string };
  hasLogo: boolean;
  logoVersion: string;
  plan: PlanSummary | null;
  plans: PlanSummary[];
  pickPlan: (id: string) => void;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  switchTo: (tenantId: string) => Promise<void>;
}
const SessionCtx = createContext<Session | null>(null);
export const useSession = () => { const s = useContext(SessionCtx); if (!s) throw new Error('no session'); return s; };

export function App() {
  const [state, setState] = useState<'loading' | 'out' | Omit<Session, 'reload' | 'signOut' | 'switchTo' | 'pickPlan'>>('loading');
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const me = await api<Me & { ok: true }>('GET', '/api/auth/me');
      // a department head sees only their budget: no cash plans are fetched for them
      const [t, plans] = await Promise.all([
        api<{ tenant: Session['tenant']; theme: Theme | null; hasLogo: boolean; brandingVersion: string | null }>('GET', '/api/tenant'),
        me.role === 'contributor' ? Promise.resolve({ plans: [] as PlanSummary[] }) : api<{ plans: PlanSummary[] }>('GET', '/api/plans')
      ]);
      applyTheme(t.theme);
      // the plan last picked on this device, else the newest real plan, else the starter plan
      let saved = '';
      try { saved = localStorage.getItem('cf13_plan:' + t.tenant.id) || ''; } catch { /* private mode */ }
      const byNew = [...plans.plans].reverse();
      const plan = plans.plans.find((p) => p.id === saved) || byNew.find((p) => !p.demo) || byNew[0] || null;
      setState({ me, tenant: t.tenant, hasLogo: t.hasLogo, logoVersion: t.brandingVersion || '0', plan, plans: plans.plans });
    } catch {
      applyTheme(null);
      setState('out');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const out = () => { applyTheme(null); setState('out'); };
    window.addEventListener('cf13:signed-out', out);
    return () => window.removeEventListener('cf13:signed-out', out);
  }, []);

  if (state === 'loading') return <div className="auth-form" style={{ minHeight: '100dvh' }} aria-busy="true" />;
  if (state === 'out') {
    return (
      <Routes>
        <Route path="/signup" element={<SignUp onDone={async () => { await load(); nav('/'); }} />} />
        <Route path="/join/:token" element={<Join onDone={async () => { await load(); nav('/'); }} />} />
        <Route path="*" element={<SignIn onDone={async () => { await load(); nav('/'); }} />} />
      </Routes>
    );
  }
  const session: Session = {
    ...state,
    reload: load,
    pickPlan: (id) => {
      const p = state.plans.find((x) => x.id === id);
      if (!p) return;
      try { localStorage.setItem('cf13_plan:' + state.tenant.id, id); } catch { /* private mode */ }
      setState({ ...state, plan: p });
    },
    signOut: async () => { await api('POST', '/api/auth/logout').catch(() => {}); applyTheme(null); setState('out'); nav('/'); },
    switchTo: async (id) => { await api('POST', '/api/auth/switch', { tenantId: id }); await load(); nav('/'); }
  };
  return (
    <SessionCtx.Provider value={session}>
      <Shell>
        {state.me.role === 'contributor' ? (
          <Routes>
            <Route path="/budget" element={<BudgetHome />} />
            <Route path="/budget/:cycle/:dept" element={<DeptBudget />} />
            <Route path="*" element={<Navigate to="/budget" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route path="/budget" element={<BudgetHome />} />
          <Route path="/budget/:cycle/company" element={<CompanyBudget />} />
          <Route path="/budget/:cycle/actuals" element={<BudgetActuals />} />
          <Route path="/budget/:cycle/variance" element={<BudgetVariance />} />
          <Route path="/reports/budget-vs-actual" element={<BudgetVariance />} />
          <Route path="/reports/compare" element={<ComparePlans />} />
          <Route path="/budget/:cycle/:dept" element={<DeptBudget />} />
          <Route path="/people" element={<People />} />
          <Route path="/" element={<Overview />} />
          <Route path="/cash-flow" element={<CashFlow />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/variance" element={<VarianceScreen />} />
          <Route path="/pnl" element={<Pnl />} />
          <Route path="/board" element={<Board />} />
          <Route path="/balances" element={<Balances />} />
          <Route path="/look" element={<Branding />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        )}
      </Shell>
    </SessionCtx.Provider>
  );
}
