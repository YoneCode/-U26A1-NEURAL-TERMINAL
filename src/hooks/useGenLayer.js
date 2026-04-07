import { useState, useEffect, useRef, useCallback } from "react";
import { addressToModel, getDominantModel, AI_MODELS } from "../lib/validatorModels.js";
import { genBlockLogs, genStageLogs, genBanner } from "../lib/logGen.js";

// ─── Stage definitions ────────────────────────────────────────────────────────
export const STAGES = [
  { status: "PENDING",    code: 1, segment: 39, color: "#7b9fff", label: "Pending",               icon: "PND" },
  { status: "PROPOSING",  code: 2, segment: 32, color: "#b388ff", label: "Leader Proposing",      icon: "LDR" },
  { status: "COMMITTING", code: 3, segment: 25, color: "#ff9800", label: "Validators Committing", icon: "CMT" },
  { status: "REVEALING",  code: 4, segment: 17, color: "#ff5252", label: "Validators Revealing",  icon: "REV" },
  { status: "ACCEPTED",   code: 5, segment:  9, color: "#69ff47", label: "Accepted",              icon: "ACC" },
  { status: "FINALIZED",  code: 7, segment:  1, color: "#00e5ff", label: "Finalized",             icon: "FIN" },
];

// ─── Endpoints ────────────────────────────────────────────────────────────────
// /bradbury-api is proxied by Vite → https://explorer-bradbury.genlayer.com
// /standard-api is proxied by Vite → https://explorer-api.testnet-chain.genlayer.com
// Both proxies avoid browser CORS blocks when running on localhost.
export const BRADBURY_API = "/bradbury-api/api/v1";
export const STANDARD_API = "/standard-api";
const RPC_URL             = "https://zksync-os-testnet-genlayer.zksync.dev";

