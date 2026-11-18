import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { date } from '../format';
import { useBudgetMeta } from './Budget';

interface Member { accountId: string; name: string; email: string; role: string; department: string | null; twoFactor: boolean; since: string }
interface Invite { id: string; email: string; role: string; department: string | null; createdAt: string; expiresAt: string }
const ROLE: Record<string, { en: string; ar: string }> = {
  owner: { en: 'Owner (approves)', ar: 'المالك (يعتمد)' }, finance: { en: 'Finance (prepares and reviews)', ar: 'المالية (تعدّ وتراجع)' },
  viewer: { en: 'Viewer (reads the cash plan)', ar: 'مشاهد (يطّلع على خطة النقد)' }, contributor: { en: 'Department head (own budget only)', ar: 'مدير إدارة (ميزانية إدارته فقط)' }
};

/** People in the company and invitations. A department head is invited with their department and sees only that budget. */
export function People() {
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const [data, setData] = useState<{ you: string; members: Member[]; invitations: Invite[] } | null>(null);
  const [f, setF] = useState({ email: '', role: 'contributor', department: 'hr', days: 7 });
  const [link, setLink] = useState(''), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [copied, setCopied] = useState(false);
  const load = useCallback(() => api('GET', '/api/members').then(setData).catch((e) => setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') })), [err]);
  useEffect(() => { load(); }, [load]);
  const dName = (id: string | null) => (id ? txt(meta?.pack.allDepartments.find((d) => d.id === id)?.name) || id : '');
  const fail = (e: unknown) => setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') });

  async function invite() {
    setMsg(null); setLink(''); setCopied(false);
    try {
      const r = await api<{ path: string }>('POST', '/api/members/invites', { email: f.email.trim(), role: f.role, department: f.role === 'contributor' ? f.department : undefined, days: f.days });
      setLink(location.origin + r.path); setF({ ...f, email: '' }); load();
    } catch (e) { fail(e); }
  }
  if (!data) return msg ? <p className="msg err">{msg.t}</p> : <p className="sub">…</p>;
  return (
    <div className="bgt">
      <div className="head"><div><h1>{T('People and invitations', 'الفريق والدعوات')}</h1>
        <p className="sub">{T('Invite each department head with their department. They see only their own budget: no cash plan, no other department, no salaries outside HR.', 'ادعُ كل مدير إدارة مع إدارته. لا يرى إلا ميزانية إدارته: لا خطة نقد ولا إدارات أخرى ولا رواتب خارج الموارد البشرية.')}</p></div></div>
      <section className="card">
        <h2>{T('Invite someone', 'دعوة شخص')}</h2>
        <div className="bgt-form">
          <label className="field"><span>{T('Work email', 'البريد الإلكتروني للعمل')}</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field"><span>{T('Role', 'الدور')}</span><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.keys(ROLE).map((r) => <option key={r} value={r}>{txt(ROLE[r])}</option>)}</select></label>
          {f.role === 'contributor' && <label className="field"><span>{T('Department', 'الإدارة')}</span><select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{meta?.pack.allDepartments.map((d) => <option key={d.id} value={d.id}>{txt(d.name)}</option>)}</select></label>}
          <label className="field"><span>{T('Link valid for (days)', 'صلاحية الرابط (أيام)')}</span><input type="number" min={1} max={30} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></label>
        </div>
        <div className="actions"><button type="button" className="btn" disabled={!f.email.includes('@')} onClick={invite}>{T('Create invitation link', 'إنشاء رابط الدعوة')}</button>{msg && <span className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</span>}</div>
        {link && <div className="bgt-link" role="status">
          <p className="sub">{T('Send this link to the person yourself (email or WhatsApp). It works once, and it is shown only now.', 'أرسل هذا الرابط إلى الشخص بنفسك (بريد أو واتساب). يعمل مرة واحدة ويظهر الآن فقط.')}</p>
          <code>{link}</code>
          <button type="button" className="btn ghost" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>{copied ? T('Copied', 'تم النسخ') : T('Copy link', 'نسخ الرابط')}</button>
        </div>}
      </section>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Members', 'الأعضاء')}</h2>
        <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Name', 'الاسم')}</th><th>{T('Email', 'البريد')}</th><th>{T('Role', 'الدور')}</th><th>{T('Department', 'الإدارة')}</th><th>{T('Two-factor', 'التحقق الثنائي')}</th><th /></tr></thead>
          <tbody>{data.members.map((mm) => <tr key={mm.accountId}><td>{mm.name}</td><td className="sub">{mm.email}</td><td>{txt(ROLE[mm.role] || { en: mm.role, ar: mm.role })}</td><td>{dName(mm.department)}</td><td>{mm.twoFactor ? T('On', 'مفعّل') : T('Off', 'غير مفعّل')}</td>
            <td>{mm.accountId !== data.you && <button type="button" className="link danger" onClick={() => { if (confirm(T(`Remove ${mm.name}? Their access ends at once.`, `حذف ${mm.name}؟ تنتهي صلاحيته فورًا.`))) api('DELETE', `/api/members/${mm.accountId}`).then(load).catch(fail); }}>{T('Remove', 'حذف')}</button>}</td></tr>)}</tbody></table></div>
      </section>
      {data.invitations.length > 0 && <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Open invitations', 'الدعوات المفتوحة')}</h2>
        <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Email', 'البريد')}</th><th>{T('Role', 'الدور')}</th><th>{T('Department', 'الإدارة')}</th><th>{T('Expires', 'تنتهي')}</th><th /></tr></thead>
          <tbody>{data.invitations.map((i) => <tr key={i.id}><td>{i.email}</td><td>{txt(ROLE[i.role] || { en: i.role, ar: i.role })}</td><td>{dName(i.department)}</td><td className="sub">{date(i.expiresAt.slice(0, 10), lang, { day: 'numeric', month: 'short' })}</td>
            <td><button type="button" className="link danger" onClick={() => api('DELETE', `/api/members/invites/${i.id}`).then(load).catch(fail)}>{T('Cancel', 'إلغاء')}</button></td></tr>)}</tbody></table></div>
      </section>}
    </div>
  );
}
