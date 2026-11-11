import { useState } from 'react';
import { fmtMoneyInput } from '../format';

/** An amount field in accounting format: 1,250,000.50 / (50,000.00) when resting, plain digits while typing. */
export function MoneyInput({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <input
      className="num" inputMode="decimal" aria-label={label} disabled={disabled}
      value={editing ? value : fmtMoneyInput(value)}
      onFocus={(e) => { setEditing(true); const el = e.target; setTimeout(() => el.select(), 0); }}
      onBlur={() => setEditing(false)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
