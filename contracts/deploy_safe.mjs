/**
 * deploy_safe.mjs — Deploy ReptileRPG.py using genlayer-js (Node.js).
 *
 * Usage:
 *   node contracts/deploy_safe.mjs
 *
 * Reads DEPLOYER_PRIVATE_KEY from .env in the project root.
 * Writes the new contract address back to VITE_REPTILE_RPG_ADDRESS in .env.
 * No secrets are hardcoded in this file.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath }               from 'url';
import { dirname, join }               from 'path';

// ── Locate project root ───────────────────────────────────────────────────────
const __dir     = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dir, '..');
const ENV_PATH  = join(ROOT, '.env');
const PY_PATH   = join(__dir, 'ReptileRPG.py');

// ── Minimal .env parser (no external deps) ────────────────────────────────────
function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* .env not found — env vars may come from shell */ }
  return env;
}

const envVars = loadEnv(ENV_PATH);
const PK_RAW  = process.env.DEPLOYER_PRIVATE_KEY ?? envVars['DEPLOYER_PRIVATE_KEY'] ?? '';

if (!PK_RAW || PK_RAW === 'REPLACE_WITH_YOUR_PRIVATE_KEY') {
  console.error('\n[deploy] ERROR: DEPLOYER_PRIVATE_KEY not set in .env or environment.\n');
  process.exit(1);
}

// Normalize: accept keys with or without 0x prefix
const PK = PK_RAW.startsWith('0x') ? PK_RAW : `0x${PK_RAW}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(PK)) {
  console.error('\n[deploy] ERROR: DEPLOYER_PRIVATE_KEY is not a valid 32-byte hex key.\n');
  process.exit(1);
}

// ── genlayer-js imports ───────────────────────────────────────────────────────
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury }             from 'genlayer-js/chains';

// ── Deploy ────────────────────────────────────────────────────────────────────
const account  = createAccount(PK);
const client   = createClient({ chain: testnetBradbury, account });
const code     = readFileSync(PY_PATH, 'utf8');

console.log(`Deployer : ${account.address}`);
console.log(`Chain    : ${testnetBradbury.name} (id ${testnetBradbury.id})`);
console.log(`Contract : ${PY_PATH}`);
console.log();
console.log('Deploying ReptileRPG.py …');

let txHash;
try {
  txHash = await client.deployContract({ code, args: [] });
} catch (e) {
  console.error('[deploy] deployContract failed:', e?.message ?? e);
  process.exit(1);
}

console.log(`TX hash  : ${txHash}`);
console.log();
console.log('Waiting for ACCEPTED status …');

let receipt;
try {
  receipt = await client.waitForTransactionReceipt({
    hash:    txHash,
    status:  'ACCEPTED',
    retries: 40,
  });
} catch (e) {
  console.error('[deploy] waitForTransactionReceipt failed:', e?.message ?? e);
  console.log(`Check manually: https://explorer-bradbury.genlayer.com/transactions/${txHash}`);
  process.exit(1);
}

// ── Extract deployed address ──────────────────────────────────────────────────
// The receipt or a follow-up Bradbury API call gives us the contract address.
const contractAddress =
  receipt?.contractAddress ??
  receipt?.deployed_contract_address ??
  null;

if (!contractAddress) {
  // Fallback: poll Bradbury explorer API
  console.log('Polling Bradbury explorer for contract address …');
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const res  = await fetch(`https://explorer-bradbury.genlayer.com/api/v1/transactions/${txHash}`);
      const data = await res.json();
      const addr = data?.deployed_contract_address;
      if (addr) {
        console.log(`\n✅  CONTRACT ADDRESS: ${addr}\n`);
        updateEnv(ENV_PATH, addr);
        process.exit(0);
      }
      console.log(`  attempt ${i+1}/15 — status: ${data?.status ?? '?'} — waiting …`);
    } catch (e) {
      console.log(`  attempt ${i+1}/15 — error: ${e?.message}`);
    }
  }
  console.error('Could not retrieve contract address automatically.');
  console.log(`Check: https://explorer-bradbury.genlayer.com/transactions/${txHash}`);
  process.exit(1);
}

console.log(`\n✅  CONTRACT ADDRESS: ${contractAddress}\n`);
updateEnv(ENV_PATH, contractAddress);

// ── Update .env ───────────────────────────────────────────────────────────────
function updateEnv(path, addr) {
  let text = readFileSync(path, 'utf8');
  if (text.includes('VITE_REPTILE_RPG_ADDRESS=')) {
    text = text.replace(/VITE_REPTILE_RPG_ADDRESS=.*/,
      `VITE_REPTILE_RPG_ADDRESS=${addr}`);
  } else {
    text += `\nVITE_REPTILE_RPG_ADDRESS=${addr}\n`;
  }
  writeFileSync(path, text, 'utf8');
  console.log(`VITE_REPTILE_RPG_ADDRESS written to .env`);
}
