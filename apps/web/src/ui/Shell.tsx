import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { currentScheme, onSystemScheme, setScheme, type Scheme } from '../theme';

const ICONS: Record<string, string> = {
  overview: 'M3 15l4-5 3 3 6-8', cash: 'M3 5h14M3 10h14M3 15h14', balances: 'M3 6h14v9H3zM3 9h14',
  variance: 'M4 10h5M11 10h5M10 5v10', analysis: 'M4 16V9M10 16V4M16 16v-5', board: 'M5 3h10v14H5zM8 7h4M8 10h4M8 13h2', pnl: 'M3 16h14M5 13l3-4 3 2 4-6', look: 'M10 3a7 7 0 100 14c1 0 1.5-.8 1-1.6-.6-1 0-2.4 1.4-2.4H15a2 2 0 002-2 7 7 0 00-7-8z', activity: 'M10 4v6l3 2M10 17a7 7 0 110-14 7 7 0 010 14z'
};
const Icon = ({ k }: { k: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={ICONS[k]} strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const { t, lang, setLang } = useI18n();
  const [scheme, setSch] = useState<Scheme>(currentScheme);
  useEffect(() => onSystemScheme(setSch), []);
  const flip = () => { const n: Scheme = scheme === 'dark' ? 'light' : 'dark'; setScheme(n); setSch(n); };
  const name = lang === 'ar' && s.tenant.nameAr ? s.tenant.nameAr : s.tenant.name;
  const links: Array<[string, string, string]> = [['/', 'overview', t('nav_overview')], ['/cash-flow', 'cash', t('nav_cash')], ['/analysis', 'analysis', t('nav_analysis')], ['/variance', 'variance', t('nav_variance')], ['/pnl', 'pnl', t('nav_pnl')], ['/board', 'board', t('nav_board')], ['/balances', 'balances', t('nav_balances')]];
  if (s.me.role === 'owner') links.push(['/look', 'look', t('nav_brand')]);
  if (s.me.role !== 'viewer') links.push(['/activity', 'activity', t('nav_activity')]);
  return (
    <div className="app">
      <aside className="side">
        <div className="co">
          <div className="mark">{s.hasLogo ? <img src={'/api/tenant/logo?v=' + encodeURIComponent(s.logoVersion)} alt="" /> : name.slice(0, 1)}</div>
          <div><b>{name}</b><span>{t('product')}</span></div>
        </div>
        <nav className="nav" aria-label={t('product')}>
          {links.map(([to, k, label]) => <NavLink key={to} to={to} end={to === '/'}><Icon k={k} />{label}</NavLink>)}
        </nav>
        <div className="side-foot">
          {s.me.companies.length > 1 && (
            <select aria-label={t('switchCompany')} value={s.me.tenantId} onChange={(e) => s.switchTo(e.target.value)}>
              {s.me.companies.map((c) => <option key={c.id} value={c.id}>{lang === 'ar' && c.nameAr ? c.nameAr : c.name}</option>)}
            </select>
          )}
          <div className="side-row">
            <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('lang')}</button>
            <button type="button" onClick={flip} aria-pressed={scheme === 'dark'}>{scheme === 'dark' ? t('schemeLight') : t('schemeDark')}</button>
          </div>
          <div className="acct">
            <div className="who" title={s.me.account.email}>{s.me.account.name}</div>
            <button type="button" onClick={() => s.signOut()}>{t('signOut')}</button>
          </div>
        </div>
      </aside>
      <main id="main">
        {s.plan?.demo && <div className="demo" role="note"><b>{t('demo')}</b> {t('demoText')}</div>}
        {children}
      </main>
    </div>
  );
}
