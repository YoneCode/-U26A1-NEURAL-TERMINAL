import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { STAGES, BRADBURY_API } from "../hooks/useGenLayer.js";
import { C } from "../lib/logGen.js";
import { STATUS_COLOR_MAP } from "../lib/statusColors.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortHash(h) { return h ? h.slice(0, 8) + "\u2026" + h.slice(-4) : "?"; }
function shortAddr(a) { return a ? a.slice(0, 6) + "\u2026" + a.slice(-4) : "?"; }
function timeAgo(ts) {
  if (!ts || isNaN(ts)) return "?";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 0) return "0s";
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
}
function fmtStake(v) {
  if (v == null) return "?";
  const n = parseFloat(v);
  if (isNaN(n)) return String(v);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}
function fmtNative(raw) {
  if (!raw || raw === "0") return "0";
  try {
    const n = BigInt(raw);
    if (n === 0n) return "0";
    const gwei = Number(n) / 1e9;
    const eth  = Number(n) / 1e18;
    if (eth  >= 0.001) return eth.toFixed(4)  + " GEN";
    if (gwei >= 0.001) return gwei.toFixed(2) + " Gwei";
    return n.toString() + " wei";
  } catch { return String(raw); }
}
function fmtGenStake(raw) {
  if (!raw || raw === "0") return "0";
  try {
    const n = BigInt(raw);
    const gen = n / BigInt("1000000000000000000");
    const num = Number(gen);
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M GEN";
    if (num >= 1_000)     return (num / 1_000).toFixed(1)     + "K GEN";
    return num.toFixed(0) + " GEN";
  } catch { return "?"; }
}
function fmtTime(ts) {
  if (!ts) return "?";
  try { return new Date(ts).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }); }
  catch { return String(ts); }
}

const METHOD_COLORS = {
  gen_call: "#38bdf8", gen_run: "#38bdf8", gen_execute: "#38bdf8", gen_deploy: "#38bdf8",
  transfer: "#4ec9b0", approve: "#e8c86d", mint: "#f97316",
  stake: "#3b82f6", swap: "#10b981", deposit: "#4ec9b0", withdraw: "#f97316",
};
const STATUS_COLORS = STATUS_COLOR_MAP;
const STATUS_ICON = {
  PENDING: "\xB7", PROPOSING: "\u2026", COMMITTING: "\u23ce", REVEALING: "\u2191",
  ACCEPTED: "\u2713", FINALIZED: "\u25ce", REJECTED: "\u2717",
  PROCESSED: "\u2713", INCLUDED: "\u2713", FAILED: "\u2717",
};

// ─── "Awaiting" empty state ───────────────────────────────────────────────────
function Awaiting({ label }) {
  return (
    <div className="awaiting-sync">
      <span className="awaiting-icon">\u25CC</span>
      <span className="awaiting-text">AWAITING NETWORK SYNC</span>
      {label && <span className="awaiting-sub">{label}</span>}
    </div>
  );
}

