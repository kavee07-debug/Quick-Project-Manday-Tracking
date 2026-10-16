import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import './LoginPage.scss';

/**
 * The Microsoft four-square mark. Inline rather than an <img> so it inherits the button's size
 * and needs no network request; the hex values are Microsoft's brand colours, which are fixed
 * by their branding guidelines and so deliberately not design tokens.
 * Decorative — the button already says "Microsoft".
 */
function MicrosoftLogo() {
  return (
    <svg className="login__ms-logo" viewBox="0 0 23 23" aria-hidden="true" focusable="false">
      <rect x="1"  y="1"  width="10" height="10" fill="#F25022" />
      <rect x="12" y="1"  width="10" height="10" fill="#7FBA00" />
      <rect x="1"  y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, loginWithMicrosoft, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('Admin1@qtmtraining.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface a Microsoft-redirect error captured in main.tsx (e.g. 403 not provisioned).
  useEffect(() => {
    const msErr = sessionStorage.getItem('qtm.msLoginError');
    if (msErr) {
      setError(msErr);
      sessionStorage.removeItem('qtm.msLoginError');
    }
  }, []);

  // Already signed in → redirect declaratively (never call navigate() during render).
  if (session) {
    return <Navigate to="/projects" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function onMicrosoft() {
    setError(null);
    setBusy(true);
    try {
      await loginWithMicrosoft();
      navigate('/projects', { replace: true });
    } catch (err) {
      // Surface the real reason (MSAL AADSTS code / backend message) instead of a generic text.
      const detail = err instanceof Error ? err.message : String(err);
      setError(`เข้าสู่ระบบด้วย Microsoft ไม่สำเร็จ: ${detail}`);
      console.error('MS login failed:', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card card" onSubmit={onSubmit}>
        <h1 className="login__title">เข้าสู่ระบบ</h1>
        <p className="muted login__subtitle">Quick Project Manday Tracking</p>

        <button type="button" className="btn login__ms" onClick={onMicrosoft} disabled={busy}>
          <MicrosoftLogo />
          <span>เข้าสู่ระบบด้วย Microsoft</span>
        </button>
        <div className="login__divider"><span>หรือเข้าด้วยรหัสผ่าน (ผู้ดูแล)</span></div>

        <label className="field-label" htmlFor="email">อีเมล</label>
        <input
          id="email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="field-label" htmlFor="password">รหัสผ่าน</label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="error-text login__error">{error}</p>}

        <button className="btn btn--primary login__submit" type="submit" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
}
