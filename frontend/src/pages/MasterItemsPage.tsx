import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MasterItem, MasterItemFetchResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import './ResourcePage.scss';

export default function MasterItemsPage() {
  const { hasRole, isManager } = useAuth();
  const isAdmin = hasRole('Admin');

  const [items, setItems] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [fetchResult, setFetchResult] = useState<MasterItemFetchResult | null>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await api.get<MasterItem[]>('/master-items'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.number, i.displayName, i.itemCategoryCode].some((v) => (v ?? '').toLowerCase().includes(q)),
    );
  }, [items, query]);

  async function fetchFromBc() {
    setBusy(true);
    setError(null);
    setFetchResult(null);
    try {
      setFetchResult(await api.post<MasterItemFetchResult>('/d365/items/fetch'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดึงข้อมูลจาก D365BC ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: MasterItem) {
    if (!confirm(`ลบ Item "${item.number}"?`)) return;
    try {
      await api.del(`/master-items/${item.itemId}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'ลบไม่สำเร็จ');
    }
  }

  return (
    <div className="resources">
      <div className="resources__head">
        <h1>Master Item</h1>
        {isAdmin && (
          <button className="btn btn--primary" onClick={fetchFromBc} disabled={busy}>
            ⬇ ดึงจาก D365BC
          </button>
        )}
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        รายการ Item ซิงก์จาก D365BC (number / displayName / itemCategoryCode) — ใช้จับคู่หา Revenue ตอนดึง API Job
      </p>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <input
          className="input"
          type="search"
          placeholder="ค้นหา (number / ชื่อ / หมวด)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 360 }}
        />
        <span className="muted" style={{ marginLeft: 'var(--space-3)' }}>
          แสดง {filtered.length} / {items.length} รายการ
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {fetchResult && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <span className="badge badge--actual">เพิ่ม {fetchResult.inserted}</span>
          {fetchResult.updated > 0 && <span className="badge badge--budget">อัปเดต {fetchResult.updated}</span>}
          <span className="badge badge--adjust">พบทั้งหมด {fetchResult.fetched}</span>
        </div>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th className="nowrap">Number</th>
              <th>Display Name</th>
              <th>Item Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="muted">กำลังโหลด…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="muted">ยังไม่มีข้อมูล — กด “ดึงจาก D365BC”</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="muted">ไม่พบรายการที่ค้นหา</td></tr>
            ) : (
              filtered.map((i) => (
                <tr key={i.itemId}>
                  <td className="nowrap">{i.number}</td>
                  <td>{i.displayName || '—'}</td>
                  <td>{i.itemCategoryCode ?? '—'}</td>
                  <td className="num">
                    {isManager && (
                      <button className="btn btn--sm btn--danger" onClick={() => remove(i)}>ลบ</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
