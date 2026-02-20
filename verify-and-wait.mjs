// Trigger Resend re-verification and check result
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';

const headers = {
  'Authorization': `Bearer ${RESEND_KEY}`,
  'Content-Type': 'application/json',
};

// Check current nameservers first via DNS-over-HTTPS
const nsRes = await fetch('https://cloudflare-dns.com/dns-query?name=aevoy.com&type=NS', {
  headers: { 'Accept': 'application/dns-json' }
});
const nsData = await nsRes.json();
console.log('Nameservers for aevoy.com:');
for (const a of nsData.Answer || []) {
  console.log(' ', a.data);
}

// Check DKIM record directly
const dkimRes = await fetch('https://cloudflare-dns.com/dns-query?name=resend._domainkey.aevoy.com&type=TXT', {
  headers: { 'Accept': 'application/dns-json' }
});
const dkimData = await dkimRes.json();
console.log('\nresend._domainkey.aevoy.com TXT:');
console.log('  Status:', dkimData.Status, dkimData.Status === 0 ? '(NOERROR)' : dkimData.Status === 3 ? '(NXDOMAIN - not found yet)' : '');
for (const a of dkimData.Answer || []) {
  console.log('  Value:', a.data);
}

// Check SPF MX
const mxRes = await fetch('https://cloudflare-dns.com/dns-query?name=send.aevoy.com&type=MX', {
  headers: { 'Accept': 'application/dns-json' }
});
const mxData = await mxRes.json();
console.log('\nsend.aevoy.com MX:');
console.log('  Status:', mxData.Status, mxData.Status === 0 ? '(NOERROR)' : mxData.Status === 3 ? '(NXDOMAIN - not found yet)' : '');
for (const a of mxData.Answer || []) {
  console.log('  Value:', a.data);
}

// Check SPF TXT
const spfRes = await fetch('https://cloudflare-dns.com/dns-query?name=send.aevoy.com&type=TXT', {
  headers: { 'Accept': 'application/dns-json' }
});
const spfData = await spfRes.json();
console.log('\nsend.aevoy.com TXT:');
console.log('  Status:', spfData.Status, spfData.Status === 0 ? '(NOERROR)' : spfData.Status === 3 ? '(NXDOMAIN - not found yet)' : '');
for (const a of spfData.Answer || []) {
  console.log('  Value:', a.data);
}

// Trigger re-verification
console.log('\nTriggering re-verification...');
const verifyRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}/verify`, {
  method: 'POST', headers
});
console.log('Verify HTTP status:', verifyRes.status);
const verifyData = await verifyRes.json();
console.log('Response:', JSON.stringify(verifyData));

// Wait 5s and check status
console.log('\nWaiting 5s for Resend to re-check...');
await new Promise(r => setTimeout(r, 5000));

const statusRes = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, { headers });
const status = await statusRes.json();
console.log('\nFinal Resend status:', status.status);
for (const r of status.records || []) {
  console.log(`  [${r.status}] ${r.type} ${r.name}`);
}
