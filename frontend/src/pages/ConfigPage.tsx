import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { DbConfig, DbConfigUpsert, DbTestResult } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import './ConfigPage.scss';

const blank: DbConfigUpsert = {
  server: '',
  database: 'QtmManday',
  integratedSecurity: false,
  username: '',
  password: '',
  trustServerCertificate: true,
  encrypt: false,
};

export default function ConfigPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('Admin');

  const [form, setForm] = useState<DbConfigUpsert>(blank);
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<DbTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    api
      .get<DbConfig>('/config/db')
      .then((c) => {
        setForm({
          server: c.server,
          database: c.database,
          integratedSecurity: c.integratedSecurity,
          username: c.username ?? '',
          password: '', // never returned; leave blank to keep existing
          trustServerCertificate: c.trustServerCertificate,
          encrypt: c.encrypt,
        });
        setHasPassword(c.hasPassword);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'โหลด config ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  function update<K extends keyof DbConfigUpsert>(key: K, value: DbConfigUpsert[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setTest(null);
    setSaved(false);
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    setError(null);
    try {
      setTest(await api.post<DbTestResult>('/config/db/test', form));
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
      const c = await api.put<DbConfig>('/config/db', form);
      setHasPassword(c.hasPassword);
      setForm((f) => ({ ...f, password: '' }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <p className="error-text">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น</p>;
  if (loading) return <p className="muted">กำลังโหลด…</p>;

  const sqlAuth = !form.integratedSecurity;

  return (
    <div className="config">
      <h1 className="config__title">ตั้งค่าฐานข้อมูล (Config)</h1>
      <p className="muted config__hint">
        ตั้งค่า connection ของ SQL Server. การบันทึกจะมีผลกับการเชื่อมต่อครั้งถัดไปทันที
        (ไม่ต้องรีสตาร์ท). หลังเปลี่ยนไป server ใหม่ อย่าลืมรัน <code>db/schema.sql</code> บนเซิร์ฟเวอร์นั้นก่อน.
      </p>

      <form className="config__card card" onSubmit={save}>
        <label className="field-label">Server</label>
        <input className="input" value={form.server} placeholder="เช่น localhost\SQLEXPRESS หรือ 10.0.0.5,1433"
          onChange={(e) => update('server', e.target.value)} required />

        <label className="field-label">Database</label>
        <input className="input" value={form.database}
          onChange={(e) => update('database', e.target.value)} required />

        <label className="field-label">การยืนยันตัวตน (Authentication)</label>
        <select className="input" value={form.integratedSecurity ? 'win' : 'sql'}
          onChange={(e) => update('integratedSecurity', e.target.value === 'win')}>
          <option value="sql">SQL Server login (user/password)</option>
          <option value="win">Windows (Trusted Connection)</option>
        </select>

        {sqlAuth && (
          <>
            <label className="field-label">Username</label>
            <input className="input" value={form.username ?? ''} autoComplete="off"
              onChange={(e) => update('username', e.target.value)} />

            <label className="field-label">
              Password {hasPassword && <span className="muted">(มีรหัสผ่านเดิมอยู่ — เว้นว่างเพื่อใช้ค่าเดิม)</span>}
            </label>
            <input className="input" type="password" value={form.password ?? ''} autoComplete="new-password"
              placeholder={hasPassword ? '••••••••' : ''}
              onChange={(e) => update('password', e.target.value)} />
          </>
        )}

        <label className="config__check">
          <input type="checkbox" checked={form.trustServerCertificate}
            onChange={(e) => update('trustServerCertificate', e.target.checked)} />
          Trust Server Certificate
        </label>
        <label className="config__check">
          <input type="checkbox" checked={form.encrypt}
            onChange={(e) => update('encrypt', e.target.checked)} />
          Encrypt
        </label>

        {error && <p className="error-text">{error}</p>}
        {test && (
          <p className={test.success ? 'config__ok' : 'error-text'}>
            {test.success ? '✓ ' : '✗ '}{test.message}
          </p>
        )}
        {saved && <p className="config__ok">✓ บันทึกแล้ว — การเชื่อมต่อครั้งถัดไปจะใช้ค่านี้</p>}

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
