import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';

interface Entry { at: string; action: string; actorId: string | null; entity: string | null; changes: any }

export function Activity() {
  const { t, err, lang } = useI18n();
  const [rows, setRows] = useState<Entry[] | null>(null), [error, setError] = useState('');
  useEffect(() => { api<{ audit: Entry[] }>('GET', '/api/audit').then((r) => setRows(r.audit)).catch((e) => setError(e instanceof ApiError ? e.code : 'network')); }, []);
  if (error) return <p className="msg err">{err(error)}</p>;
  if (!rows) return <p className="sub">{t('loading')}</p>;
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date(iso));
  const label = (a: string) => { const k = ('a_' + a) as any; const s = t(k); return s === k ? a : s; };
  return (
    <>
      <div className="head"><div><h1>{t('actTitle')}</h1><p className="sub">{t('actSub')}</p></div></div>
      <section className="card"><ul className="list act">
        {rows.map((r, i) => (
          <li key={i}><span className="w">{label(r.action)}</span><span className="s">{when(r.at)}{r.changes?.version ? ' · v' + r.changes.version : ''}</span></li>
        ))}
      </ul></section>
    </>
  );
}
