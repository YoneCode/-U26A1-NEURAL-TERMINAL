import React, { useRef, useEffect } from 'react';

// ─── Static Data ────────────────────────────────────────────────────────────

const NODE_DEFS = [
  [0.10, 0.50],
  [0.30, 0.30],
  [0.50, 0.70],
  [0.70, 0.40],
  [0.85, 0.60],
  [0.95, 0.50],
];

// Maximum node index (0-based). stageIdx values outside [0, NODE_DEFS.length-1]
// are clamped so the canvas never references an undefined node.
const MAX_NODE_IDX = NODE_DEFS.length - 1;

// Derive the set of pulse-active node indices from a live txFeed array.
// Returns a Map<nodeIdx, statusColor> so each active node can be coloured
// by its real on-chain status rather than a hardcoded yellow.
function buildLivePulseMap(txFeed) {
  const map = new Map();
  if (!Array.isArray(txFeed)) return map;
  for (const tx of txFeed) {
    if (!tx) continue;
    const idx = Math.min(MAX_NODE_IDX, Math.max(0, tx.stageIdx ?? 0));
    // Error/failed tx → red pulse; in-progress → orange; accepted/finalized → green
    const color = tx.isError
      ? '#ff5252'
      : (tx.stageIdx ?? 0) >= 4
        ? '#69ff47'
        : (tx.stageIdx ?? 0) >= 2
          ? '#ffb300'
          : '#ffe040';
    // Higher-priority statuses overwrite lower ones for the same node slot
    if (!map.has(idx) || (tx.stageIdx ?? 0) > (map.get(idx)?._stageIdx ?? 0)) {
      map.set(idx, { color, _stageIdx: tx.stageIdx ?? 0 });
    }
  }
  return map;
}

// ─── Math Utilities ──────────────────────────────────────────────────────────

// Deterministic pseudo-random [0, 1) — no Math.random()
function dRand(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function cubicBezierPoint(t, p0, cp1, cp2, p1) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * cp1.x + 3 * mt * t ** 2 * cp2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * cp1.y + 3 * mt * t ** 2 * cp2.y + t ** 3 * p1.y,
  };
}

function cubicBezierTangent(t, p0, cp1, cp2, p1) {
  const mt = 1 - t;
  return {
    x: 3 * mt ** 2 * (cp1.x - p0.x) + 6 * mt * t * (cp2.x - cp1.x) + 3 * t ** 2 * (p1.x - cp2.x),
    y: 3 * mt ** 2 * (cp1.y - p0.y) + 6 * mt * t * (cp2.y - cp1.y) + 3 * t ** 2 * (p1.y - cp2.y),
  };
}

// ─── Draw: Organic Axon ──────────────────────────────────────────────────────

function drawOrganicConnection(ctx, nodeA, nodeB, iA, iB) {
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;

  // Deterministic control point offsets — unique per connection pair
  const seed = iA * 17 + iB * 31;
  const off1 = (dRand(seed)      - 0.5) * len * 0.55;
  const off2 = (dRand(seed + 7)  - 0.5) * len * 0.45;

  const cp1 = { x: nodeA.x + dx * 0.33 + px * off1, y: nodeA.y + dy * 0.33 + py * off1 };
  const cp2 = { x: nodeA.x + dx * 0.67 + px * off2, y: nodeA.y + dy * 0.67 + py * off2 };

  // Pass 1: mid glow (wide glow pass removed — GPU shadowBlur reduction)
  ctx.save();
  ctx.shadowColor = '#00cfff';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(0, 190, 255, 0.22)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(nodeA.x, nodeA.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, nodeB.x, nodeB.y);
  ctx.stroke();
  ctx.restore();

  // Pass 2: sharp core thread
  ctx.save();
  ctx.shadowColor = '#80f0ff';
  ctx.shadowBlur = 3;
  ctx.strokeStyle = 'rgba(160, 230, 255, 0.55)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(nodeA.x, nodeA.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, nodeB.x, nodeB.y);
  ctx.stroke();
  ctx.restore();

  return { cp1, cp2 };
}

// ─── Draw: Dendrites ────────────────────────────────────────────────────────

