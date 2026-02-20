// Final verification check
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';
const CF_ZONE = 'c37d92651244e2af55843b02db936a2b';
const CF_EMAIL = 'omarkebrahim@gmail.com';
const CF_KEY = '2b354dbac0598353fe1e1b19d7300583c4443';

// --- Resend ---
const resendRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, {
  headers: { 'Authorization': `Bearer ${RESEND_KEY}` },
});
const resend = await resendRes.json();
console.log('=== RESEND DOMAIN STATUS ===');
console.log(`Domain:       ${resend.name}`);
console.log(`Status:       ${resend.status}`);
console.log(`Sending:      ${resend.capabilities?.sending}`);
console.log(`Region:       ${resend.region}`);
console.log('DNS Records:');
for (const r of resend.records || []) {
  const icon = r.status === 'verified' ? 'VERIFIED' : 'PENDING';
  console.log(`  [${icon}] ${r.type} ${r.name} -> ${r.value.slice(0, 60)}...`);
}

// --- Cloudflare ---
const cfRes = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records?per_page=100`,
  { headers: { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY } }
);
const cf = await cfRes.json();
const resendRecords = cf.result.filter(r =>
  r.name.includes('resend._domainkey') || r.name.startsWith('send.')
);
console.log('\n=== CLOUDFLARE DNS RECORDS (Resend) ===');
for (const r of resendRecords) {
  console.log(`  ${r.type.padEnd(5)} ${r.name.padEnd(45)} ${r.content.slice(0,70)}`);
}
