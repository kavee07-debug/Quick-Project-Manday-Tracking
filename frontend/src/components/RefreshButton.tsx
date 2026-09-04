import { useState } from 'react';
import './RefreshButton.scss';

interface Props {
  /**
   * Re-runs the page's own query. Pages pass their existing load function, so the refresh
   * always uses whatever filters/paging/sorting are active at that moment.
   */
  onRefresh: () => void | Promise<void>;
  /** Hide the "อัปเดต HH:mm:ss" stamp on tight headers. */
  compact?: boolean;
}

/**
 * Shared "pull the latest rows from the server" control. The app is used by several people at
 * once, so a screen left open goes stale as soon as someone else saves — this re-queries on demand
 * and stamps when the data was last fetched.
 */
export function RefreshButton({ onRefresh, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<Date>(() => new Date());   // mount = the page's first load

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
      setAt(new Date());
    } catch {
      /* the page surfaces its own error; keep the previous stamp */
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="refresh">
      {!compact && (
        <span className="refresh__stamp muted" title="เวลาที่ดึงข้อมูลล่าสุด">
          อัปเดต {at.toLocaleTimeString('th-TH')}
        </span>
      )}
      <button
        type="button"
        className="btn btn--sm refresh__btn"
        onClick={run}
        disabled={busy}
        title="ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์ (ใช้ตัวกรองปัจจุบัน)"
      >
        <span className={`refresh__icon${busy ? ' is-spinning' : ''}`} aria-hidden="true">⟳</span>
        {busy ? 'กำลังโหลด…' : 'Refresh'}
      </button>
    </span>
  );
}
