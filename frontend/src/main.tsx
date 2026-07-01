import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Sarabun font (Thai support)
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/500.css';
import '@fontsource/sarabun/700.css';
import './styles/global.scss';
import App from './App.tsx';
import { AuthProvider } from './auth/AuthContext';
import { ensureMsalInit, msalInstance } from './auth/msal';

const TOKEN_KEY = 'qtm.token';
const SESSION_KEY = 'qtm.session';
export const MS_LOGIN_ERROR_KEY = 'qtm.msLoginError';

// Complete a Microsoft redirect BEFORE React renders — otherwise the router would strip the
// auth code from the URL first. On a fresh load handleRedirectPromise returns null (no-op).
async function completeMsRedirect() {
  await ensureMsalInit();
  const resp = await msalInstance.handleRedirectPromise();
  if (!resp?.idToken) return;
  const r = await fetch('/api/v1/auth/ms-login', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resp.idToken}` },
  });
  if (r.ok) {
    const auth = await r.json();
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email: auth.email, displayName: auth.displayName, roles: auth.roles,
    }));
  } else {
    let msg = 'เข้าสู่ระบบด้วย Microsoft ไม่สำเร็จ';
    try { msg = (await r.json())?.message ?? msg; } catch { /* keep default */ }
    sessionStorage.setItem(MS_LOGIN_ERROR_KEY, msg);
  }
}

completeMsRedirect()
  .catch((e) => sessionStorage.setItem(MS_LOGIN_ERROR_KEY, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>,
    );
  });
