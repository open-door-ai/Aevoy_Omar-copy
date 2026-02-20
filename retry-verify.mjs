// Retry verification with polling
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';
const headers = {
  'Authorization': `Bearer ${RESEND_KEY}`,
  'Content-Type': 'application/json',
};

const wait = ms => new Promise(r => setTimeout(r, ms));

for (let attempt = 1; attempt <= 4; attempt++) {
  console.log(`\n--- Attempt ${attempt} ---`);

  // Trigger verify
  const vRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}/verify`, { method: 'POST', headers });
  console.log('Verify triggered, HTTP', vRes.status);

  // Wait for Resend to process
  console.log('Waiting 15s...');
  await wait(15000);

  // Check status
  const sRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, { headers });
  const s = await sRes.json();
  console.log('Status:', s.status);
  for (const r of s.records || []) {
    console.log(`  [${r.status}] ${r.type} ${r.name}`);
  }

  if (s.status === 'verified') {
    console.log('\nSUCCESS: Domain is fully verified!');
    break;
  }

  if (attempt < 4) {
    console.log('Not verified yet, waiting 30s before next attempt...');
    await wait(30000);
  }
}
