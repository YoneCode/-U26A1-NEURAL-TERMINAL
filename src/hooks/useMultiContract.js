import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';

// ── Contract addresses from env ───────────────────────────────────────────────
export const ORACLE_ADDRESS = import.meta.env.VITE_HUNT_ORACLE_ADDRESS ?? null;
export const LORE_ADDRESS   = import.meta.env.VITE_DRAGON_LORE_ADDRESS ?? null;

// ── Read client singleton (shared, no account needed for views) ───────────────
let _client = null;
function getClient() {
  if (!_client) {
    try { _client = createClient({ chain: testnetBradbury }); }
    catch { /* non-browser env */ }
  }
  return _client;
}

// ── Default shapes — used before first successful read ────────────────────────
const DEFAULT_ORACLE = {
  threat_level:    'LOW',
  pending_count:   0,
  validator_count: 0,
  last_epoch:      0,
  batch_multiplier: 100,
};
const DEFAULT_LORE = {
  chronicle:       'Entity boot sequence complete. Awaiting first index cycle.',
  evolution_count: 0,
  last_milestone:  0,
};

// ── Utility: deep-equal two oracle/lore result dicts ─────────────────────────
// Only the fields that matter for rendering are compared — prevents a re-render
// when the RPC returns the exact same values as last poll.
function oracleEqual(a, b) {
  return a.threat_level    === b.threat_level    &&
         a.batch_multiplier === b.batch_multiplier &&
         a.last_epoch       === b.last_epoch;
}
function loreEqual(a, b) {
  return a.chronicle       === b.chronicle &&
         a.evolution_count === b.evolution_count;
}

// ─────────────────────────────────────────────────────────────────────────────
// useMultiContract
//
// Polls HuntOracle.get_oracle() and DragonLore.get_lore() on mount and every
// POLL_MS milliseconds.  Uses strict equality guards before calling setState so
// no re-renders fire unless data actually changed — consistent with the
// performance fix applied to useGenLayer.js.
//
// Exported shape:
//   oracleData  — HuntOracle.get_oracle() result (or DEFAULT_ORACLE)
//   loreData    — DragonLore.get_lore()   result (or DEFAULT_LORE)
//   oracleStatus — 'loading' | 'ok' | 'error' | 'missing'
//   loreStatus   — 'loading' | 'ok' | 'error' | 'missing'
// ─────────────────────────────────────────────────────────────────────────────
const POLL_MS = 60_000; // contracts update rarely; 60 s is sufficient

export default function useMultiContract() {
  const [oracleData,   setOracleData]   = useState(DEFAULT_ORACLE);
  const [loreData,     setLoreData]     = useState(DEFAULT_LORE);
  const [oracleStatus, setOracleStatus] = useState(ORACLE_ADDRESS ? 'loading' : 'missing');
  const [loreStatus,   setLoreStatus]   = useState(LORE_ADDRESS   ? 'loading' : 'missing');

  const mountedRef      = useRef(true);
  const oraclePrevRef   = useRef(null);  // last successfully fetched oracle data
  const lorePrevRef     = useRef(null);  // last successfully fetched lore data

  const fetchOracle = useCallback(async () => {
    const client = getClient();
    if (!client || !ORACLE_ADDRESS) return;
    try {
      const result = await client.readContract({
        address:      ORACLE_ADDRESS,
        functionName: 'get_oracle',
        args:         [],
        leaderOnly:   true,
      });
      if (!mountedRef.current || !result) return;
      const next = {
        threat_level:     String(result.threat_level     ?? 'LOW'),
        pending_count:    Number(result.pending_count    ?? 0),
        validator_count:  Number(result.validator_count  ?? 0),
        last_epoch:       Number(result.last_epoch       ?? 0),
        batch_multiplier: Number(result.batch_multiplier ?? 100),
      };
      // Strict equality guard — skip setState if nothing changed
      if (oraclePrevRef.current && oracleEqual(oraclePrevRef.current, next)) return;
      oraclePrevRef.current = next;
      setOracleData(next);
      setOracleStatus('ok');
    } catch (e) {
      if (!mountedRef.current) return;
      console.debug('[useMultiContract] oracle read error:', e?.message ?? e);
      setOracleStatus('error');
    }
  }, []);

  const fetchLore = useCallback(async () => {
    const client = getClient();
    if (!client || !LORE_ADDRESS) return;
    try {
      const result = await client.readContract({
        address:      LORE_ADDRESS,
        functionName: 'get_lore',
        args:         [],
        leaderOnly:   true,
      });
      if (!mountedRef.current || !result) return;
      const next = {
        chronicle:       String(result.chronicle       ?? DEFAULT_LORE.chronicle),
        evolution_count: Number(result.evolution_count ?? 0),
        last_milestone:  Number(result.last_milestone  ?? 0),
      };
      if (lorePrevRef.current && loreEqual(lorePrevRef.current, next)) return;
      lorePrevRef.current = next;
      setLoreData(next);
      setLoreStatus('ok');
    } catch (e) {
      if (!mountedRef.current) return;
      console.debug('[useMultiContract] lore read error:', e?.message ?? e);
      setLoreStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch — fire both in parallel
    fetchOracle();
    fetchLore();

    // Poll both on the same interval — stagger slightly to avoid burst
    const tid1 = setInterval(fetchOracle, POLL_MS);
    const tid2 = setInterval(fetchLore,   POLL_MS + 5_000);

    return () => {
      mountedRef.current = false;
      clearInterval(tid1);
      clearInterval(tid2);
    };
  }, [fetchOracle, fetchLore]);

  return { oracleData, loreData, oracleStatus, loreStatus };
}
