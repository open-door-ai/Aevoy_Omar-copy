// Debug: Check exactly what Resend expects vs what we have
const RESEND_KEY = 're_VtsbyLPy_DQCd8jCBuoLaCMNmRVF3Mt3s';
const DOMAIN_ID = 'da7274bb-d6d1-4120-b518-5078d4c5aca8';

// Get what Resend expects
const res = await fetch(`https://api.resend.com/domains/${DOMAIN_ID}`, {
  headers: { 'Authorization': `Bearer ${RESEND_KEY}` }
});
const d = await res.json();

console.log('Full domain response:');
console.log(JSON.stringify(d, null, 2));
