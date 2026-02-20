// Compare what DNS returns vs what Resend expects
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';

// What Resend expects
const res = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, {
  headers: { 'Authorization': `Bearer ${RESEND_KEY}` }
});
const d = await res.json();
const dkimRecord = d.records.find(r => r.record === 'DKIM');
const resendExpected = dkimRecord.value;
console.log('RESEND EXPECTS:');
console.log(resendExpected);
console.log('Length:', resendExpected.length);

// What DNS actually returns
const dnsRes = await fetch(
  'https://cloudflare-dns.com/dns-query?name=resend._domainkey.aevoy.com&type=TXT',
  { headers: { 'Accept': 'application/dns-json' } }
);
const dnsData = await dnsRes.json();
console.log('\nDNS STATUS:', dnsData.Status, '(0=NOERROR, 3=NXDOMAIN)');

for (const a of dnsData.Answer || []) {
  // Strip surrounding quotes from TXT record
  const raw = a.data.replace(/^"|"$/g, '').replace(/"\s*"/g, '');
  console.log('\nDNS RETURNS:');
  console.log(raw);
  console.log('Length:', raw.length);
  console.log('\nMATCH:', raw === resendExpected ? 'YES' : 'NO');
  if (raw !== resendExpected) {
    // Find differences
    for (let i = 0; i < Math.max(raw.length, resendExpected.length); i++) {
      if (raw[i] !== resendExpected[i]) {
        console.log(`First diff at position ${i}: DNS='${raw[i]}' Expected='${resendExpected[i]}'`);
        console.log(`Context: ...${raw.substring(i-5, i+20)}...`);
        break;
      }
    }
  }
}

// Also check send.aevoy.com MX
const mxRes = await fetch(
  'https://cloudflare-dns.com/dns-query?name=send.aevoy.com&type=MX',
  { headers: { 'Accept': 'application/dns-json' } }
);
const mxData = await mxRes.json();
console.log('\nsend.aevoy.com MX status:', mxData.Status);
for (const a of mxData.Answer || []) console.log('  MX Answer:', a.data);

// Check send.aevoy.com TXT
const spfRes = await fetch(
  'https://cloudflare-dns.com/dns-query?name=send.aevoy.com&type=TXT',
  { headers: { 'Accept': 'application/dns-json' } }
);
const spfData = await spfRes.json();
console.log('\nsend.aevoy.com TXT status:', spfData.Status);
for (const a of spfData.Answer || []) console.log('  TXT Answer:', a.data);
