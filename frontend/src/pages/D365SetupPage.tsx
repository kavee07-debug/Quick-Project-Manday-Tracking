import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { D365Setting, D365SettingUpsert, D365TestResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import './ConfigPage.scss';

const blank: D365SettingUpsert = {
  tenantId: '',
  environmentId: '',
  companyId: '',
  clientId: '',
  clientSecret: '',
  apiPublisher: '',
  apiGroup: '',
  apiVersion: 'v1.0',
  projectManagerCodes: 'Q63-036,Q63-041',
};

export default function D365SetupPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');

  const [form, setForm] = useState<D365SettingUpsert>(blank);
  const [hasSecret, setHasSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<D365TestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    api
      .get<D365Setting>('/d365/settings')
      .then((s) => {
        setForm({
          tenantId: s.tenantId,
          environmentId: s.environmentId,
          companyId: s.companyId,
          clientId: s.clientId,
          clientSecret: '', // never returned; leave blank to keep existing
          apiPublisher: s.apiPublisher,
          apiGroup: s.apiGroup,
          apiVersion: s.apiVersion || 'v1.0',
          projectManagerCodes: s.projectManagerCodes,
        });
        setHasSecret(s.hasClientSecret);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลดค่าไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  function update<K extends keyof D365SettingUpsert>(key: K, value: D365SettingUpsert[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setTest(null);
    setSaved(false);
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      setTest(await api.post<D365TestResult>('/d365/settings/test', form));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ทดสอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await api.put<D365Setting>('/d365/settings', form);
      setHasSecret(s.hasClientSecret);
      setForm((f) => ({ ...f, clientSecret: '' }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <p className="error-text">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</p>;
  if (loading) return <p className="muted">กำลังโหลด…</p>;

  return (
    <div className="config">
      <h1 className="config__title">ตั้งค่าเชื่อมต่อ D365BC (API)</h1>
      <p className="muted config__hint">
        ค่าเชื่อมต่อ Business Central สำหรับดึงข้อมูล Project (เมนู <code>API Job</code>).
        Client Secret จะไม่ถูกส่งกลับมาแสดง — เว้นว่างไว้เพื่อใช้ค่าเดิม.
      </p>

      <form className="config__card card" onSubmit={save}>
        <label className="field-label">Tenant ID</label>
        <input className="input" value={form.tenantId} autoComplete="off"
          onChange={(e) => update('tenantId', e.target.value)} required />

        <label className="field-label">Environment ID</label>
        <input className="input" value={form.environmentId} placeholder="เช่น QuickDEV"
          onChange={(e) => update('environmentId', e.target.value)} required />

        <label className="field-label">Company ID</label>
        <input className="input" value={form.companyId} placeholder="GUID ของบริษัทใน BC"
          onChange={(e) => update('companyId', e.target.value)} required />

        <label className="field-label">Client ID</label>
        <input className="input" value={form.clientId} autoComplete="off"
          onChange={(e) => update('clientId', e.target.value)} required />

        <label className="field-label">
          Client Secret {hasSecret && <span className="muted">(มีค่าเดิมอยู่ — เว้นว่างเพื่อใช้ค่าเดิม)</span>}
        </label>
        <input className="input" type="password" value={form.clientSecret ?? ''} autoComplete="new-password"
          placeholder={hasSecret ? '••••••••' : ''}
          onChange={(e) => update('clientSecret', e.target.value)} />

        <label className="field-label">API Publisher</label>
        <input className="input" value={form.apiPublisher} placeholder="เช่น QERP_publisher"
          onChange={(e) => update('apiPublisher', e.target.value)} required />

        <label className="field-label">API Group</label>
        <input className="input" value={form.apiGroup} placeholder="เช่น QERP_apiGroup"
          onChange={(e) => update('apiGroup', e.target.value)} required />

        <label className="field-label">API Version</label>
        <input className="input" value={form.apiVersion} placeholder="เช่น v1.0"
          onChange={(e) => update('apiVersion', e.target.value)} required />

        <label className="field-label">Project Manager Codes (คั่นด้วย ,)</label>
        <input className="input" value={form.projectManagerCodes} placeholder="Q63-036,Q63-041"
          onChange={(e) => update('projectManagerCodes', e.target.value)} required />

        {error && <p className="error-text">{error}</p>}
        {test && (
          <p className={test.success ? 'config__ok' : 'error-text'}>
            {test.success ? '✓ ' : '✗ '}{test.message}
          </p>
        )}
        {saved && <p className="config__ok">✓ บันทึกแล้ว</p>}

        <div className="form-actions">
          <button type="button" className="btn" onClick={runTest} disabled={busy}>
            ทดสอบการเชื่อมต่อ
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            บันทึก
          </button>
        </div>
      </form>
    </div>
  );
}
