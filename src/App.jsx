import React, { useState, useCallback, useEffect, useRef } from 'react';
import useGenLayer from './hooks/useGenLayer.js';
import { useReptileRPG } from './hooks/useReptileRPG.js';
import Dashboard from './components/Dashboard.jsx';
import DragonHUD from './components/DragonHUD.jsx';
import NeuralCanvas from './components/NeuralCanvas.jsx';
import ReptileLogic from './components/ReptileLogic.jsx';
import TxToast from './components/TxToast.jsx';

const BATCH_SIZE    = 25;
const RETRY_DELAY   = 30_000; // ms before a failed batch is eligible for retry

// ── Error Boundary — catches rendering crashes without killing the whole app ──
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message ?? String(err) };
  }
  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          className={this.props.className}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 8,
            background: '#0d0d20', color: '#f44747',
            fontFamily: '"JetBrains Mono","Consolas",monospace', fontSize: 12, padding: 24,
          }}
        >
          <span>⚠ Component Error</span>
          <span style={{ color: '#3c3c40', fontSize: 10, maxWidth: 320, textAlign: 'center' }}>
            {this.state.message}
          </span>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            style={{
              marginTop: 8, padding: '4px 14px', cursor: 'pointer',
              background: '#1a1a2e', color: '#4ec9b0', fontFamily: 'inherit', fontSize: 11,
              border: '1px solid #4ec9b0', borderRadius: 3,
            }}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const gl = useGenLayer();

  // ── On-chain state hydration ───────────────────────────────────────────────
  // stats:     null (loading) | false (disconnected) | { soul_name, total_hunts, current_level }
  // syncState: 'loading' | 'fetching' | 'synced' | 'writing' | 'failed' | 'pending' | 'disconnected'
  const { stats: chainStats, syncState, refetch, markPending, recordBatch } = useReptileRPG();

  // ── Optimistic kill counter ────────────────────────────────────────────────
  // Architecture:
  //   totalKillsRef    — cumulative kills since mount, owned by ReptileLogic
  //   confirmedKillsRef — subset of totalKills already confirmed on-chain this session
  //   sessionKills     — unconfirmed local kills = total - confirmed (drives re-render)
  //
  // Display total = chain.total_hunts + sessionKills
  // When chain confirms a batch TX the delta is credited to confirmedKills so
  // we never double-count kills that have been written to the ledger.
  const [sessionKills,    setSessionKills]    = useState(0);
  const totalKillsRef     = useRef(0);   // set by handleEat from ReptileLogic
  const confirmedKillsRef = useRef(0);   // kills accepted by the chain this session
  const prevChainHuntsRef = useRef(null); // last seen chain total_hunts for delta calc

  // ── Mismatch correction ────────────────────────────────────────────────────
  // Runs every time the chain state is refreshed (initial load + every re-fetch).
  // If chain.total_hunts advanced beyond what we last saw, the difference
  // represents kills that were confirmed on-chain — advance the confirmed cursor
  // so they aren't counted again in sessionKills.
  useEffect(() => {
    if (!chainStats || chainStats === false) return;
    const chainHunts = chainStats.total_hunts;

    if (prevChainHuntsRef.current !== null && chainHunts > prevChainHuntsRef.current) {
      const delta = chainHunts - prevChainHuntsRef.current;
      // Cap at totalKills: we can't confirm more than we've locally tracked
      confirmedKillsRef.current = Math.min(
        totalKillsRef.current,
        confirmedKillsRef.current + delta,
      );
      setSessionKills(totalKillsRef.current - confirmedKillsRef.current);
    }

    prevChainHuntsRef.current = chainHunts;
  }, [chainStats]);

  // ── ReptileLogic → App: kill event ────────────────────────────────────────
  // ReptileLogic calls onEat(totalSinceMount) — a running total starting from 0.
  // We derive unconfirmed sessionKills by subtracting what's already on-chain.
  const handleEat = useCallback((totalSinceMount) => {
    totalKillsRef.current = totalSinceMount;
    setSessionKills(totalSinceMount - confirmedKillsRef.current);
  }, []);

  // ── Computed display value ─────────────────────────────────────────────────
  // null while chain is still loading — HUD shows LOADING CORE skeleton.
  // Once loaded: on-chain base + unconfirmed session kills = optimistic total.
  const chainBase      = chainStats        ? chainStats.total_hunts
                       : chainStats === false ? 0
                       : null;  // null = still loading
  const liveEatenCount = chainBase === null ? null : chainBase + sessionKills;

  // ── Toast notification state ──────────────────────────────────────────────
  // null = hidden; { txHash, id } = visible. id changes on every new toast
  // so TxToast remounts fresh (clean animation) even for back-to-back batches.
  const [toast, setToast]     = useState(null);
  const dismissToast          = useCallback(() => setToast(null), []);

  // ── Batch threshold watcher ────────────────────────────────────────────────
  // Fires record_batch() each time liveEatenCount crosses a new BATCH_SIZE
  // multiple.  Uses the real write client (burner wallet) — no more stub.
  //
  // On success: recordBatch() internally refetches chain state, which triggers
  //   the mismatch-correction effect and credits confirmedKills correctly.
  //
  // On failure: syncState = 'failed' (set inside recordBatch), and lastBatchRef
  //   is rolled back after RETRY_DELAY so the next batch crossing re-attempts
  //   rather than skipping that slot permanently.
  const lastBatchRef    = useRef(-1);
  const retryTimerRef   = useRef(null);

  useEffect(() => {
    if (liveEatenCount === null || liveEatenCount <= 0) return;
    const batchNum = Math.floor(liveEatenCount / BATCH_SIZE);
    if (batchNum > lastBatchRef.current) {
      lastBatchRef.current = batchNum;
      markPending();
      recordBatch(BATCH_SIZE).then((hash) => {
        if (hash) setToast({ txHash: hash, id: Date.now() });
      }).catch(() => {
        // TX failed — roll back the batch cursor after RETRY_DELAY so the
        // NEXT kill that crosses this threshold triggers a fresh attempt.
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          // Only roll back if we haven't already advanced past this batch
          if (lastBatchRef.current === batchNum) {
            lastBatchRef.current = batchNum - 1;
          }
        }, RETRY_DELAY);
      });
    }
  }, [liveEatenCount, markPending, recordBatch]);

  // Cleanup retry timer on unmount
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  return (
    <div className="app-container">
      {/* ── Full-width void background — NeuralCanvas spans the entire app ── */}
      <div style={{
        position:      'absolute',
        inset:         0,
        zIndex:        -1,
        pointerEvents: 'none',
        overflow:      'hidden',
      }}>
        <NeuralCanvas />
      </div>

      <ErrorBoundary className="panel-left">
        <Dashboard
          txFeed={gl.txFeed}
          standardTxs={gl.standardTxs}
          standardDetails={gl.standardDetails}
          toggleExpand={gl.toggleExpand}
          networkValidators={gl.networkValidators}
          epochData={gl.epochData}
          blockNumber={gl.blockNumber}
          logs={gl.logs}
          stage={gl.stage}
          pulseStageIdx={gl.pulseStageIdx}
          analyticsData={gl.analyticsData}
        />
      </ErrorBoundary>

      <ErrorBoundary className="panel-right">
        {/* Right panel: canvas + HUD share the same stacking context */}
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'transparent' }}>

          {/* Canvas + particle tooltip (zIndex 1 / 20) */}
          <ReptileLogic
            txFeed={gl.txFeed}
            standardTxs={gl.standardTxs}
            onEat={handleEat}
          />

          {/* HUD bar (zIndex 10) — floats at the top, 60 px tall.
              Receives all chain state as props — no internal data fetching. */}
          <DragonHUD
            liveEatenCount={liveEatenCount}
            chainStats={chainStats}
            syncState={syncState}
          />

          {/* TX toast — slides down from beneath the center section of the HUD.
              key=id remounts the component fresh for each new transaction so
              animations restart cleanly even on back-to-back batch fires.    */}
          {toast && (
            <TxToast
              key={toast.id}
              txHash={toast.txHash}
              id={toast.id}
              onDismiss={dismissToast}
            />
          )}

        </div>
      </ErrorBoundary>
    </div>
  );
}
