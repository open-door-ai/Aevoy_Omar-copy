// Check DNS from multiple resolvers
const checks = [
  { name: 'Cloudflare DoH', url: 'https://cloudflare-dns.com/dns-query' },
  { name: 'Google DoH', url: 'https://dns.google/resolve' },
];

for (const doh of checks) {
  console.log(`\n=== ${doh.name} ===`);

  // DKIM
  const dkimRes = await fetch(`${doh.url}?name=resend._domainkey.aevoy.com&type=TXT`, {
    headers: { 'Accept': 'application/dns-json' }
  });
  const dkimData = await dkimRes.json();
  console.log(`resend._domainkey.aevoy.com TXT: Status=${dkimData.Status}`);
  for (const a of dkimData.Answer || []) console.log(`  "${a.data.substring(0,60)}..."`);
  if (!dkimData.Answer?.length) console.log('  (no answer)');

  // SPF MX
  const mxRes = await fetch(`${doh.url}?name=send.aevoy.com&type=MX`, {
    headers: { 'Accept': 'application/dns-json' }
  });
  const mxData = await mxRes.json();
  console.log(`send.aevoy.com MX: Status=${mxData.Status}`);
  for (const a of mxData.Answer || []) console.log(`  ${a.data}`);
  if (!mxData.Answer?.length) console.log('  (no answer)');

  // SPF TXT
  const spfRes = await fetch(`${doh.url}?name=send.aevoy.com&type=TXT`, {
    headers: { 'Accept': 'application/dns-json' }
  });
  const spfData = await spfRes.json();
  console.log(`send.aevoy.com TXT: Status=${spfData.Status}`);
  for (const a of spfData.Answer || []) console.log(`  ${a.data}`);
  if (!spfData.Answer?.length) console.log('  (no answer)');
}
