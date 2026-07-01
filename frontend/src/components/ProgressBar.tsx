import './ProgressBar.scss';

/**
 * Project completion bar. The fill colour scales from red (low %) through
 * amber to green (high %) via HSL hue 0→120, so higher progress = greener.
 */
export function ProgressBar({ value }: { value?: number | null }) {
  if (value == null) return <span className="muted">—</span>;

  const pct = Math.max(0, Math.min(100, value));
  const hue = pct * 1.2; // 0 => red, 60 => amber, 120 => green
  const label = `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

  return (
    <div className="progressbar" title={label}>
      <div className="progressbar__track">
        <div
          className="progressbar__fill"
          style={{ width: `${pct}%`, background: `hsl(${hue}, 70%, 45%)` }}
        />
      </div>
      <span className="progressbar__label">{label}</span>
    </div>
  );
}
