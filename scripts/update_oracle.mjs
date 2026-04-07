/**
 * Call HuntOracle.update_threat() to refresh network congestion data on-chain.
 * Run this manually or on a cron whenever you want fresh threat_level data.
 *
 * Usage:
 *   node --env-file=.env scripts/update_oracle.mjs
 */

import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

function requireEnv(k) {
  const v = process.env[k];
  if (!v || v.startsWith('0x_REPLACE')) { console.error(`Missing env: ${k}`); process.exit(1); }
  return v;
}
function normalizePK(raw) {
  const s = raw.startsWith('0x') ? raw.slice(2) : raw;
  return `0x${s}`;
}

const pk      = normalizePK(requireEnv('DEPLOYER_PRIVATE_KEY'));
const address = requireEnv('VITE_HUNT_ORACLE_ADDRESS');

const account = createAccount(pk);
const client  = createClient({ chain: testnetBradbury, account });

console.log(`[update_oracle] Contract : ${address}`);
console.log('[update_oracle] Calling update_threat() …');

try {
  const hash = await client.writeContract({
    address,
    functionName: 'update_threat',
    args: [],
    numOfInitialValidators: 5,
  });
  console.log(`[update_oracle] ✓ TX sent: ${hash}`);
  console.log('[update_oracle] Validators will fetch live Bradbury data and reach consensus (1–5 min).');
} catch (e) {
  console.error('[update_oracle] ✗ Failed:', e?.message ?? e);
  process.exit(1);
}
