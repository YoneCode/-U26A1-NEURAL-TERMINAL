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

  const hasDataRef     = useRef(false); // true after first successful read
  const mountedRef     = useRef(true);
  const batchInFlight  = useRef(false); // mutex: only one recordBatch at a time

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

  // ── Silent read: fetches get_stats WITHOUT touching React state ─────────────────
  // Used inside recordBatch so we can read the chain mid-write without
  // triggering the transient 'synced' flash that a full fetchStats() causes.
  const silentReadStats = useCallback(async () => {
    const client = getReadClient();
    if (!client || !REPTILE_CONTRACT_ADDRESS) return null;
    try {
      const result = await client.readContract({
        address:      REPTILE_CONTRACT_ADDRESS,
        functionName: 'get_stats',
        args:         [],
        leaderOnly:   true,
      });
      if (result && typeof result === 'object') {
        return {
          soul_name:     String(result.soul_name     ?? '(我愛羅)'),
          total_hunts:   Number(result.total_hunts   ?? 0),
          current_level: Number(result.current_level ?? 0),
        };
      }
    } catch { /* ignore — caller handles null */ }
    return null;
  }, []);

  // ── Core write ───────────────────────────────────────────────────────────────────────
  // Calls record_batch(amount) on the contract using the burner wallet.
  // GenLayer consensus can take 1–5 minutes to process a TX, so instead of
  // waiting for a receipt (which times out), we poll get_stats until
  // total_hunts increases, confirming on-chain acceptance.
  //
  // MUTEX: batchInFlight prevents concurrent invocations during the 8-min
  // polling window — a second call while one is in-flight returns immediately.
  const recordBatch = useCallback(async (amount) => {
    if (batchInFlight.current) {
      console.warn(`[ReptileRPG] record_batch(${amount}) skipped — a batch write is already in flight.`);
      return;
    }

    const wc = getWriteClient();
    if (!wc || !REPTILE_CONTRACT_ADDRESS) {
      console.warn('[ReptileRPG] record_batch skipped: write client unavailable (check VITE_PLAYER_PRIVATE_KEY).');
      return;
    }

    batchInFlight.current = true;
    setSyncState('writing');
    try {
      const hash = await wc.writeContract({
        address:      REPTILE_CONTRACT_ADDRESS,
        functionName: 'record_batch',
        args:         [amount],
      });

      console.log(`[ReptileRPG] record_batch(${amount}) TX sent: ${hash}`);

      // Poll get_stats silently (no state updates) until total_hunts increases.
      // GenLayer consensus takes 1–5 minutes, so we poll for up to 8 minutes.
      const baseline = (await silentReadStats())?.total_hunts ?? 0;
      let confirmed = false;
      let confirmedStats = null;
      for (let i = 0; i < 48 && mountedRef.current; i++) {
        await new Promise(r => setTimeout(r, 10_000));
        const cur = await silentReadStats();
        if (cur && cur.total_hunts > baseline) {
          confirmed = true;
          confirmedStats = cur;
          break;
        }
      }

      if (confirmed && confirmedStats && mountedRef.current) {
        console.log(`[ReptileRPG] record_batch(${amount}) confirmed on-chain.`);

        // Commit confirmed stats to React state in one atomic update
        setStats(confirmedStats);
        setSyncState('synced');

        // ── register_level_up: sync visual level to the ledger ────────────────
        // Derive the canonical level the same way DragonHUD does (floor / 100).
        const newLevel = Math.floor(confirmedStats.total_hunts / 100);
        if (newLevel > confirmedStats.current_level) {
          try {
            await wc.writeContract({
              address:      REPTILE_CONTRACT_ADDRESS,
              functionName: 'register_level_up',
              args:         [newLevel],
            });
            console.log(`[ReptileRPG] register_level_up(${newLevel}) TX sent.`);
          } catch (le) {
            // Non-fatal — level sync is cosmetic; batch is already confirmed
            console.warn('[ReptileRPG] register_level_up failed (non-fatal):', le?.message ?? le);
          }
        }

        return hash;
      }

      // TX sent but not yet confirmed within the poll window.
      // Do a full fetchStats so state reflects whatever the chain currently shows.
      console.warn(`[ReptileRPG] record_batch(${amount}) TX sent but not confirmed within poll window.`);
      if (mountedRef.current) await fetchStats(false);
      return hash;
    } catch (e) {
      if (!mountedRef.current) return;
      console.error('[ReptileRPG] record_batch failed:', e?.message ?? e);
      setSyncState('failed');
      throw e;
    } finally {
      batchInFlight.current = false;
    }
  }, [fetchStats, silentReadStats]);

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
