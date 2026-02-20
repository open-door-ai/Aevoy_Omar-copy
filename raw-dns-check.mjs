// Check raw DNS answer data
const dkimRes = await fetch('https://cloudflare-dns.com/dns-query?name=resend._domainkey.aevoy.com&type=TXT', {
  headers: { 'Accept': 'application/dns-json' }
});
const dkimData = await dkimRes.json();
console.log('Cloudflare DoH full answer:');
console.log(JSON.stringify(dkimData.Answer, null, 2));

const dkimRes2 = await fetch('https://dns.google/resolve?name=resend._domainkey.aevoy.com&type=TXT', {
  headers: { 'Accept': 'application/dns-json' }
});
const dkimData2 = await dkimRes2.json();
console.log('\nGoogle DoH full answer:');
console.log(JSON.stringify(dkimData2.Answer, null, 2));