// ─── Error boundary for tab panels ───────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { caught: false, msg: null }; }
  static getDerivedStateFromError(err) { return { caught: true, msg: err?.message ?? String(err) }; }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info?.componentStack); }
  reset() { this.setState({ caught: false, msg: null }); }
  render() {
    if (this.state.caught) {
      return (
        <div className="awaiting-sync">
          <span className="awaiting-icon" style={{ color: '#f44747' }}>!</span>
          <span className="awaiting-text" style={{ color: '#f44747' }}>RENDER FAULT DETECTED</span>
          <span className="awaiting-sub">Panel isolated \u2014 data pipeline intact</span>
          {this.state.msg && (
            <span className="awaiting-sub" style={{ color: '#f44747', opacity: 0.7, fontSize: 9, marginTop: 4, fontStyle: 'normal' }}>
              {this.state.msg.slice(0, 120)}
            </span>
          )}
          <button
            onClick={() => this.reset()}
            style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.06em', background: 'rgba(244,71,71,0.08)', border: '1px solid rgba(244,71,71,0.3)', color: '#f44747', padding: '3px 10px', cursor: 'pointer' }}
          >
            RETRY RENDER
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Consensus-step colour map (keyed by real `step` field values) ────────────
const STEP_COLORS = {
  NewTransaction:               C.keyword,  // #569cd6
  TransactionActivated:         C.cyan,     // #9cdcfe
  TransactionLeaderRevealed:    C.str,      // #ce9178
  VoteCommitted:                C.orange,   // #d7953e
  TransactionReceiptProposed:   C.fn,       // #dcdcaa
  VoteRevealed:                 C.purple,   // #c586c0
  TransactionAccepted:          C.lgreen,   // #89d185
  TransactionUndetermined:      C.red,      // #f44747
  TransactionFinalized:         C.teal,     // #4ec9b0
};

// ─── Timestamp helpers ─────────────────────────────────────────────────────────
function csTs(unix) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleTimeString("en-GB", { hour12: false });
}
function csDelta(t0, t1) {
  const d = (t1 ?? 0) - (t0 ?? 0);
  if (d <= 0) return null;
  if (d < 60) return "+" + d + "s";
  const m = Math.floor(d / 60), s = d % 60;
  return "+" + m + "m" + (s ? s + "s" : "");
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB 1 — tx_stream.log  ▸  NeuralExpand (full hardcore terminal dump)
// ─────────────────────────────────────────────────────────────────────────────
function NeuralExpand({ tx }) {
  const [rawSteps, setRawSteps] = useState(null); // null=loading, []+=done
  const [csErr,    setCsErr]    = useState(null);

  useEffect(() => {
    if (!tx?.hash) return;
    let cancelled = false;
    setCsErr(null);
    setRawSteps(null);
    (async () => {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 8000);
        let r;
        try {
          r = await fetch(
            `${BRADBURY_API}/transactions/consensus-steps/${tx.hash}`,
            { signal: ctrl.signal }
          );
        } finally {
          clearTimeout(tid);
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setRawSteps(Array.isArray(d) ? d : []);
      } catch (e) {
        if (!cancelled) setCsErr(e.message ?? "fetch failed");
      }
    })();
    return () => { cancelled = true; };
  }, [tx?.hash]);

  // Sort by (timestamp, rollup_block) — API order is not guaranteed
  const steps = useMemo(() => {
    if (!Array.isArray(rawSteps)) return null;
    return [...rawSteps].sort((a, b) => {
      const td = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      return td !== 0 ? td : (a.rollup_block ?? 0) - (b.rollup_block ?? 0);
    });
  }, [rawSteps]);

  if (!tx) return null;

  const enrichment = tx.enrichmentData ?? null;
  const t0         = steps?.[0]?.timestamp ?? null;
  const traceEntries = enrichment?.traces ? Object.entries(enrichment.traces) : [];
  const hasTraces    = traceEntries.length > 0;

  // ── render helpers ────────────────────────────────────────────────────────
  // One tree row: prefix + branch + key + value(s)
  function Row({ pre, last, label, labelColor, children }) {
    return (
      <div className="cs-row">
        <span className="cs-pre" style={{ color: "#404058" }}>
          {pre ?? ""}{last ? "\u2514\u2500 " : "\u251C\u2500 "}
        </span>
        {label && (
          <span className="cs-k" style={{ color: labelColor ?? C.dim }}>{label}</span>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className="neural-expand">

      {/* ── Header ── */}
      <div className="neural-expand-hdr">
        <span style={{ color: C.dim }}>┌─ CONSENSUS STEPS</span>
        <span style={{ color: steps?.length ? C.teal : C.dim }}>
          {steps === null && !csErr
            ? "fetching\u2026"
            : csErr
            ? "error"
            : `${steps.length} steps \u00B7 ${(tx.status ?? "?").toUpperCase()}`}
        </span>
      </div>

      {steps === null && !csErr && (
        <div className="neural-empty ne-scanning">querying consensus-steps…</div>
      )}
      {csErr && (
        <div className="neural-empty ne-error" style={{ color: C.red }}>
          ✗ CONSENSUS QUERY FAULT — tx may be in-flight or pre-finalized
        </div>
      )}

      {/* ══ STEP TREE ══════════════════════════════════════════════════════ */}
      {Array.isArray(steps) && steps.length > 0 && (
        <div className="cs-tree">
          {steps.map((step, si) => {
            const isLastStep = si === steps.length - 1;
            const name       = step.step ?? "Unknown";
            const sc         = STEP_COLORS[name] ?? C.dim;
            const delta      = si > 0 ? csDelta(t0, step.timestamp) : null;

            // Detail slots (in display order) for ├─ / └─ logic
            const slots = ["rollup", "status"];
            if (step.activator)                                                           slots.push("activator");
            if (step.leader)                                                              slots.push("leader");
            if (step.previous_leader)                                                     slots.push("prev_leader");
            if (step.appeal_initiator)                                                    slots.push("appeal");
            if ((step.validators?.length ?? 0) > 0 &&
                !(step.committed_votes?.length) && !(step.revealed_votes?.length))        slots.push("validators");
            if (step.data)                                                                slots.push("data");
            if ((step.committed_votes?.length ?? 0) > 0)                                 slots.push("committed");
            if ((step.revealed_votes?.length  ?? 0) > 0)                                 slots.push("revealed");

            const isLast  = (slot) => slots[slots.length - 1] === slot;
            const dPre    = isLastStep ? "   " : "\u2502  "; // "│  " when more steps follow

            // ── data block params ─────────────────────────────────────────
            let dataRows = [];
            let calldataStr = null;
            if (step.data) {
              const fn = step.data.function;
              const p  = step.data.params ?? {};
              if (p._txId != null)             dataRows.push({ k: "_txId",           v: shortHash(p._txId),                        c: C.teal   });
              if (p._nonce != null)            dataRows.push({ k: "_nonce",          v: Number(p._nonce).toExponential(3),          c: C.number });
              if (p._validatorIndex != null)   dataRows.push({ k: "_validatorIndex", v: String(p._validatorIndex),                 c: C.number });
              if (p._voteType != null)         dataRows.push({ k: "_voteType",       v: String(p._voteType),                       c: C.number });
              if (p._voteHash)                 dataRows.push({ k: "_voteHash",       v: shortHash(p._voteHash),                    c: C.dim    });
              if (p._otherExecutionFieldsHash) dataRows.push({ k: "_otherExecHash",  v: shortHash(p._otherExecutionFieldsHash),     c: C.dim    });
              const cdRaw = p.encoded_data?.calldata?.content;
              if (cdRaw) {
                try {
                  calldataStr = atob(cdRaw)
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "\xB7")
                    .slice(0, 160);
                  dataRows.push({ k: "calldata", v: calldataStr, c: C.str });
                } catch { /* ignore */ }
              }
            }

            return (
              <React.Fragment key={step.id ?? si}>

                {/* ── Step header line ── */}
                <div className="cs-step-hdr">
                  <span style={{ color: "#505060" }}>
                    {isLastStep ? "\u2514\u2500" : "\u251C\u2500"}
                  </span>
                  <span style={{ color: sc }}> \u25CF {name}</span>
                  <span className="cs-ts" style={{ color: "#80809a" }}>
                    {csTs(step.timestamp)}
                    {delta && <span style={{ color: "#484858", marginLeft: 6 }}>{delta}</span>}
                  </span>
                </div>

                {/* rollup hash + block */}
                <div className="cs-row">
                  <span className="cs-pre" style={{ color: "#404058" }}>
                    {dPre}{isLast("rollup") ? "\u2514\u2500 " : "\u251C\u2500 "}
                  </span>
                  <span className="cs-k">rollup</span>
                  <span style={{ color: C.dim }}>{shortHash(step.rollup_transaction_hash ?? "")}</span>
                  <span style={{ color: C.number, marginLeft: 6 }}>
                    blk #{(step.rollup_block ?? 0).toLocaleString()}
                  </span>
                </div>

                {/* status */}
                <div className="cs-row">
                  <span className="cs-pre" style={{ color: "#404058" }}>
                    {dPre}{isLast("status") ? "\u2514\u2500 " : "\u251C\u2500 "}
                  </span>
                  <span className="cs-k">status</span>
                  <span style={{ color: STATUS_COLORS[(step.status ?? "").toUpperCase()] ?? C.dim }}>
                    {(step.status ?? "?").toUpperCase()}
                  </span>
                </div>

                {/* activator */}
                {step.activator && (
                  <div className="cs-row">
                    <span className="cs-pre" style={{ color: "#404058" }}>
                      {dPre}{isLast("activator") ? "\u2514\u2500 " : "\u251C\u2500 "}
                    </span>
                    <span className="cs-k">activator</span>
                    <span style={{ color: C.yellow }}>{shortAddr(step.activator)}</span>
                  </div>
                )}

                {/* leader */}
                {step.leader && (
                  <div className="cs-row">
                    <span className="cs-pre" style={{ color: "#404058" }}>
                      {dPre}{isLast("leader") ? "\u2514\u2500 " : "\u251C\u2500 "}
                    </span>
                    <span className="cs-k">leader</span>
                    <span style={{ color: C.yellow }}>{shortAddr(step.leader)}</span>
                  </div>
                )}

                {/* previous_leader */}
                {step.previous_leader && (
                  <div className="cs-row">
                    <span className="cs-pre" style={{ color: "#404058" }}>
                      {dPre}{isLast("prev_leader") ? "\u2514\u2500 " : "\u251C\u2500 "}
                    </span>
                    <span className="cs-k">prev_leader</span>
                    <span style={{ color: C.dim }}>{shortAddr(step.previous_leader)}</span>
                  </div>
                )}

                {/* appeal_initiator */}
                {step.appeal_initiator && (
                  <div className="cs-row">
                    <span className="cs-pre" style={{ color: "#404058" }}>
                      {dPre}{isLast("appeal") ? "\u2514\u2500 " : "\u251C\u2500 "}
                    </span>
                    <span className="cs-k">appeal_by</span>
                    <span style={{ color: C.red }}>{shortAddr(step.appeal_initiator)}</span>
                  </div>
                )}

                {/* validators (summary, only when no vote sub-trees follow) */}
                {(step.validators?.length ?? 0) > 0 && !step.committed_votes?.length && !step.revealed_votes?.length && (
                  <div className="cs-row">
                    <span className="cs-pre" style={{ color: "#404058" }}>
                      {dPre}{isLast("validators") ? "\u2514\u2500 " : "\u251C\u2500 "}
                    </span>
                    <span className="cs-k">validators</span>
                    <span style={{ color: C.dim }}>{step.validators.length}</span>
                    <span style={{ color: "#484858", fontSize: "9px", marginLeft: 4 }}>
                      {step.validators.slice(0, 2).map(shortAddr).join("  ")}
                      {step.validators.length > 2 ? `  +${step.validators.length - 2}` : ""}
                    </span>
                  </div>
                )}

                {/* data block */}
                {step.data && (() => {
                  const dataIsLast = isLast("data");
                  const dp = dPre + (dataIsLast ? "   " : "\u2502  ");
                  return (
                    <>
                      <div className="cs-row">
                        <span className="cs-pre" style={{ color: "#404058" }}>
                          {dPre}{dataIsLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                        </span>
                        <span className="cs-k">data.fn</span>
                        <span style={{ color: C.fn }}>{step.data.function ?? "?"}</span>
                      </div>
                      {dataRows.map((r, ri) => (
                        <div key={ri} className="cs-row">
                          <span className="cs-pre" style={{ color: "#404058" }}>
                            {dp}{ri === dataRows.length - 1 ? "\u2514\u2500 " : "\u251C\u2500 "}
                          </span>
                          <span className="cs-k cs-k-sm">{r.k}</span>
                          <span style={{ color: r.c, wordBreak: "break-all" }}>{r.v}</span>
                        </div>
                      ))}
                    </>
                  );
                })()}

                {/* committed_votes */}
                {(step.committed_votes?.length ?? 0) > 0 && (() => {
                  const cvIsLast = isLast("committed");
                  const cvPre   = dPre + (cvIsLast ? "   " : "\u2502  ");
                  return (
                    <>
                      <div className="cs-row">
                        <span className="cs-pre" style={{ color: "#404058" }}>
                          {dPre}{cvIsLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                        </span>
                        <span className="cs-k" style={{ color: C.orange }}>committed_votes</span>
                        <span style={{ color: C.dim }}>{step.committed_votes.length}</span>
                      </div>
                      {step.committed_votes.map((v, vi) => {
                        const vLast = vi === step.committed_votes.length - 1;
                        return (
                          <div key={vi} className="cs-row">
                            <span className="cs-pre" style={{ color: "#404058" }}>
                              {cvPre}{vLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                            </span>
                            <span className="cs-k">[{vi}]</span>
                            <span style={{ color: C.cyan }}>{shortAddr(v.address)}</span>
                            <span style={{ color: C.dim, marginLeft: 4 }}>{shortHash(v.tx_hash ?? "")}</span>
                            <span style={{ color: C.number, fontSize: "9px", marginLeft: 4 }}>
                              blk #{parseInt(v.block_number ?? "0", 10).toLocaleString()}
                            </span>
                            {v.is_last_vote && (
                              <span style={{ color: C.orange, fontSize: "9px", marginLeft: 4, fontWeight: 700 }}>LAST</span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {/* revealed_votes */}
                {(step.revealed_votes?.length ?? 0) > 0 && (() => {
                  const rvPre = dPre + "   ";
                  return (
                    <>
                      <div className="cs-row">
                        <span className="cs-pre" style={{ color: "#404058" }}>
                          {dPre}\u2514\u2500{" "}
                        </span>
                        <span className="cs-k" style={{ color: C.purple }}>revealed_votes</span>
                        <span style={{ color: C.dim }}>{step.revealed_votes.length}</span>
                      </div>
                      {step.revealed_votes.map((v, vi) => {
                        const ev      = (v.effective_vote ?? "?").toUpperCase();
                        const vc      = ev === "AGREE" ? C.lgreen : ev === "DISAGREE" ? C.red : ev === "TIMEOUT" ? C.orange : C.dim;
                        const icon    = ev === "AGREE" ? "\u2713" : ev === "DISAGREE" ? "\u2717" : ev === "TIMEOUT" ? "\u29D6" : "\xB7";
                        const vLast   = vi === step.revealed_votes.length - 1;
                        const vSubPre = rvPre + (vLast ? "   " : "\u2502  ");
                        return (
                          <React.Fragment key={vi}>
                            {/* vote: address + verdict */}
                            <div className="cs-row">
                              <span className="cs-pre" style={{ color: "#404058" }}>
                                {rvPre}{vLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                              </span>
                              <span className="cs-k">[{vi}]</span>
                              <span style={{ color: C.cyan }}>{shortAddr(v.address)}</span>
                              <span style={{ color: vc, marginLeft: 6, fontWeight: 700 }}>{icon} {ev}</span>
                              <span style={{ color: C.dim, fontSize: "9px", marginLeft: 4 }}>type={v.vote_type}</span>
                              {v.is_last_vote && (
                                <span style={{ color: C.orange, fontSize: "9px", marginLeft: 4, fontWeight: 700 }}>LAST</span>
                              )}
                            </div>
                            {/* vote: tx_hash + block */}
                            <div className="cs-row cs-row-sub">
                              <span className="cs-pre" style={{ color: "#404058" }}>
                                {vSubPre}\u2514\u2500{"  "}
                              </span>
                              <span style={{ color: "#404058", fontSize: "9px" }}>tx </span>
                              <span style={{ color: C.dim, fontSize: "9px" }}>{shortHash(v.tx_hash ?? "")}</span>
                              <span style={{ color: C.number, fontSize: "9px", marginLeft: 4 }}>
                                blk #{parseInt(v.block_number ?? "0", 10).toLocaleString()}
                              </span>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </>
                  );
                })()}

                {/* Pipe spacer between steps for readability */}
                {!isLastStep && (
                  <div className="cs-pipe">
                    <span style={{ color: "#3c3c50" }}>\u2502</span>
                  </div>
                )}

              </React.Fragment>
            );
          })}
        </div>
      )}

      {Array.isArray(steps) && steps.length === 0 && !enrichment && (
        <div className="neural-empty ne-pending">no consensus data yet — tx pending</div>
      )}

      {/* ══ ENRICHMENT DATA ═══════════════════════════════════════════════ */}
      {enrichment && (
        <div className="cs-enrich">
          <div className="cs-section-hdr" style={{ color: "#404058" }}>
            \u2500\u2500 ENRICHMENT DATA
            \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          </div>

          {(enrichment.rounds ?? []).map((round, ri) => {
            const rounds     = enrichment.rounds;
            const rLast      = ri === rounds.length - 1;
            const rIsLast    = rLast && !hasTraces;
            const rPre       = rIsLast ? "   " : "\u2502  ";
            const resultGood = (round.result ?? "").includes("agree");
            const roundVals  = round.validators ?? [];

            return (
              <React.Fragment key={ri}>
                {/* round header */}
                <div className="cs-row">
                  <span className="cs-pre" style={{ color: "#404058" }}>
                    {rIsLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                  </span>
                  <span className="cs-k" style={{ color: C.keyword }}>rounds[{ri}]</span>
                  <span style={{ color: resultGood ? C.lgreen : C.red }}>{round.result ?? "?"}</span>
                  <span style={{ color: C.dim, fontSize: "9px", marginLeft: 6 }}>
                    {round.votes_revealed ?? "?"}/{round.votes_committed ?? "?"} votes
                    {round.leader_index != null ? `  leader_idx=${round.leader_index}` : ""}
                    {round.rotations_left != null ? `  rotations_left=${round.rotations_left}` : ""}
                  </span>
                </div>

                {/* round validators */}
                {roundVals.length > 0 && (
                  <>
                    <div className="cs-row">
                      <span className="cs-pre" style={{ color: "#404058" }}>
                        {rPre}\u2514\u2500{" "}
                      </span>
                      <span className="cs-k">validators</span>
                      <span style={{ color: C.dim }}>{roundVals.length}</span>
                    </div>
                    {roundVals.map((rv, rvi) => {
                      const isLeader = rvi === round.leader_index;
                      const rvLast   = rvi === roundVals.length - 1;
                      const vc       = rv.vote === "timeout" ? C.orange
                                     : rv.vote?.includes("error") ? C.red
                                     : C.lgreen;
                      return (
                        <div key={rvi} className="cs-row">
                          <span className="cs-pre" style={{ color: "#404058" }}>
                            {rPre + "   "}{rvLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                          </span>
                          <span className="cs-k">[{rvi}]</span>
                          <span style={{ color: C.cyan }}>{shortAddr(rv.address)}</span>
                          <span style={{ color: vc, marginLeft: 4, fontSize: "10px" }}>{rv.vote ?? "?"}</span>
                          {isLeader && (
                            <span style={{ color: C.yellow, fontSize: "8px", display: "block" }}>\u2605 LEADER</span>
                          )}
                          <span style={{ color: C.dim, fontSize: "9px", marginLeft: 6 }}>
                            res={shortHash(rv.result_hash ?? "")}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </React.Fragment>
            );
          })}

          {/* traces (keyed object: { "0": {...}, "1": {...} }) */}
          {hasTraces && (
            <>
              <div className="cs-row">
                <span className="cs-pre" style={{ color: "#404058" }}>\u2514\u2500 </span>
                <span className="cs-k">traces</span>
                <span style={{ color: C.dim }}>{traceEntries.length}</span>
              </div>
              {traceEntries.map(([k, t], ti) => {
                const tLast    = ti === traceEntries.length - 1;
                const tPre     = "   ";
                const tSubPre  = tPre + (tLast ? "   " : "\u2502  ");
                const rc       = t.result_code;
                const vc       = rc === 0 ? C.lgreen : rc === 1 ? C.orange : C.red;

                // trace sub-rows
                const tSubs = [];
                if (t.storage_proof)     tSubs.push({ k: "storage", v: shortHash(t.storage_proof),  c: C.dim    });
                if (t.stderr !== undefined) tSubs.push({ k: "stderr",  v: t.stderr  || "(empty)",  c: t.stderr  ? C.red    : C.dim });
                if (t.stdout !== undefined) tSubs.push({ k: "stdout",  v: t.stdout  || "(empty)",  c: t.stdout  ? C.lgreen : C.dim });

                return (
                  <React.Fragment key={k}>
                    <div className="cs-row">
                      <span className="cs-pre" style={{ color: "#404058" }}>
                        {tPre}{tLast ? "\u2514\u2500 " : "\u251C\u2500 "}
                      </span>
                      <span className="cs-k">[{k}]</span>
                      <span style={{ color: vc, fontWeight: 700 }}>{t.result_label ?? "?"}</span>
                      <span style={{ color: C.dim, fontSize: "9px", marginLeft: 4 }}>(code={rc ?? "?"})</span>
                      <span style={{ color: C.number, fontSize: "9px", marginLeft: 6 }}>run={t.run_time ?? "?"}</span>
                    </div>
                    {tSubs.map((s, si) => (
                      <div key={si} className="cs-row">
                        <span className="cs-pre" style={{ color: "#404058" }}>
                          {tSubPre}{si === tSubs.length - 1 ? "\u2514\u2500 " : "\u251C\u2500 "}
                        </span>
                        <span className="cs-k cs-k-sm">{s.k}</span>
                        <span style={{ color: s.c, fontSize: "9px", wordBreak: "break-all" }}>{s.v}</span>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Standard TX row with always-visible detail panel ─────────────────────────
// extra: null=loading, false=failed, obj=data — provided by useGenLayer's batch fetcher
function StandardTxRow({ tx, extra }) {

  if (!tx) return null;

  // Use individual-fetch data when available; list-fetch data as immediate fallback
  const from   = extra?.from        ?? tx.from;
  const to     = extra?.to          ?? tx.to;
  const value  = extra?.value       ?? tx.value;
  const fee    = extra?.fee         ?? tx.fee;
  const block  = extra?.blockNumber ?? tx.blockNumber;
  const revert = extra?.revertReason ?? extra?.error ?? null;

  const isFailed    = tx.isError || extra?.status === "failed" || Boolean(extra?.error);
  const sc          = isFailed ? C.red : (STATUS_COLORS[tx.status ?? ""] ?? C.dim);
  const mc          = METHOD_COLORS[tx.method ?? ""] ?? C.dim;
  const statusLabel = isFailed ? "FAILED" : (tx.status ?? "?");
  const statusIcon  = isFailed ? "\u2717" : (STATUS_ICON[tx.status ?? ""] ?? "\xB7");

  const details = [
    { k: "from", v: shortAddr(from ?? ""),                        c: C.cyan   },
    { k: "to  ", v: to ? shortAddr(to) : "\u2500 contract create \u2500", c: to ? C.cyan : C.dim },
    { k: "val ", v: fmtNative(value),                             c: C.number },
    { k: "fee ", v: fmtNative(fee),                               c: C.dim    },
    { k: "blk ", v: `#${(block ?? 0).toLocaleString()}`,          c: C.number },
    ...(revert ? [{ k: "err ", v: String(revert).slice(0, 80),    c: C.red    }] : []),
  ];

  return (
    <div className={`std-tx-block${isFailed ? " std-tx-failed" : ""}`}>

      {/* ── Header row ── */}
      <div className="std-tx-row">
        <span className="std-hash" style={{ color: isFailed ? C.red : C.teal }}>
          {shortHash(tx.hash)}
        </span>
        <span className="std-method" style={{ color: mc }}>{tx.method ?? "?"}()</span>
        <span className="std-age"   style={{ color: C.number }}>{timeAgo(tx.timestamp)}</span>
        <span className="std-status" style={{ color: sc }}>{statusIcon} {statusLabel}</span>
      </div>

      {/* ── Always-visible detail tree ── */}
      <div className="std-tx-detail">
        {details.map((d, i) => {
          const isLast = i === details.length - 1 && extra !== null;
          return (
            <div key={d.k} className="std-d-row">
              <span className="std-d-branch">
                {isLast ? "\u2514\u2500" : "\u251C\u2500"}
              </span>
              <span className="std-d-k">{d.k}</span>
              <span style={{ color: d.c, wordBreak: "break-all" }}>{d.v}</span>
            </div>
          );
        })}
        {extra === null && (
          <div className="std-d-row">
            <span className="std-d-branch">{"\u2514\u2500"}</span>
            <span style={{ color: "#404058" }}>enriching\u2026</span>
          </div>
        )}
      </div>

    </div>
  );
}

// ── AI TX row — always auto-expanded, no toggle button ────────────────────────
function AiTxRow({ tx }) {
  if (!tx) return null;
  const sc = STATUS_COLORS[tx.status ?? ""] ?? C.dim;
  const mc = METHOD_COLORS[tx.method  ?? ""] ?? C.teal;
  return (
    <div className="ai-tx-block">
      <div className="ai-tx-hdr">
        <span className="tx-gl-glyph">\u2B21</span>
        <span style={{ color: C.teal }}>{shortHash(tx.hash)}</span>
        <span style={{ color: mc, marginLeft: 6, fontSize: "10px" }}>{tx.method ?? "?"}()</span>
        <span style={{ color: C.number, fontSize: "9px", marginLeft: 6 }}>{timeAgo(tx.timestamp)}</span>
        <span style={{ color: sc, fontWeight: 700, fontSize: "10px", marginLeft: "auto" }}>
          {STATUS_ICON[tx.status ?? ""] ?? "\xB7"} {tx.status ?? "PENDING"}
        </span>
      </div>
      <NeuralExpand tx={tx} />
    </div>
  );
}

// ── AI method names that require neural consensus ─────────────────────────────
const AI_METHODS = new Set([
  "addtransaction", "committransaction", "revealtransaction",
  "addTransaction",  "commitTransaction",  "revealTransaction",
  "committransactionreceipt", "revealtransactionreceipt",
  "commitvote", "revealvote", "finalizetransaction",
  "commitVote", "revealVote", "finalizeTransaction",
  "gen_call", "gen_run", "gen_execute", "gen_deploy",
]);

function isAiTx(tx) {
  if (!tx) return false;
  // 1. Method name matches known AI consensus methods
  const m = (tx.method ?? tx.functionName ?? "").toLowerCase();
  if (AI_METHODS.has(tx.method) || AI_METHODS.has(m)) return true;
  // 2. Has real validators assigned (consensus participants)
  if ((tx.validators?.length ?? 0) > 0) return true;
  // 3. Has enrichment data (LLM execution traces)
  if (tx.enrichmentData != null) return true;
  // 4. Stage is beyond PENDING (consensus in progress)
  if ((tx.stageIdx ?? 0) > 0) return true;
  return false;
}

// ── Scanning status ticker for column headers ────────────────────────────────
const AI_SCAN_MSGS  = ["scanning consensus…", "fetching latest tx…", "indexing validators…", "syncing leader pool…"];
const STD_SCAN_MSGS = ["fetching transfers…", "indexing blocks…",   "scanning mempool…",   "syncing chain state…"];

function ScanningText({ messages, color }) {
  const [idx, setIdx]         = useState(0);
  const [vis, setVis]         = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      setVis(false);
      setTimeout(() => { setIdx(i => (i + 1) % messages.length); setVis(true); }, 280);
    }, 2400);
    return () => clearInterval(id);
  }, [messages.length]);
  return (
    <span style={{
      color, fontSize: 8, fontFamily: "var(--mono)", letterSpacing: "0.04em",
      fontStyle: "italic", marginLeft: 8,
      opacity: vis ? 1 : 0, transition: "opacity 0.28s ease",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>
      {messages[idx]}
    </span>
  );
}

// ── Command Center — 50/50 two-column layout ──────────────────────────────────
function CommandCenter({ txFeed, standardTxs, standardDetails }) {
  // AI txs: filter Bradbury feed by isAiTx
  const aiTxs = useMemo(() =>
    (txFeed ?? []).filter(isAiTx),
    [txFeed]
  );

  // Both columns must have data before we show content
  if (txFeed === null && standardTxs === null)
    return <Awaiting label="connecting to network\u2026" />;

  return (
    <div className="cmd-center">

      {/* ── Left: Neural Consensus ── */}
      <div className="cmd-col">
        <div className="cmd-col-hdr">
          <span style={{ color: C.dim }}>&gt;_</span>
          <span style={{ color: "#38bdf8", marginLeft: 5 }}>CONSENSUS TREE</span>
          <ScanningText messages={AI_SCAN_MSGS} color="rgba(56,189,248,0.45)" />
          <span className="cmd-col-count" style={{ color: "#38bdf8" }}>{aiTxs.length} AI</span>
        </div>
        <div className="cmd-col-body">
          {aiTxs.length === 0 ? (
            <div className="tx-empty" style={{ color: C.dim }}>\u25CC awaiting AI consensus txs</div>
          ) : aiTxs.map((tx, i) => (
            <AiTxRow key={tx?.hash ?? i} tx={tx} />
          ))}
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="cmd-divider" />

      {/* ── Right: Standard Transfers (live from explorer-api) ── */}
      <div className="cmd-col">
        <div className="cmd-col-hdr">
          <span style={{ color: C.dim }}>&gt;_</span>
          <span style={{ color: C.teal, marginLeft: 5 }}>STANDARD TRANSFERS</span>
          <ScanningText messages={STD_SCAN_MSGS} color="rgba(78,201,176,0.45)" />
          <span className="cmd-col-count">{standardTxs?.length ?? "\u2026"}</span>
        </div>
        <div className="cmd-col-body">
          {standardTxs === null ? (
            <Awaiting label="Searching for transactions\u2026" />
          ) : standardTxs.length === 0 ? (
            <div className="tx-empty" style={{ color: C.dim }}>\u25CC no standard txs</div>
          ) : standardTxs.map((tx, i) => (
            <StandardTxRow key={tx?.hash ?? i} tx={tx} extra={standardDetails?.[tx?.hash] ?? null} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB 2 — validators.json
// ─────────────────────────────────────────────────────────────────────────────
function ValidatorRegistry({ networkValidators }) {
  if (networkValidators === null) return <Awaiting label="fetching validators\u2026" />;

  const active  = networkValidators.filter(v => v?.is_active !== false);
  const inactive = networkValidators.filter(v => v?.is_active === false);

  return (
    <div className="vr-body">
      {/* sticky header */}
      <div className="vr-hdr-row">
        <span className="vr-col vr-name-col">NAME / ADDRESS</span>
        <span className="vr-col vr-stake-col">STAKE</span>
        <span className="vr-col vr-apy-col">APY</span>
        <span className="vr-col vr-votes-col">VOTES 7D</span>
        <span className="vr-col vr-status-col">STATUS</span>
      </div>

      {networkValidators.length === 0 ? (
        <div className="tx-empty" style={{ color: C.dim }}>\u25CC No validators</div>
      ) : (
        networkValidators.map((v, i) => {
          if (!v) return null;
          const addr    = v.validator_address ?? "";
          const name    = v.metadata?.name ?? shortAddr(addr);
          const isAct   = v.is_active !== false && v.status !== "inactive";
          const isPrimed = v.is_primed_next_epoch;
          const live    = v.live;
          const strikes = v.strikes_current;
          const strikesMax = v.strikes_max;

          return (
            <div key={addr || i} className={`vr-row${isAct ? " vr-active" : ""}`}>
              {/* NAME + ADDRESS stacked */}
              <span className="vr-col vr-name-col">
                <span style={{ color: isAct ? C.cyan : C.dim, fontWeight: 600 }}>
                  {name}
                </span>
                <span style={{ color: "#404058", fontSize: "9px", display: "block" }}>
                  {shortAddr(addr)}
                </span>
              </span>

              {/* STAKE */}
              <span className="vr-col vr-stake-col" style={{ color: C.number }}>
                {fmtGenStake(v.self_stake)}
              </span>

              {/* APY */}
              <span className="vr-col vr-apy-col" style={{ color: isAct ? C.lgreen : C.dim }}>
                {v.apy ?? "\u2014"}
              </span>

              {/* VOTES 7D */}
              <span className="vr-col vr-votes-col" style={{ color: C.number }}>
                {v.total_votes_7d ?? "\u2014"}
                {v.minority_votes_7d > 0 && (
                  <span style={{ color: C.red, fontSize: "9px", marginLeft: 3 }}>
                    ({v.minority_votes_7d} min)
                  </span>
                )}
              </span>

              {/* STATUS */}
              <span className="vr-col vr-status-col">
                <span style={{ color: isAct ? C.lgreen : C.dim, fontSize: "10px", fontWeight: 700 }}>
                  {isAct ? "\u25CF ACTIVE" : "\u25CB IDLE"}
                </span>
                {isPrimed && (
                  <span style={{ color: C.yellow, fontSize: "8px", display: "block" }}>\u25B2 PRIMED</span>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB 3 — network_epoch.sys
// ─────────────────────────────────────────────────────────────────────────────
function EpochStatus({ epochData, networkValidators }) {
  if (epochData === null) return <Awaiting label="fetching epochs\u2026" />;

  const epochs = Array.isArray(epochData) ? epochData : [];
  const current = epochs.find(e => e.state === "current") ?? epochs[0];
  const past    = epochs.filter(e => e.state !== "current");
  const now     = Math.floor(Date.now() / 1000);

  if (!current && !past.length) return <Awaiting label="no epoch data yet \u2014 chain syncing\u2026" />;

  function progress(ep) {
    if (!ep?.started_at || !ep?.min_duration) return null;
    return Math.min(1, (now - ep.started_at) / ep.min_duration);
  }

  function epochBar(p, w = 24) {
    if (p == null) return null;
    const n = Math.round(p * w);
    return "\u2588".repeat(n) + "\u2591".repeat(w - n) + " " + (p * 100).toFixed(0) + "%";
  }

  function epochDuration(ep) {
    if (!ep?.started_at) return "\u2014";
    const end   = ep.finalized_at ?? now;
    const secs  = end - ep.started_at;
    const h     = Math.floor(secs / 3600);
    const m     = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className="epoch-body">

      {/* ── Current Epoch ── */}
      {current && (
        <>
          <div className="epoch-section-hdr" style={{ color: C.keyword }}>
            \u2550\u2550 CURRENT EPOCH #{current.epoch_number}
          </div>

          <div className="epoch-row">
            <span className="epoch-key">STATE</span>
            <span className="epoch-val" style={{ color: C.lgreen }}>
              \u25CF {(current.state ?? "?").toUpperCase()}
            </span>
          </div>

          {(() => {
            const p = progress(current);
            const bar = epochBar(p);
            return bar ? (
              <div className="epoch-row epoch-bar-row">
                <span className="epoch-key">PROGRESS</span>
                <span className="epoch-val" style={{ color: C.teal, fontFamily: "var(--mono)" }}>{bar}</span>
              </div>
            ) : null;
          })()}

          <div className="epoch-row">
            <span className="epoch-key">STARTED</span>
            <span className="epoch-val" style={{ color: C.str }}>{fmtTime(current.started_at * 1000)}</span>
          </div>

          <div className="epoch-row">
            <span className="epoch-key">MIN DURATION</span>
            <span className="epoch-val" style={{ color: C.dim }}>
              {current.min_duration ? `${(current.min_duration / 3600).toFixed(0)}h` : "\u2014"}
            </span>
          </div>

          <div className="epoch-row">
            <span className="epoch-key">VALIDATORS</span>
            <span className="epoch-val" style={{ color: C.number }}>{current.active_validator_count ?? "\u2014"}</span>
          </div>

          <div className="epoch-row">
            <span className="epoch-key">TOTAL STAKED</span>
            <span className="epoch-val" style={{ color: C.number }}>{fmtGenStake(current.total_staked)}</span>
          </div>

          {current.inflation !== "0" && (
            <div className="epoch-row">
              <span className="epoch-key">INFLATION</span>
              <span className="epoch-val" style={{ color: C.yellow }}>{fmtGenStake(current.inflation)}</span>
            </div>
          )}
        </>
      )}

      {/* ── Past Epochs ── */}
      {past.length > 0 && (
        <>
          <div className="epoch-divider" />
          <div className="epoch-section-hdr" style={{ color: C.keyword }}>\u2550\u2550 EPOCH HISTORY</div>
          {past.map((ep, i) => (
            <div key={ep.epoch_number ?? i} className="epoch-hist-row">
              <span style={{ color: C.dim, fontSize: "10px", minWidth: 52 }}>
                #{ep.epoch_number}
              </span>
              <span style={{ color: C.dim, fontSize: "10px", minWidth: 72 }}>
                {fmtTime(ep.started_at * 1000)}
              </span>
              <span style={{ color: C.number, fontSize: "10px", minWidth: 40 }}>
                {ep.active_validator_count}v
              </span>
              <span style={{ color: C.teal, fontSize: "10px" }}>
                {epochDuration(ep)}
              </span>
              {ep.inflation && ep.inflation !== "0" && (
                <span style={{ color: C.yellow, fontSize: "9px", marginLeft: 6 }}>
                  +{fmtGenStake(ep.inflation)}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Neural log terminal (secondary tab inside tx_stream)
// ─────────────────────────────────────────────────────────────────────────────
const LogLine = React.memo(function LogLine({ log }) {
  if (!log) return null;
  return (
    <div className="log-line">
      {log.ts ? <span className="log-ts">{log.ts}</span> : <span className="log-ts-empty" />}
      {(log.spans ?? []).map((s, i) => (
        <span key={i} style={{ color: s?.color }}>{s?.text ?? ""}</span>
      ))}
    </div>
  );
});

function NeuralLogTerminal({ logs }) {
  const ref = useRef(null);
  const atBottom = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);
  useEffect(() => {
    if (atBottom.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  return (
    <div className="terminal-body" ref={ref} onScroll={onScroll}>
      {(logs ?? []).map((log, i) => <LogLine key={log?.id ?? i} log={log} />)}
      <div className="terminal-cursor">\u258B</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAB 4 — analytics.chart
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsChart({ analyticsData }) {
  if (analyticsData === null) return <Awaiting label="fetching kpi-histories\u2026" />;
  if (!analyticsData.length)  return <Awaiting label="no analytics data" />;

  const vals   = analyticsData.map(d => parseFloat(d.value) || 0);
  const maxVal = Math.max(...vals, 1);
  const total  = vals.reduce((a, b) => a + b, 0);
  const avg    = total / vals.length;
  const peak   = Math.max(...vals);
  const peakIdx = vals.indexOf(peak);
  const latest = vals[vals.length - 1] ?? 0;

  const BAR_W  = 3;
  const BAR_GAP = 1;
  const H      = 72;
  const svgW   = analyticsData.length * (BAR_W + BAR_GAP);

  // Day tick labels: every 24th data point
  const dayTicks = analyticsData
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i % 24 === 0);

  return (
    <div className="analytics-body">

      <div className="analytics-hdr">
        <span style={{ color: C.keyword, fontWeight: 700 }}>
          \u2550\u2550 FINALIZED TRANSACTIONS / HOUR
        </span>
        <span style={{ color: C.dim, fontSize: "9px" }}>7d \u00B7 H1 \u00B7 {analyticsData.length} pts</span>
      </div>

      {/* KPI strip */}
      <div className="analytics-kpi">
        <div className="a-kpi">
          <span className="a-kpi-k">PEAK</span>
          <span style={{ color: C.red }}>{peak.toFixed(0)}/h</span>
        </div>
        <div className="a-kpi">
          <span className="a-kpi-k">TOTAL</span>
          <span style={{ color: C.number }}>{total.toFixed(0)}</span>
        </div>
        <div className="a-kpi">
          <span className="a-kpi-k">AVG/H</span>
          <span style={{ color: C.dim }}>{avg.toFixed(1)}</span>
        </div>
        <div className="a-kpi">
          <span className="a-kpi-k">LATEST</span>
          <span style={{ color: C.teal }}>{latest.toFixed(0)}/h</span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="analytics-chart-wrap">
        <svg
          viewBox={`0 0 ${svgW} ${H + 16}`}
          preserveAspectRatio="none"
          className="analytics-svg"
        >
          {/* Subtle grid lines */}
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p} x1="0" y1={H * (1 - p)} x2={svgW} y2={H * (1 - p)}
              stroke="#252526" strokeWidth="0.5" />
          ))}

          {/* Bars */}
          {vals.map((v, i) => {
            const barH  = Math.max(1, (v / maxVal) * H);
            const x     = i * (BAR_W + BAR_GAP);
            const y     = H - barH;
            const isPeak = i === peakIdx;
            const isLast = i === vals.length - 1;
            const alpha  = 0.2 + 0.8 * (v / maxVal);
            const fill   = isPeak ? "#f44747"
                         : isLast ? "#9cdcfe"
                         : `rgba(78,201,176,${alpha.toFixed(2)})`;
            return <rect key={i} x={x} y={y} width={BAR_W} height={barH} fill={fill} />;
          })}

          {/* X-axis day labels */}
          {dayTicks.map(({ i, d }) => {
            const x = i * (BAR_W + BAR_GAP);
            const label = new Date(d.timestamp * 1000)
              .toLocaleDateString("en-GB", { month: "short", day: "numeric" });
            return (
              <text key={i} x={x + 1} y={H + 12} fill="#505060"
                fontSize="6" fontFamily="monospace">{label}</text>
            );
          })}

          {/* Peak marker line */}
          {peakIdx >= 0 && (
            <line
              x1={peakIdx * (BAR_W + BAR_GAP) + BAR_W / 2}
              y1="0"
              x2={peakIdx * (BAR_W + BAR_GAP) + BAR_W / 2}
              y2={H}
              stroke="rgba(244,71,71,0.3)"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
          )}
        </svg>
      </div>

      {/* Y-axis legend */}
      <div className="analytics-legend">
        <span style={{ color: "#404058" }}>0</span>
        <span style={{ color: C.dim }}>{(maxVal / 2).toFixed(0)}</span>
        <span style={{ color: C.dim }}>{peak.toFixed(0)} peak</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Stage breadcrumb bar
// ─────────────────────────────────────────────────────────────────────────────
function StageBar({ stage, pulseStageIdx }) {
  const s = stage ?? STAGES[0];
  return (
    <div className="stage-bar">
      <div className="stage-crumbs">
        {STAGES.map((st, i) => (
          <span
            key={st.status}
            className={`stage-crumb${i === pulseStageIdx ? " active" : ""}${i < pulseStageIdx ? " done" : ""}`}
            style={i === pulseStageIdx ? { color: st.color, borderBottomColor: st.color } : {}}
            title={st.label}
          >
            {st.icon}
          </span>
        ))}
      </div>
      <span className="stage-label" style={{ color: s.color }}>
        {s.label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  DeepScan — address / hash isolation terminal
// ─────────────────────────────────────────────────────────────────────────────
function DeepScanRow({ tx, scanQuery }) {
  const [open, setOpen] = useState(false);
  const safe = (v) => (v != null ? String(v) : "—");
  const status = safe(tx?.status).toUpperCase();
  const mc = METHOD_COLORS[safe(tx?.method)] ?? C.dim;
  const sc = STATUS_COLORS[status] ?? C.dim;

  function hl(raw) {
    const s = safe(raw);
    if (!s || s === "—" || !scanQuery) return s;
    try {
      const q = scanQuery.toLowerCase();
      const i = s.toLowerCase().indexOf(q);
      if (i === -1) return s;
      return (
        <>{s.slice(0, i)}<span style={{ background: "rgba(56,189,248,0.18)", color: "#38bdf8", borderRadius: 2 }}>{s.slice(i, i + q.length)}</span>{s.slice(i + q.length)}</>
      );
    } catch { return s; }
  }

  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", fontSize: 10, fontFamily: "var(--mono)" }}>
        <span style={{ color: C.dim, width: 12, flexShrink: 0, fontSize: 8 }}>{open ? "▾" : "▸"}</span>
        <span style={{ color: sc, flexShrink: 0, fontSize: 8 }}>●</span>
        <span style={{ color: "#9cdcfe", width: 90, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tx?.hash ? safe(tx.hash).slice(0, 10) + "…" : "—"}
        </span>
        <span style={{ color: mc, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>
          {safe(tx?.method ?? "transfer")}()
        </span>
        <span style={{ color: sc, fontSize: 9, letterSpacing: "0.04em", flexShrink: 0 }}>
          {status || "?"}
        </span>
      </div>

      {open && (
        <div style={{ padding: "2px 10px 8px 30px", fontSize: 10, lineHeight: 1.9, fontFamily: "var(--mono)", background: "rgba(56,189,248,0.02)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div><span style={{ color: C.dim }}>HASH   </span><span style={{ color: "#9cdcfe", wordBreak: "break-all" }}>{hl(tx?.hash)}</span></div>
          <div><span style={{ color: C.dim }}>FROM   </span><span style={{ color: "#4ec9b0", wordBreak: "break-all" }}>{hl(tx?.from)}</span></div>
          <div><span style={{ color: C.dim }}>TO     </span><span style={{ color: "#4ec9b0", wordBreak: "break-all" }}>{hl(tx?.to)}</span></div>
          <div><span style={{ color: C.dim }}>METHOD </span><span style={{ color: mc }}>{safe(tx?.method ?? "—")}()</span></div>
          <div><span style={{ color: C.dim }}>STATUS </span><span style={{ color: sc }}>{status || "—"}</span></div>
          {tx?.blockNumber != null && <div><span style={{ color: C.dim }}>BLOCK  </span><span style={{ color: "#b5cea8" }}>#{Number(tx.blockNumber).toLocaleString()}</span></div>}
          {tx?.gasUsed     != null && <div><span style={{ color: C.dim }}>GAS    </span><span style={{ color: C.yellow }}>{Number(tx.gasUsed).toLocaleString()}</span></div>}
          {tx?.value       != null && <div><span style={{ color: C.dim }}>VALUE  </span><span style={{ color: C.lgreen }}>{fmtGenStake(tx.value)}</span></div>}
          {tx?.nonce       != null && <div><span style={{ color: C.dim }}>NONCE  </span><span style={{ color: "#b5cea8" }}>{safe(tx.nonce)}</span></div>}
          {tx?.timestamp        && <div><span style={{ color: C.dim }}>TIME   </span><span style={{ color: C.dim, fontStyle: "italic" }}>{fmtTime(tx.timestamp)}</span></div>}
        </div>
      )}
    </div>
  );
}

function DeepScanView({ txFeed, standardTxs }) {
  const [scanQuery, setScanQuery] = useState("");
  const [inputVal,  setInputVal]  = useState("");

  const corpus = useMemo(() => {
    const seen = new Set();
    return [...(txFeed ?? []), ...(standardTxs ?? [])].filter(tx => {
      if (!tx?.hash || seen.has(tx.hash)) return false;
      seen.add(tx.hash);
      return true;
    });
  }, [txFeed, standardTxs]);

  const hits = useMemo(() => {
    if (!scanQuery) return corpus;
    const q = scanQuery.toLowerCase();
    return corpus.filter(tx =>
      tx?.hash?.toLowerCase().includes(q) ||
      tx?.from?.toLowerCase().includes(q) ||
      tx?.to?.toLowerCase().includes(q)
    );
  }, [corpus, scanQuery]);

  function onSubmit(e) { e.preventDefault(); setScanQuery(inputVal.trim()); }
  function onClear()   { setScanQuery(""); setInputVal(""); }

  const btnBase = { fontFamily: "var(--mono)", fontSize: 9, padding: "2px 8px", cursor: "pointer", letterSpacing: "0.06em", border: "1px solid" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--mono)" }}>

      <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid var(--bdr)", flexShrink: 0 }}>
        <div style={{ color: "#2a2a3c", fontSize: 9, letterSpacing: "0.07em", marginBottom: 8, whiteSpace: "pre", overflow: "hidden" }}>
          {"── DEEP_SCAN TERMINAL ──────────────────────────────────────"}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#38bdf8", fontSize: 13, fontWeight: 700, flexShrink: 0, lineHeight: 1 }}>›</span>
          <span style={{ color: C.dim, fontSize: 9, flexShrink: 0, letterSpacing: "0.04em" }}>TARGET_ADDRESS:</span>
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            placeholder="0x… or hash fragment"
            autoComplete="off"
            spellCheck="false"
            style={{
              flex: 1, minWidth: 0,
              background: "transparent",
              border: "none",
              borderBottom: "1px solid rgba(56,189,248,0.3)",
              color: "#9cdcfe",
              fontFamily: "var(--mono)",
              fontSize: 10,
              outline: "none",
              padding: "1px 4px",
            }}
          />
          <button type="submit" style={{ ...btnBase, background: "rgba(56,189,248,0.08)", borderColor: "rgba(56,189,248,0.25)", color: "#38bdf8" }}>SCAN</button>
          {scanQuery && (
            <button type="button" onClick={onClear} style={{ ...btnBase, background: "rgba(244,71,71,0.08)", borderColor: "rgba(244,71,71,0.25)", color: C.red }}>CLR</button>
          )}
        </form>

        <div style={{ marginTop: 7, fontSize: 9, color: C.dim, fontStyle: "italic" }}>
          {scanQuery
            ? `⊘ ISOLATING “${scanQuery.length > 22 ? scanQuery.slice(0, 22) + "…" : scanQuery}” — ${hits.length} / ${corpus.length} tx`
            : `⊘ CORPUS: ${corpus.length} tx in memory — enter address or hash to isolate`}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
        {hits.length === 0 ? (
          <div style={{ padding: "20px 12px", color: C.dim, fontSize: 10, fontStyle: "italic" }}>
            ✗ NO TRACE FOUND — address unknown to corpus
          </div>
        ) : hits.map((tx, i) => (
          <DeepScanRow key={tx?.hash ?? i} tx={tx} scanQuery={scanQuery} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Root — ProExplorer
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "stream",    label: "tx_stream.log"      },
  { id: "neural",    label: "neural.log"          },
  { id: "validators",label: "validators.json"     },
  { id: "epoch",     label: "network_epoch.sys"   },
  { id: "analytics", label: "analytics.chart"     },
  { id: "deepscan",  label: "deep_transactions_scan.sys" },
];

export default function Dashboard({
  txFeed, standardTxs, standardDetails, toggleExpand,
  networkValidators, epochData,
  blockNumber, logs,
  stage, pulseStageIdx,
  analyticsData,
}) {
  const [activeTab, setActiveTab] = useState("stream");

  // Tick every 10 s so "Xs ago" stays fresh without a re-render flood
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const glCount = Array.isArray(txFeed) ? txFeed.filter(t => t?.isGenLayer).length : 0;

  return (
    <div className="panel-left">
      {/* Title bar */}
      <div className="ide-titlebar">
        <div className="ide-dots">
          <span className="ide-dot dot-red"   />
          <span className="ide-dot dot-yellow" />
          <span className="ide-dot dot-green"  />
        </div>
        <span className="ide-title">\u26A1 NEURAL TERMINAL<span style={{ fontSize: 8, color: '#46465a', fontWeight: 400, letterSpacing: '0.08em', marginLeft: 7, verticalAlign: 'middle' }}>[beta]</span></span>
        <span className="ide-block-num">
          {blockNumber ? `blk #${blockNumber.toLocaleString()}` : "— awaiting"}
        </span>
        <span className="glpro-titlebar-badge">
          \u2B21 GenLayer{glCount > 0 && <span style={{ color: '#38bdf8', marginLeft: 5 }}>{glCount} AI</span>}
        </span>
      </div>

      {/* Tab bar */}
      <div className="ide-tabs" role="tablist" aria-label="Neural Terminal tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            className={`ide-tab${activeTab === tab.id ? " ide-tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={e => {
              const ids = TABS.map(t => t.id);
              const cur = ids.indexOf(tab.id);
              if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(ids[(cur + 1) % ids.length]); }
              if (e.key === 'ArrowLeft')  { e.preventDefault(); setActiveTab(ids[(cur - 1 + ids.length) % ids.length]); }
            }}
          >
            {tab.label}
          </button>
        ))}
        <div className="ide-tab-filler" />
        <span className="ide-tab-info">
          {activeTab === "stream"     && `${Array.isArray(txFeed) ? txFeed.length : 0} txs`}
          {activeTab === "neural"     && `${(logs ?? []).length} lines`}
          {activeTab === "validators" && `${Array.isArray(networkValidators) ? networkValidators.length : 0} nodes`}
          {activeTab === "epoch"      && (Array.isArray(epochData) && epochData.length > 0 ? `epoch #${epochData.find(e => e.state === "current")?.epoch_number ?? epochData[0]?.epoch_number ?? "?"}` : "syncing")}
          {activeTab === "analytics" && `${(analyticsData ?? []).length} pts`}
          {activeTab === "deepscan"  && `${Array.isArray(txFeed) ? txFeed.length : 0}+${Array.isArray(standardTxs) ? standardTxs.length : 0} tx`}
        </span>
      </div>

      {/* Content */}
      <ErrorBoundary key={activeTab}>
        <div
          className="tab-content"
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === "stream"     && <CommandCenter txFeed={txFeed} standardTxs={standardTxs} standardDetails={standardDetails} />}
          {activeTab === "neural"     && <NeuralLogTerminal logs={logs} />}
          {activeTab === "validators" && <ValidatorRegistry networkValidators={networkValidators} />}
          {activeTab === "epoch"      && <EpochStatus epochData={epochData} networkValidators={networkValidators} />}
          {activeTab === "analytics" && <AnalyticsChart analyticsData={analyticsData} />}
          {activeTab === "deepscan"  && <DeepScanView txFeed={txFeed} standardTxs={standardTxs} />}
        </div>
      </ErrorBoundary>

      {/* Dragon stage breadcrumb */}
      <StageBar stage={stage} pulseStageIdx={pulseStageIdx} />
    </div>
  );
}
