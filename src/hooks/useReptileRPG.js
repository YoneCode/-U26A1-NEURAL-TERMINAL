// WARNING: VITE_PLAYER_PRIVATE_KEY is a public burner wallet for testnet only.
// Do not use for mainnet assets. It is intentionally bundled into client JS so
// the browser can sign record_batch() transactions on Bradbury testnet without
// a separate backend. Treat as a throwaway key with no real value attached.

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

// ── Contract constants (exported so consumers don't re-declare them) ──────────
export const REPTILE_CONTRACT_ADDRESS =
  import.meta.env.VITE_REPTILE_RPG_ADDRESS ?? null;
export const EXPLORER_BASE = 'https://explorer-bradbury.genlayer.com';

// ── Burner wallet key validation & normalization ──────────────────────────────
// Accepts keys with or without the 0x prefix (64 or 66 chars).
// Rejects the placeholder string and anything that isn't 32 raw hex bytes.
const RAW_PK = import.meta.env.VITE_PLAYER_PRIVATE_KEY ?? '';
function normalizePK(raw) {
  if (!raw || raw === '0x_REPLACE_WITH_BURNER_KEY_LATER') return null;
  const stripped = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (stripped.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(stripped)) return null;
  return `0x${stripped}`;
}
const PLAYER_PK = normalizePK(RAW_PK);

if (!PLAYER_PK) {
  console.warn(
    '[ReptileRPG] VITE_PLAYER_PRIVATE_KEY is missing or is still the placeholder. ' +
    'Blockchain writes are disabled — set a real Bradbury burner key in .env to enable persistence.'
  );
}

// ── Client singletons ─────────────────────────────────────────────────────────
// Read client: no account needed for view functions.
// Write client: initialized with burner account only if a valid key is present.
let _readClient  = null;
let _writeClient = null;

function getReadClient() {
  if (!_readClient && REPTILE_CONTRACT_ADDRESS) {
    try { _readClient = createClient({ chain: testnetBradbury }); }
    catch { /* SSR / no-WebSocket environments */ }
  }
  return _readClient;
}

function getWriteClient() {
  if (!_writeClient && REPTILE_CONTRACT_ADDRESS && PLAYER_PK) {
    try {
      const account = createAccount(PLAYER_PK);
      _writeClient = createClient({ chain: testnetBradbury, account });
    } catch (e) {
      console.error('[ReptileRPG] Failed to initialize write client:', e?.message ?? e);
    }
  }
  return _writeClient;
}

// ── syncState machine ─────────────────────────────────────────────────────────
//
//   'loading'      — first fetch in flight; no data in hand yet
//   'fetching'     — background refresh; stale data still displayed
//   'synced'       — data current; no unacknowledged TX
//   'writing'      — TX sent, waiting for on-chain ACCEPTED confirmation   ← NEW
//   'failed'       — TX reverted / timed out; local count retained         ← NEW
//   'pending'      — batch threshold crossed; TX about to fire
//   'disconnected' — RPC unreachable or contract not found

export function useReptileRPG() {
  // null   = initial load in progress (no data yet)
  // false  = permanently failed / contract unreachable
  // object = { soul_name: string, total_hunts: number, current_level: number }
  const [stats,     setStats]     = useState(null);
  const [syncState, setSyncState] = useState('loading');

  const hasDataRef = useRef(false); // true after first successful read
  const mountedRef = useRef(true);

  // ── Core read ─────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async (isBackground = false) => {
    if (!mountedRef.current) return null;

    const client = getReadClient();
    if (!client || !REPTILE_CONTRACT_ADDRESS) {
      setStats(false);
      setSyncState('disconnected');
      return null;
    }

    if (!isBackground) {
      setSyncState(s => s === 'loading' ? 'loading' : 'fetching');
    }

    try {
      const result = await client.readContract({
        address:      REPTILE_CONTRACT_ADDRESS,
        functionName: 'get_stats',
        args:         [],
        leaderOnly:   true,
      });

      if (!mountedRef.current) return null;

      if (result && typeof result === 'object') {
        const data = {
          soul_name:     String(result.soul_name     ?? '(我愛羅)'),
          total_hunts:   Number(result.total_hunts   ?? 0),
          current_level: Number(result.current_level ?? 0),
        };
        hasDataRef.current = true;
        setStats(data);
        setSyncState('synced');
        return data;
      }
    } catch (e) {
      if (!mountedRef.current) return null;
      console.debug('[ReptileRPG] get_stats error:', e?.message ?? e);
      if (!hasDataRef.current) {
        setStats(false);
        setSyncState('disconnected');
      } else {
        setSyncState('disconnected');
      }
    }
    return null;
  }, []);

  // ── Core write ────────────────────────────────────────────────────────────
  // Calls record_batch(amount) on the contract using the burner wallet.
  // GenLayer consensus can take 1–5 minutes to process a TX, so instead of
  // waiting for a receipt (which times out), we poll get_stats until
  // total_hunts increases, confirming on-chain acceptance.
  const recordBatch = useCallback(async (amount) => {
    const wc = getWriteClient();
    if (!wc || !REPTILE_CONTRACT_ADDRESS) {
      console.warn('[ReptileRPG] record_batch skipped: write client unavailable (check VITE_PLAYER_PRIVATE_KEY).');
      return;
    }

    setSyncState('writing');
    try {
      const hash = await wc.writeContract({
        address:      REPTILE_CONTRACT_ADDRESS,
        functionName: 'record_batch',
        args:         [amount],
      });

      console.log(`[ReptileRPG] record_batch(${amount}) TX sent: ${hash}`);

      // Poll get_stats until total_hunts increases (confirms on-chain write).
      // GenLayer consensus takes 1–5 minutes, so we poll for up to 8 minutes.
      const rc = getReadClient();
      if (rc) {
        const baseline = (await fetchStats(true))?.total_hunts ?? 0;
        let confirmed = false;
        for (let i = 0; i < 48 && mountedRef.current; i++) {
          await new Promise(r => setTimeout(r, 10_000));
          const cur = await fetchStats(true);
          if (cur && cur.total_hunts > baseline) {
            confirmed = true;
            break;
          }
        }
        if (confirmed) {
          console.log(`[ReptileRPG] record_batch(${amount}) confirmed on-chain.`);
          return hash;
        }
      }

      // TX sent but not yet confirmed within the poll window.
      // Return the hash anyway so App can show a toast; syncState set by fetchStats.
      console.warn(`[ReptileRPG] record_batch(${amount}) TX sent but not yet confirmed within poll window.`);
      return hash;
    } catch (e) {
      if (!mountedRef.current) return;
      console.error('[ReptileRPG] record_batch failed:', e?.message ?? e);
      setSyncState('failed');
      throw e;
    }
  }, [fetchStats]);

  // ── Mount: initial fetch + 30 s auto-poll ─────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchStats(false);
    const tid = setInterval(() => fetchStats(true), 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(tid);
    };
  }, [fetchStats]);

  // ── Public API ─────────────────────────────────────────────────────────────
  const refetch     = useCallback(() => fetchStats(false), [fetchStats]);
  const markPending = useCallback(() => {
    setSyncState(s => (s === 'synced' || s === 'fetching') ? 'pending' : s);
  }, []);

  return { stats, syncState, refetch, markPending, recordBatch };
}
