import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { date, parseMoney, sar } from '../format';
import { MoneyInput } from '../ui/MoneyInput';

interface Account { id: string; name: string; bank: string; balance: string }
interface Draft {
  bankAccounts: Account[];
  receivables: { amount: string; schedule: number[] };
  payables?: { amount: string; schedule: number[] };
  vat: { payable: string; dueDate: string };
  confirmed: boolean;
}
const pct = (x: number) => String(Math.round(x * 10000) / 100);
const toNum = parseMoney;

/** What the plan holds today, as an editable draft (the starter plan has no opening block yet). */
function draftFrom(m: any): Draft {
  const o = m.opening;
  if (o) return {
    bankAccounts: o.bankAccounts.map((a: any) => ({ ...a, balance: String(a.balance) })),
    receivables: { amount: String(o.receivables.amount), schedule: o.receivables.schedule },
    payables: o.payables ? { amount: String(o.payables.amount), schedule: o.payables.schedule } : undefined,
    vat: { payable: String(o.vat.payable), dueDate: o.vat.dueDate || '' }, confirmed: !!o.confirmed
  };
  return {
    bankAccounts: [{ id: 'BA1', name: 'Main operating account', bank: '', balance: String(m.financing.openingCash) }],
    receivables: { amount: String(m.openingReceivable.amount), schedule: m.openingReceivable.schedule },
    payables: m.template === 'lpg-distribution' ? { amount: String(m.gasko.openingPayable), schedule: m.gasko.openingSchedule } : undefined,
    vat: { payable: String(m.financing.openingVatPayable), dueDate: m.financing.openingVatDueDate || '' }, confirmed: false
  };
}