// ─── Bradbury status → STAGES index ──────────────────────────────────────────
const STATUS_TO_STAGE = {
  pending:                0,
  proposing:              1,
  leader_proposing:       1,
  committing:             2,
  leader_revealing:       3,
  revealing:              3,
  accepted:               4,
  finalization_requested: 4,
  finalized:              5,
  undetermined:           4, // consensus failed → ACCEPTED stage + fracture
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function fetchWithTimeout(url, ms = 8000, opts = {}) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

async function rpcCall(method, params = []) {
  const r = await fetchWithTimeout(RPC_URL, 5000, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

// ─── Build validator list for dragon labels ───────────────────────────────────
function buildValidators(enrichRound, leader, addrList) {
  const ev = enrichRound?.validators;
  if (ev?.length) {
    return ev.map(v => {
      const vl = (v.vote ?? "").toLowerCase();
      const vote = vl === "timeout" || vl === "disagree" ? "REJECTED" : "ACCEPTED";
      return { address: v.address, model: addressToModel(v.address), vote, isLeader: v.address === leader, eqScore: null, latency: null };
    });
  }
  if (addrList?.length) {
    return addrList.map(a => ({
      address: a, model: addressToModel(a), vote: "PENDING", isLeader: a === leader, eqScore: null, latency: null,
    }));
  }
  return [];
}

// ─── Map Bradbury transaction → internal entry ────────────────────────────────
function mapBradburyTx(raw) {
  const enrichRound  = raw.enrichment_data?.rounds?.[0];
  const stageIdx     = STATUS_TO_STAGE[raw.status?.toLowerCase()] ?? 0;
  const validators   = buildValidators(enrichRound, raw.leader, raw.validators);
  const totalV       = validators.length || 1;
  const goodV        = validators.filter(v => v.vote !== "REJECTED").length;
  const eqMismatch   = enrichRound?.result === "majority_disagree" || raw.status === "undetermined";

  return {
    hash:            raw.hash,
    from:            raw.from_address    ?? "?",
    to:              raw.to_address      ?? null,
    method:          raw.data?.function  ?? (raw.transaction_type ?? "call").toLowerCase(),
    functionName:    raw.data?.function  ?? "",
    blockNumber:     parseInt(raw.starting_block_number, 10) || 0,
    timestamp:       (raw.submission_timestamp ?? 0) * 1000 || Date.now(),
    isError:         raw.execution_result === "FINISHED_WITH_ERROR",
    fee:             raw.fee             ?? "0",
    value:           raw.value           ?? "0",
    epoch:           raw.epoch           ?? null,
    executionResult: raw.execution_result ?? null,
    enrichmentData:  raw.enrichment_data ?? null,
    isGenLayer:      true,
    isContractCall:  true,
    status:          (raw.status ?? "pending").toUpperCase(),
    stageIdx,
    validators,
    agreementLevel:  goodV / totalV,
    eqMismatch,
    receipt:         null,
    expanded:        false,
  };
}

// ─── Map standard explorer API tx → internal entry ───────────────────────────
function mapStandardTx(raw) {
  const hasInput = raw.data && raw.data !== "0x";
  const method   = hasInput ? raw.data.slice(0, 10) : "Transfer";
  const isFailed = raw.status === "failed" || raw.error != null;
  return {
    hash:            raw.hash,
    from:            raw.from        ?? "?",
    to:              raw.to          ?? null,
    method,
    blockNumber:     raw.blockNumber ?? 0,
    timestamp:       raw.receivedAt  ? new Date(raw.receivedAt).getTime() : Date.now(),
    isError:         isFailed,
    executionResult: isFailed ? "FINISHED_WITH_ERROR" : null,
    status:          isFailed ? "FAILED" : "PROCESSED",
    value:           raw.value   ?? "0",
    fee:             raw.fee     ?? "0",
    gasUsed:         raw.gasUsed ?? "0",
    isGenLayer:      false,
  };
}

// ─── Map raw RPC block tx → internal entry (fallback, no GenLayer data) ───────
function mapRpcTx(t, bn, bts) {
  const hasInput = t.input && t.input !== "0x";
  const mid      = (t.input ?? "").slice(0, 10).toLowerCase();
  return {
    hash: t.hash, from: t.from ?? "?", to: t.to ?? null,
    method: hasInput ? mid : "transfer", functionName: "",
    blockNumber: bn, timestamp: bts * 1000, isError: false, fee: "0", value: t.value ?? "0",
    epoch: null, executionResult: null, enrichmentData: null,
    isGenLayer: hasInput, isContractCall: hasInput,
    status: "FINALIZED", stageIdx: 5,
    validators: [], agreementLevel: 1, eqMismatch: false,
    receipt: null, expanded: false,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export default function useGenLayer() {
  const [txFeed,         setTxFeed]        = useState(null);  // null = awaiting first load
  const [standardTxs,   setStandardTxs]   = useState(null);  // null = awaiting first load
  const [blockNumber,    setBlockNumber]   = useState(null);
  const [networkValidators, setNetworkValidators] = useState(null);
  const [epochData,         setEpochData]         = useState(null);
  const [analyticsData,     setAnalyticsData]     = useState(null);
  const [pulseStageIdx,  setPulseStageIdx] = useState(0);
  const [validators,     setValidators]    = useState([]);
  const [agreementLevel, setAgreementLevel]= useState(1);
  const [dominantModel,  setDominantModel] = useState(AI_MODELS[0]);
  const [isSearching,    setIsSearching]   = useState(false);
  const [eqMismatch,     setEqMismatch]    = useState(false);
  const [logs, setLogs] = useState(() => {
    try { return genBanner(); } catch { return []; }
  });

  const seenHashes   = useRef(new Set());
  const watchHashRef = useRef(null);
  const lastStageRef = useRef({});
  const lastBlock    = useRef(0);

  // ── Centralized standard-tx detail cache (CRIT-01 fix) ────────────────────
  const [standardDetails,  setStandardDetails] = useState({});
  const extraDetailCache   = useRef(new Map());   // hash → raw detail obj
  const detailFetchQueue   = useRef([]);           // hashes waiting to fetch
  const detailFetchRunning = useRef(false);        // in-flight guard
  const seenDetailHashes   = useRef(new Set());   // hashes already queued/cached

  const stage         = STAGES[pulseStageIdx] ?? STAGES[0];
  const targetSegment = stage.segment;
  const pulseColor    = stage.color;

  const toggleExpand = useCallback((hash) => {
    setTxFeed(prev => (prev ?? []).map(t =>
      t?.hash === hash ? { ...t, expanded: !t.expanded } : t
    ));
  }, []);

  // ── Batch detail fetcher — max 5 concurrent, 200 ms throttle between rounds ─
  const processDetailQueue = useCallback(async () => {
    if (detailFetchRunning.current) return;
    detailFetchRunning.current = true;
    try {
      while (detailFetchQueue.current.length > 0) {
        const batch = detailFetchQueue.current.splice(0, 5);
        const settled = await Promise.allSettled(
          batch.map(hash =>
            fetchWithTimeout(`${STANDARD_API}/transactions/${hash}`, 6000)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
              .then(data => ({ hash, data }))
          )
        );
        const newEntries = {};
        for (const r of settled) {
          if (r.status === 'fulfilled') {
            const { hash, data } = r.value;
            const val = data ?? false;
            extraDetailCache.current.set(hash, val);
            // Prune extraDetailCache to a fixed window — oldest entries first
            if (extraDetailCache.current.size > 200) {
              const cacheKeys = Array.from(extraDetailCache.current.keys());
              cacheKeys.slice(0, cacheKeys.length - 200)
                .forEach(k => extraDetailCache.current.delete(k));
            }
            newEntries[hash] = val;
          }
        }
        if (Object.keys(newEntries).length > 0) {
          setStandardDetails(prev => ({ ...prev, ...newEntries }));
        }
        if (detailFetchQueue.current.length > 0) {
          await new Promise(res => setTimeout(res, 200));
        }
      }
    } finally {
      detailFetchRunning.current = false;
    }
  }, []);

  useEffect(() => {
    let killed = false;
    const pollInFlight = { current: false };  // in-flight guard — prevents overlapping requests

    const appendLogs = (entries) => {
      if (!entries?.length) return;
      const safe = entries.filter(e => e && Array.isArray(e?.spans));
      if (!safe.length) return;
      setLogs(prev => [...(prev ?? []), ...safe].slice(-400));
    };

    // ── Dragon: driven by real Bradbury status — no timers ────────────────────
    const animateDragon = (tx) => {
      if (!tx || killed) return;
      const idx  = tx.stageIdx ?? 0;
      const stg  = STAGES[idx] ?? STAGES[0];
      setPulseStageIdx(idx);
      setIsSearching(idx > 0 && idx < 4);
      setValidators(tx.validators ?? []);
      setAgreementLevel(tx.agreementLevel ?? 1);
      setDominantModel(getDominantModel(tx.validators ?? []));
      setEqMismatch(tx.eqMismatch ?? false);
      appendLogs(genStageLogs(stg, tx.hash) ?? []);
    };

    // ── Main poll ─────────────────────────────────────────────────────────────
    const poll = async () => {
      if (killed || pollInFlight.current) return;  // skip if already running
      pollInFlight.current = true;
      try {
        let entries = null;

        // Attempt 1: Bradbury hidden API (full GenLayer data)
        try {
          const r = await fetchWithTimeout(`${BRADBURY_API}/transactions?page=1&page_size=50`, 8000);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          if (killed) return;
          if (!Array.isArray(d?.transactions)) throw new Error("unexpected shape");
          entries = d.transactions.map(mapBradburyTx);
        } catch (e) {
          console.error("[GenLayer] Bradbury API:", e.message);
        }

        // Attempt 2: JSON-RPC fallback (no GenLayer enrichment)
        if (!entries) {
          try {
            const bnHex = await rpcCall("eth_blockNumber");
            if (killed) return;
            const bn = parseInt(bnHex, 16);
            if (bn <= lastBlock.current) { setTxFeed(p => p === null ? [] : p); return; }
            const block = await rpcCall("eth_getBlockByNumber", [bnHex, true]);
            if (killed) return;
            const bts  = parseInt(block?.timestamp ?? "0", 16);
            const txs  = Array.isArray(block?.transactions) ? block.transactions : [];
            entries    = txs.map(t => mapRpcTx(t, bn, bts));
            lastBlock.current = bn;
            setBlockNumber(bn);
          } catch (e) {
            console.error("[GenLayer] RPC fallback:", e.message);
            setTxFeed(p => p === null ? null : p);
            return;
          }
        }

        if (!entries?.length) { setTxFeed(p => p === null ? [] : p); return; }

        // Track highest block
        const maxBlock = entries.reduce((m, e) => Math.max(m, e.blockNumber || 0), lastBlock.current);
        if (maxBlock > lastBlock.current) { lastBlock.current = maxBlock; setBlockNumber(maxBlock); }

        // Split new vs existing
        const newEntries = entries.filter(e => !seenHashes.current.has(e.hash));
        newEntries.forEach(e => seenHashes.current.add(e.hash));
        // CRIT-03: prune oldest entries to prevent unbounded memory growth
        if (seenHashes.current.size > 200) {
          Array.from(seenHashes.current).slice(0, 100).forEach(h => seenHashes.current.delete(h));
        }

        // Atomic feed update: add new at top + refresh status of existing
        setTxFeed(prev => {
          const base = Array.isArray(prev) ? prev : [];
          const refreshed = base.map(t => {
            const fresh = entries.find(e => e.hash === t.hash);
            if (!fresh) return t;
            return { ...t, status: fresh.status, stageIdx: fresh.stageIdx, validators: fresh.validators, agreementLevel: fresh.agreementLevel, eqMismatch: fresh.eqMismatch, enrichmentData: fresh.enrichmentData, executionResult: fresh.executionResult };
          });
          return [...newEntries, ...refreshed].slice(0, 30);
        });

        if (newEntries.length) appendLogs(genBlockLogs(maxBlock, newEntries.length) ?? []);

        // Pick the most active tx for dragon — prefer in-progress over finalized
        const inProgress = entries.find(e => e.stageIdx > 0 && e.stageIdx < 4);
        const target     = inProgress ?? entries[0];
        if (!target) return;

        // Switch watch target if new tx found
        if (watchHashRef.current !== target.hash) {
          watchHashRef.current = target.hash;
          lastStageRef.current[target.hash] = -1; // force animate on first sight
        }

        // Only animate if stage actually changed (no unnecessary re-renders)
        const prevStage = lastStageRef.current[target.hash] ?? -1;
        if (target.stageIdx !== prevStage) {
          lastStageRef.current[target.hash] = target.stageIdx;
          // Prune lastStageRef — keeps memory flat over long sessions
          const stageKeys = Object.keys(lastStageRef.current);
          if (stageKeys.length > 200) {
            stageKeys.slice(0, stageKeys.length - 200)
              .forEach(k => delete lastStageRef.current[k]);
          }
          animateDragon(target);
        }
      } finally {
        pollInFlight.current = false;  // always release guard, even on early return/throw
      }
    };

    // ── WebSocket: subscribe to newHeads for real-time block notifications ───
    // Falls back gracefully — the setInterval below always runs as a safety net.
    // Reconnects automatically with exponential backoff on close/error so a
    // transient network drop or server restart does not permanently kill push
    // updates.  Ceiling is 30 s; resets to 1 s on every clean open.
    let ws             = null;
    let wsBackoffMs    = 1_000;
    let wsReconnectTid = null;
    const WS_BACKOFF_CAP = 30_000;
    const WS_URL = RPC_URL.replace(/^https?:\/\//, 'wss://');

    const connectWS = () => {
      if (killed) return;
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => {
          wsBackoffMs = 1_000; // reset backoff on successful connection
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            // newHeads subscription fires on every new block — trigger a poll immediately
            if (msg.method === 'eth_subscription' && msg.params?.result?.number) poll();
          } catch { /* ignore malformed frames */ }
        };
        ws.onerror = () => { /* surfaced via onclose — no duplicate action needed */ };
        ws.onclose = () => {
          if (killed) return;
          // Schedule reconnect, then double the delay for the next attempt
          wsReconnectTid = setTimeout(() => {
            wsBackoffMs = Math.min(wsBackoffMs * 2, WS_BACKOFF_CAP);
            connectWS();
          }, wsBackoffMs);
        };
      } catch { /* WS constructor threw (e.g. invalid URL) — interval fallback handles it */ }
    };
    connectWS();

    // Initial poll + 5 s interval as fallback (fires even when WS is healthy
    // so stale data never accumulates if a subscription frame is missed)
    poll();
    const tid = setInterval(poll, 5000);
    return () => {
      killed = true;
      clearInterval(tid);
      if (wsReconnectTid) clearTimeout(wsReconnectTid);
      if (ws) { ws.onmessage = null; ws.onerror = null; ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  useEffect(() => {
    // Validators
    fetchWithTimeout(`${BRADBURY_API}/validators?page=1&page_size=50&sort_by=validator_weight&order=desc`, 12000)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (Array.isArray(d?.validators)) setNetworkValidators(d.validators); })
      .catch(e => console.error("[GenLayer] validators:", e));

    // Epochs
    fetchWithTimeout(`${BRADBURY_API}/epochs?page=1&page_size=20`, 12000)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (Array.isArray(d?.epochs)) setEpochData(d.epochs); })
      .catch(e => console.error("[GenLayer] epochs:", e));

    // Analytics (last 7 days, H1 intervals)
    const now  = Math.floor(Date.now() / 1000);
    const week = 7 * 24 * 3600;
    fetchWithTimeout(`${BRADBURY_API}/analytics/kpi-histories?from_timestamp=${now - week}&to_timestamp=${now}&interval=H1&metric=total_finalized_transactions`, 12000)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (Array.isArray(d?.histories)) setAnalyticsData(d.histories); })
      .catch(e => console.error("[GenLayer] analytics:", e));
  }, []);

  // ── Standard explorer API poll (separate from Bradbury) ─────────────────────
  useEffect(() => {
    let killed = false;
    const stdInFlight = { current: false };
    const poll = async () => {
      if (killed || stdInFlight.current) return;
      stdInFlight.current = true;
      try {
        const r = await fetchWithTimeout(`${STANDARD_API}/transactions?limit=50`, 8000);
        if (!r.ok || killed) return;
        const d = await r.json();
        if (!killed && Array.isArray(d?.items)) {
          setStandardTxs(d.items.map(mapStandardTx));
          // Queue detail fetches for newly seen hashes only (batch, throttled)
          const newDetailHashes = d.items
            .map(item => item.hash)
            .filter(h => h && !seenDetailHashes.current.has(h));
          if (newDetailHashes.length > 0) {
            newDetailHashes.forEach(h => {
              seenDetailHashes.current.add(h);
              detailFetchQueue.current.push(h);
            });
            // Prune seenDetailHashes to prevent unbounded growth
            if (seenDetailHashes.current.size > 200) {
              Array.from(seenDetailHashes.current).slice(0, 100)
                .forEach(h => seenDetailHashes.current.delete(h));
            }
            processDetailQueue();
          }
        }
      } catch (e) {
        console.error("[GenLayer] standard API:", e.message);
        if (!killed) setStandardTxs(prev => prev === null ? [] : prev);
      } finally {
        stdInFlight.current = false;
      }
    };
    poll();
    const tid = setInterval(poll, 5000);
    return () => { killed = true; clearInterval(tid); };
  }, []);

  return {
    txFeed, toggleExpand,
    standardTxs, standardDetails,
    networkValidators, epochData, analyticsData,
    blockNumber,
    stage, pulseStageIdx, targetSegment, pulseColor,
    validators, agreementLevel, dominantModel,
    isSearching, eqMismatch,
    logs,
  };
}
