import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ResourceMandaySummaryRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PivotSummaryTable, type PivotRow } from '../components/PivotSummaryTable';
import './MandaySummaryPage.scss';

export default function ResourceMandaySummaryPage() {
  const { hasRole } = useAuth();
  const [rows, setRows] = useState<ResourceMandaySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ResourceMandaySummaryRow[]>('/resource-manday-summary')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  const pivotRows: PivotRow[] = rows.map((r) => ({
    key: `${r.resourceId}-${r.code}`,
    firstCell: (
      <>
        <strong>{r.code}</strong>
        <span className="muted msummary__projname"> {r.name}</span>
      </>
    ),
    cells: r.cells,
  }));

  if (loading) return <p className="muted">กำลังโหลด…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="msummary">
      <h1 className="msummary__title">Resource Manday Summary</h1>
      <p className="muted msummary__hint">
        สรุป manday แยกตาม resource (วางในกลุ่มตำแหน่งของตนเอง) · Remaining = (Budget+Adjust) − Actual
      </p>
      <PivotSummaryTable firstColHeader="Resource" rows={pivotRows} isAdmin={hasRole('Admin')} />
    </div>
  );
}
