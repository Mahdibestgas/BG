import { useEffect, useState } from 'react';
import { chooseScheme, onSystemScheme, schemeChoice, type SchemeChoice } from '../theme';
import { useI18n } from '../i18n';

/** Day, night, or follow the device. The choice is kept on this device only. */
export function SchemeSwitch({ className = '' }: { className?: string }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [c, setC] = useState<SchemeChoice>(schemeChoice);
  const [, bump] = useState(0);
  useEffect(() => onSystemScheme(() => bump((n) => n + 1)), []);
  const pick = (v: SchemeChoice) => { chooseScheme(v); setC(v); };
  const opts: Array<[SchemeChoice, string, JSX.Element]> = [
    ['auto', T('Auto: follow this device', 'تلقائي: حسب الجهاز'), <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5v13A6.5 6.5 0 0 0 10 3.5z" className="fill" /></svg>],
    ['light', T('Day', 'نهاري'), <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6" /><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7" /></svg>],
    ['dark', T('Night', 'ليلي'), <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.6A6.6 6.6 0 0 1 7.4 4.2a6.6 6.6 0 1 0 8.4 8.4z" /></svg>]
  ];
  return (
    <div className={'scheme-sw ' + className} role="radiogroup" aria-label={T('Day or night', 'نهاري أو ليلي')}>
      {opts.map(([v, label, icon]) => (
        <button key={v} type="button" role="radio" aria-checked={c === v} title={label} aria-label={label} onClick={() => pick(v)}>{icon}</button>
      ))}
    </div>
  );
}
