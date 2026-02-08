#!/usr/bin/env node
/**
 * DNS Status Checker for aevoy.com
 * 
 * This script checks the current DNS configuration for aevoy.com
 * and reports what needs to be fixed for email routing to work.
 */

import { execSync } from 'child_process';

interface DNSRecord {
  type: string;
  value: string;
  priority?: number;
}

interface DNSCheckResult {
  domain: string;
  nameservers: string[];
  mxRecords: DNSRecord[];
  txtRecords: DNSRecord[];
  aRecords: DNSRecord[];
  issues: string[];
  recommendations: string[];
}

const TARGET_MX_RECORDS = [
  { priority: 69, value: 'route1.mx.cloudflare.net' },
  { priority: 23, value: 'route2.mx.cloudflare.net' },
  { priority: 86, value: 'route3.mx.cloudflare.net' },
];

function runDig(domain: string, type: string): string {
  try {
    return execSync(`dig +short ${type} ${domain}`, { encoding: 'utf-8', timeout: 10000 });
  } catch (error) {
    return '';
  }
}

function runDigNS(domain: string): string {
  try {
    return execSync(`dig +short NS ${domain}`, { encoding: 'utf-8', timeout: 10000 });
  } catch (error) {
    return '';
  }
}

function parseMXRecords(output: string): DNSRecord[] {
  const records: DNSRecord[] = [];
  const lines = output.trim().split('\n').filter(line => line.length > 0);
  
  for (const line of lines) {
    // MX format: "10 mail.example.com." or just "mail.example.com."
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      records.push({
        type: 'MX',
        priority: parseInt(match[1], 10),
        value: match[2].replace(/\.$/, ''), // Remove trailing dot
      });
    } else if (line.includes('.')) {
      records.push({
        type: 'MX',
        value: line.replace(/\.$/, ''),
      });
    }
  }
  
  return records;
}

function parseNSRecords(output: string): string[] {
  return output
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => line.replace(/\.$/, ''));
}

