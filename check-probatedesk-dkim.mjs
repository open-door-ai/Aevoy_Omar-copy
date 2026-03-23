// Check probatedesk.com's DKIM record for comparison
const RESEND_KEY = 're_ckf3djVk'; // partial - let's use the Resend API listing instead

// Use the Resend API with the omarkebrahim account key for probatedesk
// We need to use the pro desk production key from the .env
const API_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s'; // Aurora key

// Check probatedesk DKIM from public DNS
const dkimRes = await fetch(
  'https://cloudflare-dns.com/dns-query?name=resend._domainkey.probatedesk.com&type=TXT',
  { headers: { 'Accept': 'application/dns-json' } }
);
const dkimData = await dkimRes.json();
console.log('probatedesk.com resend._domainkey TXT status:', dkimData.Status);
for (const a of dkimData.Answer || []) {
  console.log('  Raw data:', a.data);
}
if (!dkimData.Answer?.length) {
  console.log('  (no record found - NXDOMAIN or empty)');
}

// Compare with what we set for aevoy.com
const aevoyRes = await fetch(
  'https://cloudflare-dns.com/dns-query?name=resend._domainkey.aevoy.com&type=TXT',
  { headers: { 'Accept': 'application/dns-json' } }
);
const aevoyData = await aevoyRes.json();
console.log('\naevoy.com resend._domainkey TXT status:', aevoyData.Status);
for (const a of aevoyData.Answer || []) {
  console.log('  Raw data:', a.data);
}
