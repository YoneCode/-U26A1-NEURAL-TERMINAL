/**
 * Re-deploy HuntOracle.py only and update VITE_HUNT_ORACLE_ADDRESS in .env.
 * Usage: node --env-file=.env scripts/deploy_hunt_oracle.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

function requireEnv(k) {
  const v = process.env[k];
  if (!v || v.startsWith('0x_REPLACE')) { console.error(`Missing env: ${k}`); process.exit(1); }
  return v;
}
function normalizePK(raw) {
  return `0x${raw.startsWith('0x') ? raw.slice(2) : raw}`;
}

const pk      = normalizePK(requireEnv('DEPLOYER_PRIVATE_KEY'));
const account = createAccount(pk);
const client  = createClient({ chain: testnetBradbury, account });

console.log(`Deployer : ${account.address}`);

const code   = readFileSync(resolve(ROOT, 'contracts/HuntOracle.py'), 'utf8');
console.log('Deploying HuntOracle.py …');
const txHash = await client.deployContract({ code, args: [], numOfInitialValidators: 5 });
console.log(`TX : ${txHash}`);

// Poll for deployed address
const url = `https://explorer-bradbury.genlayer.com/api/v1/transactions/${txHash}`;
let addr = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 8000));
  try {
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (data?.deployed_contract_address) { addr = data.deployed_contract_address; break; }
    console.log(`  attempt ${i+1}/20 — status: ${data?.status ?? '?'}`);
  } catch (e) {
    console.log(`  attempt ${i+1}/20 — ${e.message}`);
  }
}

if (!addr) {
  console.error(`\nCould not resolve address. Check manually:\nhttps://explorer-bradbury.genlayer.com/transaction/${txHash}`);
  process.exit(1);
}

console.log(`\n✅  New HuntOracle address: ${addr}`);

// Write to .env
const envPath = resolve(ROOT, '.env');
let text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
text = text.includes('VITE_HUNT_ORACLE_ADDRESS=')
  ? text.replace(/VITE_HUNT_ORACLE_ADDRESS=.*/, `VITE_HUNT_ORACLE_ADDRESS=${addr}`)
  : text + `\nVITE_HUNT_ORACLE_ADDRESS=${addr}\n`;
writeFileSync(envPath, text, 'utf8');
console.log('.env updated.');
console.log(`\n⚠  Update GitHub secret VITE_HUNT_ORACLE_ADDRESS → ${addr}`);
