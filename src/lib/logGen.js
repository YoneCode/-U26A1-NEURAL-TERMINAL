// ─── VS Code Dark+ colour palette ────────────────────────────────────────────
export const C = {
  dim:     '#6e7080',
  white:   '#e2e2e2',
  cyan:    '#9cdcfe',
  teal:    '#4ec9b0',
  keyword: '#569cd6',
  str:     '#ce9178',
  number:  '#b5cea8',
  fn:      '#dcdcaa',
  yellow:  '#e8c86d',
  green:   '#6db33f',
  lgreen:  '#89d185',
  red:     '#f44747',
  section: '#569cd6',
  purple:  '#c586c0',
  orange:  '#d7953e',
};

// ─── Unique-ID counter (module-level, survives re-renders) ────────────────────
let _uid = Date.now();
const nextId = () => ++_uid;

// ─── Timestamp ────────────────────────────────────────────────────────────────
export function nowTs() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ─── Equivalence progress bar ─────────────────────────────────────────────────
export function eqBar(score, w = 10) {
  const n = Math.round(Math.max(0, Math.min(1, score)) * w);
  return '█'.repeat(n) + '░'.repeat(w - n);
}

// ─── Block log ────────────────────────────────────────────────────────────────
export function genBlockLogs(blockNum, txCount, blockHash) {
  const ts = nowTs();
  const entries = [
    { id: nextId(), ts, spans: [
      { text: '══ BLOCK ', color: C.keyword },
      { text: `#${(blockNum ?? 0).toLocaleString()}`, color: C.number },
      { text: '  ' + '─'.repeat(24), color: C.dim },
    ]},
  ];
  if (blockHash) {
    entries.push({ id: nextId(), ts: '', spans: [
      { text: '   hash  ', color: C.dim },
      { text: blockHash.slice(0, 20) + '…', color: C.teal },
    ]});
  }
  entries.push({ id: nextId(), ts: '', spans: [
    { text: '   txs   ', color: C.dim },
    { text: String(txCount ?? 0), color: C.number },
    { text: ` transaction${(txCount ?? 0) !== 1 ? 's' : ''}`, color: C.white },
  ]});
  return entries;
}

// ─── Stage-change log ─────────────────────────────────────────────────────────
export function genStageLogs(stage, txHash) {
  if (!stage || !txHash) return [];
  const ts = nowTs();
  return [
    { id: nextId(), ts, spans: [
      { text: '── ', color: C.dim },
      { text: stage.icon + ' ', color: stage.color },
      { text: stage.status, color: stage.color },
      { text: '  tx:', color: C.dim },
      { text: txHash.slice(0, 10) + '…' + txHash.slice(-6), color: C.teal },
    ]},
  ];
}

// ─── Boot banner ──────────────────────────────────────────────────────────────
export function genBanner() {
  return [
    { id: nextId(), ts: nowTs(), spans: [{ text: '  ██████╗ ███████╗███╗   ██╗██╗      █████╗ ██╗   ██╗███████╗██████╗  ', color: '#3a3a5a' }] },
    { id: nextId(), ts: '', spans: [{ text: '  ██╔════╝ ██╔════╝████╗  ██║██║     ██╔══██╗╚██╗ ██╔╝██╔════╝██╔══██╗ ', color: '#3a3a5a' }] },
    { id: nextId(), ts: '', spans: [{ text: '  ██║  ███╗█████╗  ██╔██╗ ██║██║     ███████║ ╚████╔╝ █████╗  ██████╔╝ ', color: C.keyword }] },
    { id: nextId(), ts: '', spans: [{ text: '  ██║   ██║██╔══╝  ██║╚██╗██║██║     ██╔══██║  ╚██╔╝  ██╔══╝  ██╔══██╗ ', color: C.teal }] },
    { id: nextId(), ts: '', spans: [{ text: '  ╚██████╔╝███████╗██║ ╚████║███████╗██║  ██║   ██║   ███████╗██║  ██║ ', color: C.teal }] },
    { id: nextId(), ts: '', spans: [{ text: '   ╚═════╝ ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝ ', color: '#3a3a5a' }] },
    { id: nextId(), ts: nowTs(), spans: [
      { text: '  Neural Terminal v2.0  ', color: C.dim },
      { text: '│', color: C.dim },
      { text: '  GenLayer Bradbury Testnet', color: C.teal },
    ]},
    { id: nextId(), ts: '', spans: [{ text: '  ' + '─'.repeat(52), color: C.dim }] },
  ];
}
