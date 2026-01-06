#!/usr/bin/env node
// Refresh Microsoft access tokens using refresh_token and update auth.json
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const AUTH_PATH = path.resolve(__dirname, '..', 'auth.json');
const CLIENT_ID = '00000000402b5328';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

async function refresh() {
  if (!fs.existsSync(AUTH_PATH)) throw new Error('auth.json not found');
  const saved = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  if (saved.method !== 'microsoft') throw new Error('auth.json not a microsoft method');
  if (!saved.refreshToken) throw new Error('No refreshToken in auth.json');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: saved.refreshToken
  });

  // Try the 'common' endpoint first for broader tenant support; fall back to 'consumers' or login.live.com if needed
  let data;
  try {
    let res = await fetch(TOKEN_URL, { method: 'POST', body: params });
    data = await res.json();
    if (!data.access_token) {
      // Try consumer endpoint next
      const res2 = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', body: params });
      data = await res2.json();
    }
    if (!data.access_token) {
      // Final fallback to legacy live endpoint (some consumer accounts)
      const res3 = await fetch('https://login.live.com/oauth20_token.srf', { method: 'POST', body: params });
      try { data = await res3.json(); } catch (e) { throw new Error('Refresh failed and all fallbacks failed: non-JSON response'); }
    }
  } catch (e) {
    throw new Error('Refresh request failed: ' + (e.message || e));
  }

  if (!data.access_token) throw new Error('Refresh failed: ' + JSON.stringify(data));
  // Keep refresh token if present
  saved.accessToken = data.access_token;
  if (data.refresh_token) saved.refreshToken = data.refresh_token;
  // After refreshing MS token, perform Xbox/Minecraft exchange (reuse device flow steps)
  const xbox = await xboxAuth(saved.accessToken);
  const mc = await minecraftLogin(xbox);
  saved.mcAccessToken = mc.mcAccessToken;
  saved.profile = mc.profile;
  fs.writeFileSync(AUTH_PATH, JSON.stringify(saved, null, 2));
  return saved;
}

// reuse helper functions from device_flow but don't duplicate require cycles
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
  const userHash = data2.DisplayClaims && data2.DisplayClaims.xui && data2.DisplayClaims.xui[0] && data2.DisplayClaims.xui[0].uh;
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
  const res2 = await fetch('https://api.minecraftservices.com/minecraft/profile', { method: 'GET', headers: { Authorization: `Bearer ${mcAccessToken}` } });
  if (!res2.ok) throw new Error('Minecraft profile fetch failed: ' + res2.status);
  const profile = await res2.json();
  return { mcAccessToken, profile };
}

// Simple CLI
if (require.main === module) {
  refresh().then(saved => {
    console.log('Refresh complete. Saved auth to auth.json. Profile:', saved.profile && saved.profile.name);
    process.exit(0);
  }).catch(err => { console.error('Refresh failed:', err.message || err); process.exit(2); });
}

module.exports = { refresh };