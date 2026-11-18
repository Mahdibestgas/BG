import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { currentScheme, onSystemScheme, setScheme, type Scheme } from '../theme';

const ICONS: Record<string, string> = {
  overview: 'M3 15l4-5 3 3 6-8', cash: 'M3 5h14M3 10h14M3 15h14', balances: 'M3 6h14v9H3zM3 9h14',
  variance: 'M4 10h5M11 10h5M10 5v10', analysis: 'M4 16V9M10 16V4M16 16v-5', board: 'M5 3h10v14H5zM8 7h4M8 10h4M8 13h2', pnl: 'M3 16h14M5 13l3-4 3 2 4-6', look: 'M10 3a7 7 0 100 14c1 0 1.5-.8 1-1.6-.6-1 0-2.4 1.4-2.4H15a2 2 0 002-2 7 7 0 00-7-8z', activity: 'M10 4v6l3 2M10 17a7 7 0 110-14 7 7 0 010 14z', budget: 'M4 3h12v14H4zM7 7h6M7 10h6M7 13h3', people: 'M7 9a3 3 0 100-6 3 3 0 000 6zM2 17c0-3 2.5-5 5-5s5 2 5 5M14 9a2.5 2.5 0 100-5M15 12c2 .5 3 2.4 3 5'
};
const Icon = ({ k }: { k: string }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={ICONS[k]} strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const { t, lang, setLang } = useI18n();
  const where = useLocation().pathname;
  const [scheme, setSch] = useState<Scheme>(currentScheme);
  useEffect(() => onSystemScheme(setSch), []);
  const flip = () => { const n: Scheme = scheme === 'dark' ? 'light' : 'dark'; setScheme(n); setSch(n); };
  const name = lang === 'ar' && s.tenant.nameAr ? s.tenant.nameAr : s.tenant.name;
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const fin = s.me.role === 'owner' || s.me.role === 'finance';
  // the order the work happens: study and plan, budget, forecast, reports, then administration
  const groups: Array<{ h: string; links: Array<[string, string, string]> }> = s.me.role === 'contributor'
    ? [{ h: '', links: [['/budget', 'budget', L('Study, plan and budget', 'الدراسة والخطة والميزانية')]] }]
    : [
      ...(fin ? [{ h: L('Study, plan, budget', 'الدراسة والخطة والميزانية'), links: [['/budget', 'budget', L('Department budgets', 'ميزانيات الإدارات')]] as Array<[string, string, string]> }] : []),
      { h: L('Cash forecast', 'التوقع النقدي'), links: [['/', 'overview', t('nav_overview')], ['/cash-flow', 'cash', t('nav_cash')], ['/analysis', 'analysis', t('nav_analysis')], ['/pnl', 'pnl', t('nav_pnl')], ['/balances', 'balances', t('nav_balances')], ...(fin ? [['/plans/import', 'cash', L('Load a plan file', 'تحميل ملف خطة')]] as Array<[string, string, string]> : [])] },
      { h: L('Reports', 'التقارير'), links: [...(fin ? [['/reports/budget-vs-actual', 'variance', L('Budget vs actual', 'الميزانية مقابل الفعلي')]] as Array<[string, string, string]> : []), ['/variance', 'variance', t('nav_variance')], ['/reports/compare', 'analysis', L('Compare plans', 'مقارنة الخطط')], ['/board', 'board', t('nav_board')]] },
      ...(fin ? [{ h: L('Administration', 'الإدارة'), links: [...(s.me.role === 'owner' ? [['/people', 'people', L('People and invitations', 'الفريق والدعوات')], ['/look', 'look', t('nav_brand')]] as Array<[string, string, string]> : []), ...(s.me.platformOwner ? [['/companies', 'balances', L('Companies', 'الشركات')]] as Array<[string, string, string]> : []), ['/activity', 'activity', t('nav_activity')]] as Array<[string, string, string]> }] : [])
    ];
  return (
    <div className="app">
      <aside className="side">
        {s.hasLogo ? (
          <div className="co">
            <div className="mark"><img src={'/api/tenant/logo?v=' + encodeURIComponent(s.logoVersion)} alt="" /></div>
            <div><b>{name}</b><span>{t('product')}</span></div>
          </div>
        ) : (
          // Best Gas's own identity: the round emblem and the bilingual wordmark (light version, made for dark grounds)
          <div className="co co-bg">
            <img className="co-emblem" src="/bestgas-logo.png" alt="" />
            <div className="co-words">
              <img className="co-wordmark" src="/bestgas-wordmark-light.png" alt={name} />
              <span>{t('product')}{name.toLowerCase() !== 'best gas' ? ' · ' + name : ''}</span>
            </div>
          </div>
        )}
        <nav className="nav" aria-label={t('product')}>
          {groups.map((g, i) => <div className="nav-g" key={i}>{g.h && <div className="nav-h">{g.h}</div>}{g.links.map(([to, k, label]) => <NavLink key={to} to={to} end={to === '/' || to === '/budget'}><Icon k={k} />{label}</NavLink>)}</div>)}
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
            <NavLink className="who" to="/account" title={(lang === 'ar' ? 'حسابي: ' : 'My account: ') + s.me.account.email}>{s.me.account.name}</NavLink>
            <button type="button" onClick={() => s.signOut()}>{t('signOut')}</button>
          </div>
        </div>
      </aside>
      <main id="main">
        {s.plan?.demo && <div className="demo" role="note"><b>{t('demo')}</b> {t('demoText')}{(s.me.role === 'owner' || s.me.role === 'finance') && <> <NavLink className="link" to="/plans/import">{L('Load your plan file', 'حمّل ملف خطتك')}</NavLink></>}</div>}
        <div className="route-bar" key={'bar' + where} aria-hidden="true" />
        <div className="route-in" key={where}>{children}</div>
      </main>
    </div>
  );
}
