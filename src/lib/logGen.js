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

// ─── Mock LLM data ────────────────────────────────────────────────────────────
const FN_CALLS = [
  'get_balance(address=0xA1B2C3D4)',
  'transfer(to=0x5678ABCD, amount=1000)',
  'approve(spender=0x9012EF01, value=50000)',
  'get_allowance(owner=0xA1B2C3D4)',
  'total_supply()',
];
const RESPONSES = [
  '{"result":"1000000000000000000","status":"ok"}',
  '{"result":true,"delta":{"from":"-1000","to":"+1000"}}',
  '{"result":true,"allowance":"50000000000000000000"}',
  '{"result":"500000000000000000","units":"wei"}',
  '{"result":"1000000000000000000000000"}',
];

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

// ─── Validator-round log ──────────────────────────────────────────────────────
export function genValidatorLogs(validators, roundNum, stageColor) {
  if (!validators || validators.length === 0) return [];
  const ts = nowTs();
  const logs = [
    { id: nextId(), ts, spans: [
      { text: '┌─ CONSENSUS ROUND ', color: stageColor || C.keyword },
      { text: String(roundNum ?? 0), color: C.number },
      { text: '  (' + validators.length + ' validators)', color: C.dim },
    ]},
  ];

  validators.forEach((v, i) => {
    const fn   = FN_CALLS[i % FN_CALLS.length];
    const resp = RESPONSES[i % RESPONSES.length];
    const hasScore = v.eqScore != null;
    const isMatch  = hasScore && v.eqScore >= 0.6;

    logs.push({ id: nextId(), ts: '', spans: [
      { text: '│ ', color: C.dim },
      { text: `[V${i + 1}] `, color: v.model?.color ?? C.teal },
      { text: v.model?.id ?? 'unknown', color: C.fn },
      ...(v.isLeader ? [{ text: '  ★ LEADER', color: C.yellow }] : []),
    ]});

    if (hasScore) {
      logs.push({ id: nextId(), ts: '', spans: [
        { text: '│    PROMPT   ', color: C.dim },
        { text: `"${fn}"`, color: C.str },
      ]});
      logs.push({ id: nextId(), ts: '', spans: [
        { text: '│    RESPONSE ', color: C.dim },
        { text: resp, color: C.cyan },
      ]});
      logs.push({ id: nextId(), ts: '', spans: [
        { text: '│    EQ_SCORE ', color: C.dim },
        { text: v.eqScore.toFixed(3) + '  ', color: isMatch ? C.lgreen : C.red },
        { text: eqBar(v.eqScore), color: isMatch ? C.lgreen : C.red },
        { text: isMatch ? '  MATCH ✓' : '  MISMATCH ✗', color: isMatch ? C.lgreen : C.red },
      ]});
      if (v.latency) {
        logs.push({ id: nextId(), ts: '', spans: [
          { text: '│    LATENCY  ', color: C.dim },
          { text: v.latency, color: C.number },
        ]});
      }
    } else {
      logs.push({ id: nextId(), ts: '', spans: [
        { text: '│    STATUS   ', color: C.dim },
        { text: 'awaiting response…', color: C.dim },
      ]});
    }

    const vc = v.vote === 'ACCEPTED' ? C.lgreen : v.vote === 'REJECTED' ? C.red : C.dim;
    logs.push({ id: nextId(), ts: '', spans: [
      { text: '│    VOTE     ', color: C.dim },
      { text: v.vote === 'ACCEPTED' ? 'ACCEPTED ✓' : v.vote === 'REJECTED' ? 'REJECTED ✗' : 'PENDING  ·', color: vc },
    ]});

    if (i < validators.length - 1) {
      logs.push({ id: nextId(), ts: '', spans: [{ text: '│', color: C.dim }] });
    }
  });

  const accepted = validators.filter(v => v.vote === 'ACCEPTED').length;
  const total    = validators.length;
  const rc       = accepted >= Math.ceil(total / 2) ? C.lgreen : C.yellow;
  logs.push({ id: nextId(), ts: '', spans: [
    { text: '└─ RESULT:  ', color: C.dim },
    { text: accepted >= Math.ceil(total / 2) ? 'ACCEPTED' : 'PENDING', color: rc },
    { text: `  (${accepted}/${total})`, color: C.dim },
  ]});

  return logs;
}

// ─── Real receipt log (from eth_getTransactionReceipt) ───────────────────────
export function genReceiptLogs(receipt, txHash) {
  if (!receipt) return [];
  const ts      = nowTs();
  const success = receipt.status === '0x1';
  const gasUsed = parseInt(receipt.gasUsed ?? '0', 16);
  const effGas  = parseInt(receipt.effectiveGasPrice ?? '0', 16);
  const blkNum  = parseInt(receipt.blockNumber ?? '0', 16);
  const evts    = Array.isArray(receipt.logs) ? receipt.logs : [];
  const sc      = success ? C.lgreen : C.red;
  const logs    = [];

  logs.push({ id: nextId(), ts, spans: [
    { text: '┌─ RECEIPT  ', color: sc },
    { text: success ? 'CONFIRMED ✓' : 'FAILED ✗', color: sc },
    { text: '  blk #' + blkNum.toLocaleString(), color: C.dim },
  ]});
  logs.push({ id: nextId(), ts: '', spans: [
    { text: '│  status     ', color: C.dim },
    { text: receipt.status ?? '?', color: sc },
    { text: success ? '  (success)' : '  (reverted)', color: C.dim },
  ]});
  logs.push({ id: nextId(), ts: '', spans: [
    { text: '│  gas used   ', color: C.dim },
    { text: gasUsed.toLocaleString(), color: C.number },
  ]});
  if (effGas > 0) {
    logs.push({ id: nextId(), ts: '', spans: [
      { text: '│  gas price  ', color: C.dim },
      { text: effGas.toLocaleString() + ' wei', color: C.number },
    ]});
  }
  logs.push({ id: nextId(), ts: '', spans: [
    { text: '│  events     ', color: C.dim },
    { text: String(evts.length), color: C.number },
    { text: evts.length === 1 ? ' log emitted' : ' logs emitted', color: C.dim },
  ]});
  evts.slice(0, 3).forEach((log, i) => {
    logs.push({ id: nextId(), ts: '', spans: [
      { text: '│  [evt ' + i + ']  ', color: C.dim },
      { text: (log.address ?? '?').slice(0, 20) + '…', color: C.teal },
      { text: '  t:' + (log.topics?.length ?? 0), color: C.dim },
    ]});
  });
  if (evts.length > 3) {
    logs.push({ id: nextId(), ts: '', spans: [
      { text: '│  … +' + (evts.length - 3) + ' more', color: C.dim },
    ]});
  }
  logs.push({ id: nextId(), ts: '', spans: [
    { text: '└─ ' + (txHash ?? '?').slice(0, 18) + '…', color: C.dim },
  ]});
  return logs;
}

// ─── Network-pulse "no tx" log ────────────────────────────────────────────────
export function genNetworkPulse(blockNum) {
  const ts = nowTs();
  return [
    { id: nextId(), ts, spans: [
      { text: '· NETWORK PULSE  ', color: C.dim },
      { text: `blk #${(blockNum ?? 0).toLocaleString()}`, color: C.teal },
      { text: '  synced', color: C.dim },
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
