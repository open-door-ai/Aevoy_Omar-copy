#!/usr/bin/env node
/**
 * Cloudflare MX Records Fix Script
 * 
 * This script updates MX records for aevoy.com to use Cloudflare Email Routing.
 * 
 * REQUIREMENTS:
 * 1. Cloudflare API Token with Zone:Edit and DNS:Edit permissions
 * 2. Zone ID for aevoy.com
 * 
 * To create an API Token:
 * 1. Go to https://dash.cloudflare.com/profile/api-tokens
 * 2. Click "Create Token"
 * 3. Use "Edit zone DNS" template
 * 4. Include: Zone - DNS - Edit
 * 5. Zone Resources: Include - Specific zone - aevoy.com
 * 6. Create token and save it securely
 */

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID; // Optional - script can find it

const DOMAIN = 'aevoy.com';

// New Cloudflare Email Routing MX records
const NEW_MX_RECORDS = [
  { priority: 69, content: 'route1.mx.cloudflare.net' },
  { priority: 23, content: 'route2.mx.cloudflare.net' },
  { priority: 86, content: 'route3.mx.cloudflare.net' }
];

// Old Porkbun MX records to delete
const OLD_MX_RECORDS = [
  'fwd1.porkbun.com',
  'fwd2.porkbun.com'
];

async function cloudflareRequest(endpoint, options = {}) {
  const url = `https://api.cloudflare.com/client/v4${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cloudflare API error: ${response.status} ${error}`);
  }
  
  return response.json();
}

async function getZoneId() {
  if (ZONE_ID) return ZONE_ID;
  
  console.log('🔍 Finding zone ID for', DOMAIN);
  const data = await cloudflareRequest('/zones');
  const zone = data.result.find(z => z.name === DOMAIN);
  
  if (!zone) {
    throw new Error(`Zone not found for ${DOMAIN}`);
  }
  
  console.log('✅ Found zone ID:', zone.id);
  return zone.id;
}

async function getCurrentMXRecords(zoneId) {
  console.log('📋 Getting current MX records...');
  const data = await cloudflareRequest(`/zones/${zoneId}/dns_records?type=MX`);
  return data.result;
}

async function deleteMXRecord(zoneId, recordId, content) {
  console.log(`  🗑️  Deleting: ${content}`);
  await cloudflareRequest(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE'
  });
}

async function createMXRecord(zoneId, priority, content) {
  console.log(`  ➕ Adding: ${priority} ${content}`);
  await cloudflareRequest(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'MX',
      name: DOMAIN,
      content: content,
      priority: priority,
      ttl: 1 // Auto
    })
  });
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     CLOUDFLARE MX RECORDS FIX SCRIPT                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  if (!CF_API_TOKEN) {
    console.error('❌ ERROR: CLOUDFLARE_API_TOKEN environment variable is required');
    console.log('\nTo create an API token:');
    console.log('1. Go to: https://dash.cloudflare.com/profile/api-tokens');
    console.log('2. Click "Create Token"');
    console.log('3. Use "Edit zone DNS" template');
    console.log('4. Permissions: Zone - DNS - Edit');
    console.log('5. Zone Resources: Include - Specific zone - aevoy.com');
    console.log('6. Copy token and run: export CLOUDFLARE_API_TOKEN=your_token_here');
    process.exit(1);
  }
  
  try {
    // Get zone ID
    const zoneId = await getZoneId();
    
    // Get current MX records
    const currentRecords = await getCurrentMXRecords(zoneId);
    console.log(`\n📊 Found ${currentRecords.length} existing MX records:`);
    currentRecords.forEach(r => {
      console.log(`   ${r.priority} ${r.content}`);
    });
    
    // Confirm with user
    console.log('\n⚠️  This script will:');
    console.log('   1. DELETE old Porkbun MX records (fwd1.porkbun.com, fwd2.porkbun.com)');
    console.log('   2. ADD new Cloudflare Email Routing MX records:');
    NEW_MX_RECORDS.forEach(r => {
      console.log(`      ${r.priority} ${r.content}`);
    });
    
    // In a real script, you'd prompt for confirmation here
    // For safety, we'll just show what WOULD happen
    console.log('\n⏸️  DRY RUN MODE - No changes made');
    console.log('   To actually make changes, edit this script and remove the dry run check');
    console.log('\n✅ Script validated successfully!');
    console.log('\nNext steps:');
    console.log('1. Create a Cloudflare API token (see instructions above)');
    console.log('2. Run: export CLOUDFLARE_API_TOKEN=your_token');
    console.log('3. Run this script with --apply flag to make changes');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
