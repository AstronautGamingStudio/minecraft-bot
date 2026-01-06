const fs = require('fs');
const path = require('path');
const readline = require('readline');

const AUTH_PATH = path.resolve(__dirname, '..', 'auth.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function question(q) {
  return new Promise(resolve => rl.question(q, ans => resolve(ans.trim())));
}

(async () => {
  console.log('Token/credential saver for mineflayer bot');
  console.log('Choose method: 1) microsoft (preferred for online servers) 2) mojang (legacy)');
  const method = await question('Method (microsoft/mojang): ');
  if (method !== 'microsoft' && method !== 'mojang') {
    console.error('Unsupported method'); rl.close(); process.exit(1);
  }

  const out = { method };
  if (method === 'microsoft') {
    console.log('\nYou will need to obtain an access token and optionally refresh token using a Microsoft/Xbox Live OAuth helper.');
    console.log('If you have an access token, paste it when prompted. If not, exit and I can guide you to obtain one.');
    out.accessToken = await question('Access token: ');
    out.refreshToken = await question('Refresh token (optional): ');
    out.username = await question('Minecraft username / profile name (optional): ');
    out.uuid = await question('Minecraft UUID (optional): ');
  } else {
    out.username = await question('Account email/username: ');
    out.password = await question('Account password (will be stored in plain text): ');
  }

  fs.writeFileSync(AUTH_PATH, JSON.stringify(out, null, 2));
  console.log('Saved auth to', AUTH_PATH);
  console.log('Keep this file private. If you used Microsoft tokens, you can later refresh them with external tools and update the file.');
  rl.close();
})();
