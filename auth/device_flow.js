#!/usr/bin/env node
// MSAL device-code OAuth flow helper for Microsoft/Xbox Live -> Minecraft tokens
// Uses @azure/msal-node for a robust device-code flow and falls back to legacy endpoints only if MSAL fails.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { PublicClientApplication } = require('@azure/msal-node');

const AUTH_PATH = path.resolve(__dirname, '..', 'auth.json');

// Defaults (official Microsoft OAuth app for Xbox uses known client id)
const CLIENT_ID = '00000000402b5328';
const SCOPES = ['openid', 'offline_access', 'XboxLive.signin'];

const msalConfig = { auth: { clientId: CLIENT_ID, authority: 'https://login.microsoftonline.com/common' } };
const pca = new PublicClientApplication(msalConfig);

async function msalDeviceFlow() {
  const deviceCodeRequest = {
    deviceCodeCallback: (response) => {
      // MSAL prints a friendly message including the URL and the code
      console.log(response.message);
    },
    scopes: SCOPES
  };
  try {
    const tokenResponse = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    if (!tokenResponse || !tokenResponse.accessToken) throw new Error('MSAL device flow did not return an access token');
    return { access_token: tokenResponse.accessToken, refresh_token: tokenResponse.refreshToken };
  } catch (err) {
    // Surface MSAL errors and let caller decide to fallback
    throw new Error('MSAL device flow failed: ' + (err.message || err));
  }
}

// Fallback: keep previous tenant-based raw device-polling implementation (preserves behavior for tricky accounts)
const DEVICE_CODE_URL_TEMPLATE = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/devicecode';
const TOKEN_URL_TEMPLATE = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token';
const LIVE_DEVICE_CODE_URL = 'https://login.live.com/oauth20_device.srf';
const LIVE_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const TENANTS_TO_TRY = ['consumers', 'organizations', 'common'];

async function requestDeviceCodeFallback() {
  // Try tenant-specific endpoints in order to avoid tenant-identifying errors
  for (const tenant of TENANTS_TO_TRY) {
    const url = DEVICE_CODE_URL_TEMPLATE.replace('{tenant}', tenant);
    const params = new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES.join(' ') });
    try {
      const res = await fetch(url, { method: 'POST', body: params });
      const text = await res.text();
      if (res.ok) {
        try { return JSON.parse(text); } catch (e) { throw new Error('Invalid device code response: ' + text); }
      } else {
        console.warn(`Device code request failed (${tenant}):`, res.status, text);
      }
    } catch (e) {
      console.warn(`Failed device code request for tenant ${tenant}:`, e.message || e);
    }
  }

  // As a last resort try the legacy login.live.com device endpoint (some consumer accounts)
  console.log('Falling back to login.live.com device endpoint');
  const params2 = new URLSearchParams({ client_id: CLIENT_ID, scope: 'XboxLive.signin offline_access' });
  let res2 = await fetch(LIVE_DEVICE_CODE_URL, { method: 'POST', body: params2 });
  let text2 = await res2.text();
  if (!res2.ok) throw new Error('Device code request failed (live): ' + res2.status + ' ' + text2);
  try { return JSON.parse(text2); } catch (e) { throw new Error('Invalid device code response (live): ' + text2); }
}

async function pollForTokenFallback(deviceCode, interval, expiresIn) {
  const params = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode });
  const start = Date.now();
  while ((Date.now() - start) / 1000 < expiresIn) {
    await new Promise(r => setTimeout(r, interval * 1000));
    let res = await fetch(TOKEN_URL_TEMPLATE.replace('{tenant}', 'common'), { method: 'POST', body: params });
    let text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid token response: ' + text); }
    if (data.access_token) return data;
    if (data.error === 'authorization_pending') { continue; }
    if (data.error === 'authorization_declined') throw new Error('Authorization declined');
    if (data.error === 'bad_verification_code') throw new Error('Bad verification code');
    if (data.error === 'expired_token') throw new Error('Device code expired');
    console.warn('Token endpoint returned error (v2):', data.error, data.error_description || '');

    // Try legacy live endpoint
    const params2 = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode });
    res = await fetch(LIVE_TOKEN_URL, { method: 'POST', body: params2 });
    text = await res.text();
    try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid token response (live): ' + text); }
    if (data.access_token) return data;
    if (data.error === 'authorization_pending') { continue; }
    if (data.error) throw new Error('Live token endpoint error: ' + data.error + ' ' + (data.error_description || ''));
  }
  throw new Error('Polling timed out waiting for device code');
}

