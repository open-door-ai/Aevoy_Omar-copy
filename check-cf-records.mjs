// Check Cloudflare record details including proxy status
const CF_ZONE = 'c37d92651244e2af55843b02db936a2b';
const CF_EMAIL = 'omarkebrahim@gmail.com';
const CF_KEY = '2b354dbac0598353fe1e1b19d7300583c4443';
const headers = { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY, 'Content-Type': 'application/json' };

const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records?per_page=100`, { headers });
const data = await res.json();

const resendRecords = data.result.filter(r =>
  r.name.includes('resend._domainkey') || r.name.startsWith('send.')
);

console.log('Resend-related Cloudflare DNS records:');
for (const r of resendRecords) {
  console.log(`\n  ID:       ${r.id}`);
  console.log(`  Type:     ${r.type}`);
  console.log(`  Name:     ${r.name}`);
  console.log(`  Content:  ${r.content}`);
  console.log(`  Proxied:  ${r.proxied}`);
  console.log(`  Priority: ${r.priority ?? 'N/A'}`);
  console.log(`  TTL:      ${r.ttl}`);
}