function checkDNS(domain: string): DNSCheckResult {
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  console.log(`🔍 Checking DNS status for ${domain}...\n`);
  
  // Check nameservers
  const nsOutput = runDigNS(domain);
  const nameservers = parseNSRecords(nsOutput);
  
  console.log('📋 Nameservers:');
  if (nameservers.length === 0) {
    console.log('   ❌ No nameservers found');
    issues.push('No nameservers configured');
  } else {
    nameservers.forEach(ns => {
      const isCloudflare = ns.includes('cloudflare');
      console.log(`   ${isCloudflare ? '✅' : '⚠️'}  ${ns}`);
    });
  }
  
  if (!nameservers.some(ns => ns.includes('cloudflare'))) {
    issues.push('Nameservers not pointing to Cloudflare');
    recommendations.push('Update nameservers to Cloudflare (osmar.ns.cloudflare.com, zelda.ns.cloudflare.com)');
  }
  
  // Check MX records
  const mxOutput = runDig(domain, 'MX');
  const mxRecords = parseMXRecords(mxOutput);
  
  console.log('\n📧 MX Records:');
  if (mxRecords.length === 0) {
    console.log('   ❌ No MX records found');
    issues.push('No MX records configured');
    recommendations.push('Add Cloudflare Email Routing MX records');
  } else {
    mxRecords.forEach(record => {
      const isCloudflare = record.value.includes('cloudflare');
      const isPorkbun = record.value.includes('porkbun') || record.value.includes('fwd');
      
      if (isCloudflare) {
        console.log(`   ✅  ${record.priority}\t${record.value}`);
      } else if (isPorkbun) {
        console.log(`   ❌  ${record.priority}\t${record.value} (Porkbun - needs to be removed)`);
        issues.push(`MX record still points to Porkbun: ${record.value}`);
      } else {
        console.log(`   ⚠️  ${record.priority}\t${record.value} (unknown provider)`);
        issues.push(`Unknown MX record: ${record.value}`);
      }
    });
    
    // Check if we have the correct Cloudflare MX records
    const hasCloudflareMX = mxRecords.some(r => r.value.includes('cloudflare'));
    const hasPorkbunMX = mxRecords.some(r => r.value.includes('porkbun') || r.value.includes('fwd'));
    
    if (hasPorkbunMX) {
      issues.push('MX records still point to Porkbun forwarders');
      recommendations.push('Remove Porkbun MX records and add Cloudflare Email Routing MX records');
    }
    
    if (!hasCloudflareMX && !hasPorkbunMX) {
      issues.push('No Cloudflare Email Routing MX records found');
      recommendations.push('Add Cloudflare Email Routing MX records (see guide below)');
    }
  }
  
  // Check TXT records (for SPF)
  const txtOutput = runDig(domain, 'TXT');
  const txtRecords = txtOutput
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => ({ type: 'TXT', value: line }));
  
  console.log('\n📝 TXT Records (SPF/DMARC):');
  if (txtRecords.length === 0 || txtRecords[0].value === '') {
    console.log('   ⚠️  No TXT records found');
    recommendations.push('Consider adding SPF record for email authentication');
  } else {
    txtRecords.forEach(record => {
      const isSPF = record.value.includes('v=spf1');
      const isDMARC = record.value.includes('v=DMARC1');
      if (isSPF || isDMARC) {
        console.log(`   ✅  ${record.value.substring(0, 60)}...`);
      } else {
        console.log(`   ℹ️   ${record.value.substring(0, 60)}...`);
      }
    });
  }
  
  // Check A record
  const aOutput = runDig(domain, 'A');
  const aRecords = aOutput
    .trim()
    .split('\n')
    .filter(line => line.length > 0 && !line.includes(';;'))
    .map(line => ({ type: 'A', value: line }));
  
  console.log('\n🌐 A Records:');
  if (aRecords.length === 0 || aRecords[0].value === '') {
    console.log('   ❌ No A records found');
    issues.push('No A records found');
  } else {
    aRecords.forEach(record => {
      console.log(`   ℹ️   ${record.value}`);
    });
  }
  
  return {
    domain,
    nameservers,
    mxRecords,
    txtRecords,
    aRecords,
    issues,
    recommendations,
  };
}

function printSummary(result: DNSCheckResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 DNS STATUS SUMMARY');
  console.log('='.repeat(60));
  
  if (result.issues.length === 0) {
    console.log('\n✅ All DNS records are configured correctly!');
    console.log('   Email routing should be working.');
  } else {
    console.log(`\n❌ Found ${result.issues.length} issue(s):`);
    result.issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
    
    console.log('\n🔧 Recommendations:');
    result.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 REQUIRED CLOUDFLARE MX RECORDS');
  console.log('='.repeat(60));
  console.log('\nAdd these MX records in Cloudflare Dashboard:');
  console.log('https://dash.cloudflare.com > aevoy.com > DNS > Records');
  console.log('');
  console.log('┌──────────┬─────────┬─────────────────────────────┐');
  console.log('│ Priority │ Type    │ Content                     │');
  console.log('├──────────┼─────────┼─────────────────────────────┤');
  TARGET_MX_RECORDS.forEach(mx => {
    console.log(`│ ${mx.priority.toString().padEnd(8)} │ MX      │ ${mx.value.padEnd(27)} │`);
  });
  console.log('└──────────┴─────────┴─────────────────────────────┘');
  
  console.log('\n⚠️  IMPORTANT: Remove any existing Porkbun MX records!');
  console.log('   (fwd1.porkbun.com, fwd2.porkbun.com, etc.)');
}

// Main execution
const domain = process.argv[2] || 'aevoy.com';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           AEVOY.COM DNS STATUS CHECKER                     ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

try {
  const result = checkDNS(domain);
  printSummary(result);
  
  // Exit with error code if there are issues
  process.exit(result.issues.length > 0 ? 1 : 0);
} catch (error) {
  console.error('Error checking DNS:', error);
  process.exit(1);
}