// Xbox Live and Minecraft exchange functions (unchanged)
async function xboxAuth(accessToken) {
  const payload = {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${accessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  };
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Xbox user auth failed: ' + res.status);
  const data = await res.json();
  const userToken = data.Token;

  const payload2 = {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  };
  const res2 = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload2)
  });
  if (!res2.ok) throw new Error('XSTS auth failed: ' + res2.status);
  const data2 = await res2.json();
  const xstsToken = data2.Token;
  const userHash = data2.DisplayClaims && data2.DisplayClaims.xui && data2.DisplayClaims.xui[0] && data2.DisplayClaims.xui[0].uh; // may be undefined
  return { userToken, xstsToken, userHash };
}

async function minecraftLogin(xboxInfo) {
  const { xstsToken, userHash } = xboxInfo;
  const res = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` })
  });
  if (!res.ok) throw new Error('Minecraft login failed: ' + res.status);
  const data = await res.json();
  const mcAccessToken = data.access_token;

  // Get profile
  const res2 = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    method: 'GET', headers: { Authorization: `Bearer ${mcAccessToken}` }
  });
  if (!res2.ok) throw new Error('Minecraft profile fetch failed: ' + res2.status);
  const profile = await res2.json();
  return { mcAccessToken, profile };
}

async function runInteractive() {
  console.log('Starting device-code flow (MSAL) — you will see a URL and code printed to follow in your browser.');
  try {
    const tokenResp = await msalDeviceFlow();
    console.log('Successfully completed MSAL device flow. Proceeding to Xbox/Minecraft exchange...');
    const xboxInfo = await xboxAuth(tokenResp.access_token);
    const mc = await minecraftLogin(xboxInfo);

    const out = { method: 'microsoft', accessToken: tokenResp.access_token, refreshToken: tokenResp.refresh_token, mcAccessToken: mc.mcAccessToken, profile: mc.profile };
    fs.writeFileSync(AUTH_PATH, JSON.stringify(out, null, 2));
    console.log('Saved authentication to', AUTH_PATH);
    console.log('Profile:', mc.profile);
    return;
  } catch (msalErr) {
    console.warn('MSAL device flow failed:', msalErr.message || msalErr);
    console.log('Falling back to raw device code polling mechanism (legacy endpoints).');
  }

  // Fallback path
  console.log('Requesting device code (fallback)...');
  const codeResp = await requestDeviceCodeFallback();
  console.log('\nOpen this URL in a browser:');
  console.log(codeResp.verification_uri || codeResp.verification_uri_complete || codeResp.verification_url);
  console.log('Enter code: ' + codeResp.user_code);
  console.log(`You have ${codeResp.expires_in} seconds to complete this.`);

  console.log('Waiting for you to authorize... (polling)');
  const tokenResp = await pollForTokenFallback(codeResp.device_code, codeResp.interval, codeResp.expires_in);
  console.log('Got Microsoft access token. Proceeding to Xbox/Minecraft exchange...');

  const xboxInfo2 = await xboxAuth(tokenResp.access_token);
  const mc2 = await minecraftLogin(xboxInfo2);

  const out2 = { method: 'microsoft', accessToken: tokenResp.access_token, refreshToken: tokenResp.refresh_token, mcAccessToken: mc2.mcAccessToken, profile: mc2.profile };
  fs.writeFileSync(AUTH_PATH, JSON.stringify(out2, null, 2));
  console.log('Saved authentication to', AUTH_PATH);
  console.log('Profile:', mc2.profile);
}

if (require.main === module) {
  runInteractive().catch(err => { console.error('Error during device flow:', err.message || err); process.exit(1); });
}

module.exports = { runInteractive };
