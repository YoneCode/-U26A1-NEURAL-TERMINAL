/**
 * set_burner.mjs
 *
 * Calls set_burner(burnerAddress) on the ReptileRPG contract using the
 * OWNER private key. Run once after deployment to authorise the burner
 * wallet that the browser uses to call record_batch().
 *
 * Usage (Node 20.6+):
 *   node --env-file=.env scripts/set_burner.mjs
 *
 * Usage (Node <20.6 — loads .env manually, no extra deps):
 *   node scripts/set_burner.mjs
 *
 * Required env vars (in .env at the project root):
 *   VITE_REPTILE_RPG_ADDRESS  — deployed contract address
 *   OWNER_PRIVATE_KEY         — owner wallet private key (NOT the burner)
 *   VITE_PLAYER_PRIVATE_KEY   — burner wallet private key (address is derived)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

// ── Load .env manually for Node < 20.6 (no dotenv needed) ────────────────────
// If --env-file was already used, this is a safe no-op (existing keys win).
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env');
try {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val; // existing vars win
  }
} catch {
  // .env not found — rely on environment variables being set externally
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(name) {
  const val = process.env[name];
  if (!val || val.startsWith('0x_REPLACE')) {
    console.error(`[set_burner] Missing or placeholder env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function normalizePK(raw) {
  const stripped = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stripped)) {
    console.error('[set_burner] Invalid private key format (expected 32 raw hex bytes).');
    process.exit(1);
  }
  return `0x${stripped}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const contractAddress = requireEnv('VITE_REPTILE_RPG_ADDRESS');
const ownerPK         = normalizePK(requireEnv('DEPLOYER_PRIVATE_KEY'));
const burnerPK        = normalizePK(requireEnv('VITE_PLAYER_PRIVATE_KEY'));

// Derive the burner address from its private key
const burnerAccount  = createAccount(burnerPK);
const burnerAddress  = burnerAccount.address;

console.log(`[set_burner] Contract : ${contractAddress}`);
console.log(`[set_burner] Burner   : ${burnerAddress}`);
console.log('[set_burner] Sending set_burner() transaction via owner wallet…');

const ownerAccount = createAccount(ownerPK);
const client = createClient({ chain: testnetBradbury, account: ownerAccount });

try {
  const txHash = await client.writeContract({
    address:               contractAddress,
    functionName:          'set_burner',
    args:                  [burnerAddress],
    numOfInitialValidators: 5,
  });
  console.log(`[set_burner] ✓ TX sent: ${txHash}`);
  console.log('[set_burner] GenLayer consensus may take 1–5 minutes. Check the explorer for confirmation.');
} catch (err) {
  console.error('[set_burner] ✗ Transaction failed:', err?.message ?? err);
  process.exit(1);
}