export function Balances() {
  const s = useSession();
  const { t, err, lang } = useI18n();
  const [d, setD] = useState<Draft | null>(null), [version, setVersion] = useState(0), [start, setStart] = useState('');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = s.me.role === 'viewer' || s.plan?.status === 'locked';

  useEffect(() => {
    if (!s.plan) return;
    api<{ plan: { version: number }; model: any }>('GET', `/api/plans/${s.plan.id}`).then((r) => {
      setD(draftFrom(r.model)); setVersion(r.plan.version); setStart(r.model.meta.startDate);
    }).catch((e) => setMsg({ ok: false, text: err(e instanceof ApiError ? e.code : 'network') }));
  }, [s.plan?.id]);
  if (!d) return msg ? <p className="msg err">{msg.text}</p> : <p className="sub">{t('loading')}</p>;

  const set = (fn: (x: Draft) => void) => setD((cur) => { const x: Draft = JSON.parse(JSON.stringify(cur)); fn(x); return x; });
  const total = d.bankAccounts.reduce((a, b) => a + toNum(b.balance), 0);
  const asOf = new Date(Date.parse(start) - 864e5).toISOString().slice(0, 10);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ version: number }>('PUT', `/api/plans/${s.plan!.id}/opening`, { version, data: {
        ...d!, bankAccounts: d!.bankAccounts.map((a) => ({ ...a, balance: String(parseMoney(a.balance)) })),
        vat: { payable: String(parseMoney(d!.vat.payable)), dueDate: d!.vat.dueDate || null },
        receivables: { amount: String(parseMoney(d!.receivables.amount)), schedule: d!.receivables.schedule.map((x) => Math.round(x * 10000) / 10000) },
        payables: d!.payables && { amount: String(parseMoney(d!.payables.amount)), schedule: d!.payables.schedule.map((x) => Math.round(x * 10000) / 10000) }
      } });
      setVersion(r.version);
      setMsg({ ok: true, text: t('saved', { v: r.version }) });
      await s.reload();
    } catch (x) { setMsg({ ok: false, text: err(x instanceof ApiError ? x.code : 'network') }); }
    finally { setBusy(false); }
  }

  const schedule = (key: 'receivables' | 'payables') => {
    const arr = d[key]!.schedule, sum = arr.reduce((a, b) => a + b, 0);
    return (
      <div>
        <span className="sub" style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: 'var(--ink)' }}>{t('whenPaid')}</span>
        <div className="weeks">
          {arr.map((p, i) => (
            <label key={i}><span>W{i + 1} %</span>
              <input className="num" inputMode="decimal" disabled={ro} defaultValue={pct(p)} onChange={(e) => { const v = Number(e.target.value) / 100 || 0; set((x) => { x[key]!.schedule[i] = v; }); }} /></label>
          ))}
          {!ro && arr.length < 13 && <button type="button" className="link" onClick={() => set((x) => { x[key]!.schedule.push(0); })}>{t('addWeek')}</button>}
        </div>
        <span className={'sum ' + (Math.abs(sum - 1) < 0.0005 ? 'ok' : 'bad')}>{t('sumPct', { p: pct(sum) })}</span>
      </div>
    );
  };

  return (
    <form onSubmit={save} noValidate>
      <div className="head"><div><h1>{t('balTitle')}</h1><p className="sub">{t('balSub', { d: date(asOf, lang, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p></div></div>
      {ro && <p className="demo">{t('readOnly')}</p>}
      <section className="card">
        <h2>{t('bank')}</h2><p className="sub">{t('bankSub')}</p>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>{t('accName')}</th><th>{t('accBank')}</th><th className="n">{t('accBal')}</th><th /></tr></thead>
            <tbody>{d.bankAccounts.map((a, i) => (
              <tr key={a.id}>
                <td><input aria-label={t('accName')} disabled={ro} value={a.name} onChange={(e) => set((x) => { x.bankAccounts[i].name = e.target.value; })} /></td>
                <td><input aria-label={t('accBank')} disabled={ro} value={a.bank} onChange={(e) => set((x) => { x.bankAccounts[i].bank = e.target.value; })} /></td>
                <td><MoneyInput label={t('accBal')} disabled={ro} value={a.balance} onChange={(v) => set((x) => { x.bankAccounts[i].balance = v; })} /></td>
                <td>{!ro && d.bankAccounts.length > 1 && <button type="button" className="link" onClick={() => set((x) => { x.bankAccounts.splice(i, 1); })}>{t('remove')}</button>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          {!ro ? <button type="button" className="link" onClick={() => set((x) => { x.bankAccounts.push({ id: 'BA' + Date.now().toString(36).slice(-6), name: '', bank: '', balance: '0' }); })}>{t('addAcc')}</button> : <span />}
          <b className="num">{t('openingCash')}: {sar(total)}</b>
        </div>
      </section>
      <div className="grid g-two" style={{ marginTop: 20 }}>
        <section className="card"><h2>{t('ar')}</h2><p className="sub">{t('arSub')}</p>
          <label className="field"><span>{t('amount')}</span><MoneyInput disabled={ro} value={d.receivables.amount} onChange={(v) => set((x) => { x.receivables.amount = v; })} /></label>
          {schedule('receivables')}</section>
        {d.payables && <section className="card"><h2>{t('ap')}</h2><p className="sub">{t('apSub')}</p>
          <label className="field"><span>{t('amount')}</span><MoneyInput disabled={ro} value={d.payables.amount} onChange={(v) => set((x) => { x.payables!.amount = v; })} /></label>
          {schedule('payables')}</section>}
      </div>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{t('vat')}</h2><p className="sub">{t('vatSub')}</p>
        <div className="grid g-two" style={{ gap: 16 }}>
          <label className="field"><span>{t('amount')}</span><MoneyInput disabled={ro} value={d.vat.payable} onChange={(v) => set((x) => { x.vat.payable = v; })} /></label>
          <label className="field"><span>{t('dueDate')}</span><input type="date" disabled={ro} value={d.vat.dueDate} onChange={(e) => set((x) => { x.vat.dueDate = e.target.value; })} /></label>
        </div>
      </section>
      <section className="card" style={{ marginTop: 20 }}>
        <label className="check"><input type="checkbox" disabled={ro} checked={d.confirmed} onChange={(e) => set((x) => { x.confirmed = e.target.checked; })} /><span>{t('confirmed')}</span></label>
        {!ro && <div className="actions"><button className="btn" disabled={busy}>{busy ? t('saving') : t('save')}</button>
          {msg && <p className={'msg ' + (msg.ok ? 'ok' : 'err')} role="status">{msg.text}</p>}</div>}
      </section>
    </form>
  );
}
