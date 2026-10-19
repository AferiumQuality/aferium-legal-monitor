/* Liga o monitor no pacote do site já extraído (pasta hosting): node ligar-no-site.mjs <pasta-hosting> <usuario/repositorio> */
import fs from 'node:fs';
import path from 'node:path';
const [hostingDir, repo] = process.argv.slice(2);
if (!hostingDir || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[a-z0-9][a-z0-9-]{2,80}$/.test(repo || '')) { console.error('Uso: node ligar-no-site.mjs <pasta-hosting> <usuario/repositorio>'); process.exit(2); }
const rcPath = path.join(hostingDir, 'public', 'legal', 'remote-config.json');
const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
rc.enabled = true; rc.repository = repo; rc.baseUrl = `https://raw.githubusercontent.com/${repo}/main/public/legal`;
fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n');
const fbPath = path.join(hostingDir, 'firebase.json');
const fb = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
let done = false;
for (const rule of fb.hosting.headers || []) for (const h of rule.headers || []) if (/^content-security-policy$/i.test(h.key)) {
  h.value = h.value.split(';').map(x => x.trim()).filter(Boolean).map(part => part.startsWith('connect-src ') && !part.includes('https://raw.githubusercontent.com') ? part + ' https://raw.githubusercontent.com' : part).join('; ') + ';';
  done = true;
}
if (!done) { console.error('Política de segurança (CSP) não encontrada em firebase.json.'); process.exit(3); }
fs.writeFileSync(fbPath, JSON.stringify(fb, null, 2) + '\n');
console.log('Monitor ligado no pacote: ' + repo);