function drawDendrites(ctx, nodeA, nodeB, cp1, cp2, iA, iB) {
  const baseSeed = iA * 23 + iB * 41;
  const count = 3 + Math.floor(dRand(baseSeed + 99) * 3); // 3 to 5

  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 13;

    // Position along curve — avoid crowding the endpoints
    const t = 0.18 + dRand(seed) * 0.64;

    const pt   = cubicBezierPoint(t, nodeA, cp1, cp2, nodeB);
    const tang = cubicBezierTangent(t, nodeA, cp1, cp2, nodeB);
    const tLen = Math.sqrt(tang.x ** 2 + tang.y ** 2) || 1;

    // Normal vector (perpendicular to tangent)
    const nx = -tang.y / tLen;
    const ny =  tang.x / tLen;

    const side      = dRand(seed + 1) > 0.5 ? 1 : -1;
    const branchLen = 18 + dRand(seed + 2) * 38;
    const curl      = (dRand(seed + 3) - 0.5) * branchLen * 0.55;

    const endX = pt.x + nx * side * branchLen + (tang.x / tLen) * curl;
    const endY = pt.y + ny * side * branchLen + (tang.y / tLen) * curl;
    const cpX  = pt.x + nx * side * branchLen * 0.45;
    const cpY  = pt.y + ny * side * branchLen * 0.45;

    // Opacity falls off toward both ends of the parent axon
    const alpha = Math.sin(Math.PI * t) * 0.45 * (0.5 + dRand(seed + 5) * 0.5);

    // No shadowBlur on dendrites — opacity conveys depth without GPU overdraw
    ctx.save();
    ctx.strokeStyle = `rgba(0, 170, 220, ${alpha})`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Draw: Radar Ping ───────────────────────────────────────────────────────
// One expanding ring per node — drawn BEFORE the nucleus so it sits behind it.
// color   : inherits the node's base color (cyan for nuclei, yellow for TX nodes)
// stagger : per-node phase offset in px so rings are evenly spread across the cycle

const RADAR_MAX_R = 50;  // ring fades out at this radius (px)
const RADAR_SPEED = 30;  // radius grows 1px per RADAR_SPEED ms → full cycle = 1500ms

function drawRadarPing(ctx, node, color, stagger) {
  const r     = ((Date.now() / RADAR_SPEED) + stagger) % RADAR_MAX_R;
  const alpha = (1 - r / RADAR_MAX_R) * 0.65; // 0.65 → 0 as ring expands

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ─── Draw: Nucleus ──────────────────────────────────────────────────────────

function drawNucleus(ctx, node) {
  const { x, y } = node;

  // Layer 1: wide ambient halo
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 72);
  halo.addColorStop(0.0, 'rgba(0, 220, 255, 0.16)');
  halo.addColorStop(0.4, 'rgba(0, 160, 255, 0.06)');
  halo.addColorStop(1.0, 'rgba(0,   0,   0, 0.00)');
  ctx.save();
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 72, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Layer 2: mid glow ring with shadowBlur
  ctx.save();
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 32;
  const ring = ctx.createRadialGradient(x, y, 4, x, y, 30);
  ring.addColorStop(0.0, 'rgba(120, 245, 255, 0.55)');
  ring.addColorStop(0.5, 'rgba(  0, 180, 255, 0.18)');
  ring.addColorStop(1.0, 'rgba(  0,   0,   0, 0.00)');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(x, y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Layer 3: bright core disc
  ctx.save();
  ctx.shadowColor = '#a0f8ff';
  ctx.shadowBlur = 18;
  const core = ctx.createRadialGradient(x, y, 0, x, y, 14);
  core.addColorStop(0.0, 'rgba(255, 255, 255, 1.00)');
  core.addColorStop(0.2, 'rgba(190, 245, 255, 1.00)');
  core.addColorStop(0.6, 'rgba(  0, 205, 255, 0.85)');
  core.addColorStop(1.0, 'rgba(  0,  90, 200, 0.00)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Layer 4: pinpoint white center
  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.arc(x, y, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Draw: Pulse ────────────────────────────────────────────────────────────

function drawPulse(ctx, node, pulseColor = '#ffe040') {
  const { x, y } = node;
  // Derive halo/disc colours from the live status colour
  const glowColor = pulseColor;

  // Outer energy halo
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 35;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, 44);
  halo.addColorStop(0.0, `${glowColor}60`);
  halo.addColorStop(0.4, `${glowColor}1a`);
  halo.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Core pulse disc
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 22;
  const disc = ctx.createRadialGradient(x, y, 0, x, y, 9);
  disc.addColorStop(0.0, 'rgba(255, 255, 255, 1.00)');
  disc.addColorStop(0.35, `${glowColor}ff`);
  disc.addColorStop(0.75, `${glowColor}b3`);
  disc.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // White hot center
  ctx.save();
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Main Render ─────────────────────────────────────────────────────────────
// livePulseMap: Map<nodeIdx, { color, _stageIdx }> derived from real txFeed.
// Nodes not in the map render as quiet cyan nuclei.

function render(canvas, livePulseMap) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#020208';
  ctx.fillRect(0, 0, W, H);

  // Resolve node positions from percentages
  const nodes = NODE_DEFS.map(([px, py]) => ({ x: px * W, y: py * H }));

  // ── 1. Axons ──────────────────────────────────────────────────────────────
  const axonMeta = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const meta = drawOrganicConnection(ctx, nodes[i], nodes[i + 1], i, i + 1);
    axonMeta.push(meta);
  }

  // ── 2. Dendrites ──────────────────────────────────────────────────────────
  for (let i = 0; i < nodes.length - 1; i++) {
    const { cp1, cp2 } = axonMeta[i];
    drawDendrites(ctx, nodes[i], nodes[i + 1], cp1, cp2, i, i + 1);
  }

  // ── 3. Radar pings — drawn first so they sit behind the solid node cores ──
  nodes.forEach((node, i) => {
    const entry   = livePulseMap.get(i);
    const color   = entry ? entry.color : '#00e5ff';
    const stagger = (i / nodes.length) * RADAR_MAX_R;
    drawRadarPing(ctx, node, color, stagger);
  });

  // ── 4. Nuclei (static — must not shrink/grow/pulse) ───────────────────────
  nodes.forEach((node) => drawNucleus(ctx, node));

  // ── 5. Pulses — only on nodes that have a live transaction ─────────────────
  livePulseMap.forEach(({ color }, nodeIdx) => {
    const node = nodes[nodeIdx];
    if (node) drawPulse(ctx, node, color);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NeuralCanvas({ txFeed }) {
  const canvasRef  = useRef(null);
  // Store txFeed in a ref so the rAF loop always reads the latest value
  // without needing to restart the effect on every feed update.
  const txFeedRef  = useRef(txFeed ?? []);
  useEffect(() => { txFeedRef.current = txFeed ?? []; }, [txFeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId;

    const loop = () => {
      const livePulseMap = buildLivePulseMap(txFeedRef.current);
      render(canvas, livePulseMap);
      rafId = requestAnimationFrame(loop);
    };

    const handleResize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      // render is driven by the rAF loop — no direct call needed here
    };

    handleResize();
    rafId = requestAnimationFrame(loop);

    const ro = new ResizeObserver(handleResize);
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', background: '#020208', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}
