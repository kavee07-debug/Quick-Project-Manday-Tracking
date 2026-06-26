import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MandaySummaryRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { PivotSummaryTable, type PivotRow } from '../components/PivotSummaryTable';
import './MandaySummaryPage.scss';

export default function MandaySummaryPage() {
  const { hasRole } = useAuth();
  const [rows, setRows] = useState<MandaySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MandaySummaryRow[]>('/manday-summary')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  const pivotRows: PivotRow[] = rows.map((r) => ({
    key: r.projectId,
    firstCell: (
      <>
        <strong>{r.code}</strong>
        <span className="muted msummary__projname"> {r.name}</span>
        <span className="msummary__status"><StatusBadge status={r.status} /></span>
      </>
    ),
    cells: r.cells,
  }));

  if (loading) return <p className="muted">กำลังโหลด…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="msummary">
      <h1 className="msummary__title">Manday Summary</h1>
      <p className="muted msummary__hint">
        สรุป manday แยกตามตำแหน่ง (Position) ของ resource ต่อโปรเจกต์ · Remaining = (Budget+Adjust) − Actual
      </p>
      <PivotSummaryTable firstColHeader="Project" rows={pivotRows} isAdmin={hasRole('Admin')} />
    </div>
  );
}
