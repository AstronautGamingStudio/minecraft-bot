#!/usr/bin/env node
// Simple smoke tester to ensure @azure/msal-node can be required and a PublicClientApplication can be constructed.
try {
  const { PublicClientApplication } = require('@azure/msal-node');
  const CLIENT_ID = '00000000402b5328';
  const pca = new PublicClientApplication({ auth: { clientId: CLIENT_ID, authority: 'https://login.microsoftonline.com/common' } });
  console.log('MSAL loaded successfully. PCA created.');
  process.exit(0);
} catch (err) {
  console.error('MSAL smoke test failed:', err.message || err);
  process.exit(2);
}