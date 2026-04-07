/**
 * Deploy HuntOracle.py and DragonLore.py to GenLayer Bradbury testnet.
 * After deploying, writes the contract addresses to .env as:
 *   VITE_HUNT_ORACLE_ADDRESS=0x...
 *   VITE_DRAGON_LORE_ADDRESS=0x...
 *
 * Usage:
 *   node --env-file=.env scripts/deploy_contracts.mjs
 *
 * Requires in .env:
 *   DEPLOYER_PRIVATE_KEY
 *   VITE_REPTILE_RPG_ADDRESS  (needed as constructor arg for DragonLore)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

// ── Env helpers ────────────────────────────────────────────────────────────────
function requireEnv(k) {
  const v = process.env[k];
  if (!v || v.startsWith('0x_REPLACE')) {
    console.error(`[deploy] Missing required env var: ${k}`);
    process.exit(1);
  }
  return v;
}
function normalizePK(raw) {
  const s = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  return `0x${s}`;
}

// ── Poll explorer for deployed contract address ───────────────────────────────
async function pollDeployedAddress(txHash, label, maxAttempts = 15) {
  const url = `https://explorer-bradbury.genlayer.com/api/v1/transactions/${txHash}`;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 8000));
    try {
      const res  = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (data?.deployed_contract_address) {
        return data.deployed_contract_address;
      }
      console.log(`  [${label}] attempt ${i + 1}/${maxAttempts} — status: ${data?.status ?? '?'} — waiting…`);
    } catch (e) {
      console.log(`  [${label}] attempt ${i + 1}/${maxAttempts} — error: ${e.message}`);
    }
  }
  return null;
}

// ── Write env var to .env ─────────────────────────────────────────────────────
function writeEnvVar(key, value) {
  const envPath = resolve(ROOT, '.env');
  let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  if (text.includes(`${key}=`)) {
    text = text.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
  } else {
    text += `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, text, 'utf8');
  console.log(`  ${key} written to .env`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
const deployerPK      = normalizePK(requireEnv('DEPLOYER_PRIVATE_KEY'));
const reptileAddress  = requireEnv('VITE_REPTILE_RPG_ADDRESS');

const account = createAccount(deployerPK);
const client  = createClient({ chain: testnetBradbury, account });

console.log(`Deployer : ${account.address}`);
console.log(`ReptileRPG address (DragonLore arg): ${reptileAddress}\n`);

// ── Deploy HuntOracle ──────────────────────────────────────────────────────────
const oracleCode = readFileSync(resolve(ROOT, 'contracts/HuntOracle.py'), 'utf8');
console.log('Deploying HuntOracle.py …');
const oracleTxHash = await client.deployContract({
  code: oracleCode,
  args: [],
  numOfInitialValidators: 5,
});
console.log(`HuntOracle deploy tx : ${oracleTxHash}`);

// ── Deploy DragonLore ──────────────────────────────────────────────────────────
const loreCode = readFileSync(resolve(ROOT, 'contracts/DragonLore.py'), 'utf8');
console.log('\nDeploying DragonLore.py …');
const loreTxHash = await client.deployContract({
  code: loreCode,
  args: [reptileAddress],
  numOfInitialValidators: 5,
});
console.log(`DragonLore deploy tx : ${loreTxHash}`);

// ── Wait for addresses ─────────────────────────────────────────────────────────
console.log('\nPolling explorer for contract addresses …');
const [oracleAddr, loreAddr] = await Promise.all([
  pollDeployedAddress(oracleTxHash, 'HuntOracle'),
  pollDeployedAddress(loreTxHash,   'DragonLore'),
]);

if (oracleAddr) {
  console.log(`\n✅  HUNT_ORACLE_ADDRESS: ${oracleAddr}`);
  writeEnvVar('VITE_HUNT_ORACLE_ADDRESS', oracleAddr);
} else {
  console.warn(`\n⚠  HuntOracle address not found. Check: https://explorer-bradbury.genlayer.com/transaction/${oracleTxHash}`);
}

if (loreAddr) {
  console.log(`✅  DRAGON_LORE_ADDRESS: ${loreAddr}`);
  writeEnvVar('VITE_DRAGON_LORE_ADDRESS', loreAddr);
} else {
  console.warn(`⚠  DragonLore address not found. Check: https://explorer-bradbury.genlayer.com/transaction/${loreTxHash}`);
}
