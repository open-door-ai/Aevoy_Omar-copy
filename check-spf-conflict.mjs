// Check for SPF conflicts on aevoy.com
const CF_ZONE = 'c37d92651244e2af55843b02db936a2b';
const CF_EMAIL = 'omarkebrahim@gmail.com';
const CF_KEY = '2b354dbac0598353fe1e1b19d7300583c4443';
const headers = { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY };

const res = await fetch(
  `https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records?per_page=100`,
  { headers }
);
const data = await res.json();

console.log('All TXT and MX records for aevoy.com zone:');
for (const r of data.result) {
  if (['TXT', 'MX'].includes(r.type)) {
    console.log(`  ${r.type.padEnd(5)} | ${r.name.padEnd(50)} | ${r.content}`);
  }
}

// Also check what the root aevoy.com TXT record says (SPF conflict)
console.log('\nChecking root aevoy.com TXT (SPF):');
const rootSpf = await fetch(
  'https://cloudflare-dns.com/dns-query?name=aevoy.com&type=TXT',
  { headers: { 'Accept': 'application/dns-json' } }
);
const rootSpfData = await rootSpf.json();
for (const a of rootSpfData.Answer || []) console.log('  ', a.data);
