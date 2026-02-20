// Wait 60s then trigger verification one more time
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';
const headers = { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' };

console.log('Waiting 60s for DNS caches to fully settle...');
await new Promise(r => setTimeout(r, 60000));

console.log('Triggering verification...');
const vRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}/verify`, { method: 'POST', headers });
console.log('HTTP', vRes.status);

console.log('Waiting 20s...');
await new Promise(r => setTimeout(r, 20000));

const sRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, { headers });
const s = await sRes.json();
console.log('\nFinal status:', s.status);
for (const r of s.records || []) {
  console.log(`  [${r.status}] ${r.record} ${r.type} ${r.name}`);
}
