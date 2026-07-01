import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

// Entra ID (Azure AD) config. Values come from build-time env; placeholders let the app
// build/run before Entra is configured (password login still works). Set these per environment:
//   VITE_AAD_CLIENT_ID, VITE_AAD_TENANT_ID
const clientId = import.meta.env.VITE_AAD_CLIENT_ID ?? '00000000-0000-0000-0000-000000000000';
const tenantId = import.meta.env.VITE_AAD_TENANT_ID ?? 'common';

const config: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    // Redirect flow lands back on the app origin (register this exact origin in Entra as a
    // Single-page application redirect URI). We use redirect (not popup) because Edge's
    // work-profile popup switching detaches the popup from the opener and breaks popup login.
    redirectUri: window.location.origin,
  },
  cache: { cacheLocation: 'localStorage' },
};

export const msalInstance = new PublicClientApplication(config);
export const loginRequest = { scopes: ['openid', 'profile', 'email'] };

// MSAL v3 requires initialize() before any interaction.
let initPromise: Promise<void> | null = null;
export function ensureMsalInit(): Promise<void> {
  initPromise ??= msalInstance.initialize();
  return initPromise;
}
