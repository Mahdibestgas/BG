import { useState } from 'react';
import type { Theme } from '@cf13/theme';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { applyTheme, themeFromFile } from '../theme';

export function Branding() {
  const s = useSession();
  const { t, err } = useI18n();
  const [pick, setPick] = useState<{ theme: Theme; adjusted: string[]; base64: string; type: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (s.me.role !== 'owner') return <p className="demo">{t('ownerOnly')}</p>;

  async function choose(file: File | undefined) {
    setMsg(null);
    if (!file) return;
    try { setPick(await themeFromFile(file)); }
    catch (e) { setMsg({ ok: false, text: err((e as Error).message) }); }
  }
  async function save() {
    if (!pick) return;
    setBusy(true);
    try {
      await api('PUT', '/api/tenant/branding', { theme: pick.theme, logo: pick.base64, logoType: pick.type });
      applyTheme(pick.theme);
      await s.reload();
      setMsg({ ok: true, text: t('lookSaved') });
    } catch (e) { setMsg({ ok: false, text: err(e instanceof ApiError ? e.code : 'network') }); }
    finally { setBusy(false); }
  }
  const th = pick?.theme;
  return (
    <>
      <div className="head"><div><h1>{t('brandTitle')}</h1><p className="sub" style={{ maxWidth: '70ch' }}>{t('brandSub')}</p></div></div>
      <div className="grid g-two">
        <section className="card">
          <label className="field"><span>{t('chooseLogo')}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => choose(e.target.files?.[0])} /></label>
          {th && <>
            <div className="swatches">{(['brand', 'brandDeep', 'brandSoft', 'paper', 'ink'] as const).map((k) => <i key={k} title={k + ' ' + th[k]} style={{ background: th[k] }} />)}</div>
            {pick!.adjusted.includes('brand_darkened') && <p className="sub">{t('adjusted')}</p>}
            <div className="actions"><button type="button" className="btn" disabled={busy} onClick={save}>{t('saveLook')}</button></div>
          </>}
          {msg && <p className={'msg ' + (msg.ok ? 'ok' : 'err')} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
        </section>
        {th && <section className="card">
          <h2>{t('preview')}</h2>
          <div className="preview" style={{ marginTop: 12 }}>
            <div className="pv-side" style={{ background: th.brandDeep }}>
              <img src={pick!.url} alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', background: th.brand }} />
              <div style={{ marginTop: 10, fontWeight: 600 }}>{s.tenant.name}</div>
            </div>
            <div className="pv-main" style={{ background: th.paper, color: th.ink }}>
              <div style={{ fontWeight: 600, fontSize: 18 }}>{t('overviewTitle')}</div>
              <div style={{ color: th.ink2, fontSize: 13 }}>{t('runwaySub')}</div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <span style={{ background: th.brand, color: '#fff', borderRadius: 99, padding: '6px 14px', fontSize: 13 }}>{t('save')}</span>
                <span style={{ background: 'var(--rec)', width: 14, borderRadius: 3 }} /><span style={{ background: 'var(--pay)', width: 14, borderRadius: 3 }} />
              </div>
            </div>
          </div>
        </section>}
      </div>
    </>
  );
}
