import React, { useRef, useEffect } from 'react';
import { STATUS_COLOR_MAP, HUNT_STATUS_COLORS } from '../lib/statusColors.js';

// ── Particles config (faithful mirror of NeuralEnvironment PARTICLES_CONFIG) ──
const PCFG = {
  count:       180,   // particles.number.value
  speed:       1,     // particles.move.speed  (user-edited from 6 → 1)
  linkDist:    150,   // particles.line_linked.distance
  linkOpacity: 0.4,   // particles.line_linked.opacity
  linkWidth:   1,     // particles.line_linked.width
  grabDist:    140,   // interactivity.modes.grab.distance
  grabOpacity: 1.0,   // interactivity.modes.grab.line_linked.opacity
  lineMaxOpacity: 0.2, // max alpha for particle–particle lines
  pushCount:   4,     // interactivity.modes.push.particles_nb
  sizeBase:    7.5,   // particles.size.value  (half for clarity)
  opacity:     0.5,   // particles.opacity.value
};

// ── Particle lifecycle constants ───────────────────────────────────────────────
// A particle is "active" (mapped to a tx) for TTL_MS, then returns to the
// neutral pool — preventing the dark-canvas bug caused by eaten-set bloat.
const TTL_MS        = 5_000;     // active lifetime per particle (ms)
const NEUTRAL_COLOR = '#2a2a3a'; // dim green-grey node matching Neural Terminal theme
const NEUTRAL_SIZE  = 1.5;       // small dot while in the background pool

// ── Tooltip HTML builder ──────────────────────────────────────────────────────
// Generates the inner HTML for the imperative tooltip div.
// Data comes from our own API (no user-generated HTML) — innerHTML is safe here.
function buildTooltipHTML(tx) {
  const rows = [
    ['Hash',   tx.hash   ? tx.hash.slice(0, 18) + '…' + tx.hash.slice(-6) : '—'],
    ['From',   tx.from   ? tx.from.slice(0, 10) + '…' + tx.from.slice(-4) : '—'],
    ['To',     tx.to     ? tx.to.slice(0, 10)   + '…' + tx.to.slice(-4)   : '(contract)'],
    ['Method', tx.method ?? tx.functionName ?? '—'],
    ['Status', tx.status ?? '—'],
    ['Value',  tx.value  && tx.value !== '0' ? tx.value : '0'],
  ];
  const rowsHTML = rows.map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;gap:12px;line-height:1.6">
      <span style="color:#4e5057;font-size:9px;text-transform:uppercase;letter-spacing:.08em;flex-shrink:0">${k}</span>
      <span style="color:#d4d4d4;font-size:9px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${v}</span>
    </div>`).join('');
  return `<div style="font-family:'JetBrains Mono',Consolas,monospace;padding:10px 12px;min-width:220px">
    <div style="font-size:8px;color:#4ec9b0;letter-spacing:.12em;text-transform:uppercase;margin-bottom:7px;border-bottom:1px solid #2a2a3a;padding-bottom:5px">TX Details</div>
    ${rowsHTML}
  </div>`;
}

export default function ReptileLogic({ txFeed, standardTxs, onEat }) {
  const canvasRef    = useRef(null);
  const tooltipRef   = useRef(null);   // imperative tooltip div (no React state)
  const txFeedRef    = useRef(txFeed      ?? []);
  const stdTxsRef    = useRef(standardTxs ?? []);
  const eatenTxsRef  = useRef(new Set());
  const onEatRef     = useRef(onEat);
  const totalEatenRef= useRef(0);
  const prevHoverRef = useRef(null);   // last hovered txId — avoids redundant DOM writes

  // Keep refs current without restarting the canvas effect
  useEffect(() => { txFeedRef.current    = txFeed      ?? []; }, [txFeed]);
  useEffect(() => { stdTxsRef.current    = standardTxs ?? []; }, [standardTxs]);
  useEffect(() => { onEatRef.current     = onEat;             }, [onEat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Canvas sizing ──────────────────────────────────────────────────────────
    canvas.width  = canvas.offsetWidth  || window.innerWidth * 0.5;
    canvas.height = canvas.offsetHeight || window.innerHeight;

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 1;

    // ── Spark explosions (eat effect) ──────────────────────────────────────────
    const explosions = [];

    // ── Head image ─────────────────────────────────────────────────────────────
    const headImg = new Image();
    let   headImgReady = false;
    headImg.onload = () => { headImgReady = true; };
    headImg.src = '/genlayer.png';

    // ── Input ──────────────────────────────────────────────────────────────────
    var Input = { keys: [], mouse: { left: false, right: false, middle: false, x: canvas.width / 2, y: canvas.height / 2 } };
    for (var i = 0; i < 230; i++) { Input.keys.push(false); }

    const onKeyDown   = e => Input.keys[e.keyCode] = true;
    const onKeyUp     = e => Input.keys[e.keyCode] = false;
    const onMouseMove = e => {
      const rect = canvas.getBoundingClientRect();
      Input.mouse.x = e.clientX - rect.left;
      Input.mouse.y = e.clientY - rect.top;
    };

    document.addEventListener('keydown',   onKeyDown);
    document.addEventListener('keyup',     onKeyUp);
    document.addEventListener('mousemove', onMouseMove);

    // ── Particles system (PARTICLES_CONFIG → Canvas API) ──────────────────────
    function makeParticle(x, y, color) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = PCFG.speed * (0.3 + Math.random() * 0.7);
      return {
        x:        x    != null ? x    : Math.random() * canvas.width,
        y:        y    != null ? y    : Math.random() * canvas.height,
        vx:       Math.cos(angle) * spd,
        vy:       Math.sin(angle) * spd,
        size:     NEUTRAL_SIZE,      // neutral size until assigned a tx
        color:    color ?? NEUTRAL_COLOR, // neutral color until assigned
        opacity:  PCFG.opacity,
        txId:     null,              // null = available in the neutral pool
        ttlExpiry: null,             // null = not tracking TTL
      };
    }

    const particles = Array.from({ length: PCFG.count }, () => makeParticle());

    // ── Particle lifecycle: TTL-based mapping with clean expiry ───────────────
    //
    // Three phases per frame:
    //   1. EXPIRE   — particles past their TTL return to the neutral pool.
    //   2. ASSIGN   — neutral particles claim unclaimed txs from the live feed.
    //   3. REFRESH  — active particles update their color from the latest status.
    //
    // This prevents unbounded eatenTxsRef growth and keeps the canvas populated.
    function syncTxColors() {
      const now   = Date.now();
      const gFeed = txFeedRef.current;
      const sFeed = stdTxsRef.current;

      // Build an interleaved combined feed and a hash → tx lookup map
      const txById  = new Map();
      const combined = [];
      const maxLen  = Math.max(gFeed.length, sFeed.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < gFeed.length) {
          combined.push(gFeed[i]);
          txById.set(gFeed[i].hash, gFeed[i]);
        }
        if (i < sFeed.length) {
          combined.push(sFeed[i]);
          txById.set(sFeed[i].hash, sFeed[i]);
        }
      }

      // Phase 1: EXPIRE — return timed-out particles to the neutral pool ────────
      for (const p of particles) {
        if (p.ttlExpiry !== null && now >= p.ttlExpiry) {
          eatenTxsRef.current.delete(p.txId); // release from eaten memory
          p.txId      = null;
          p.ttlExpiry = null;
          p.color     = NEUTRAL_COLOR;
          p.size      = NEUTRAL_SIZE;
        }
      }

      if (combined.length === 0) return;

      // Phase 2: build the set of txIds already held by active particles ────────
      const claimed = new Set();
      for (const p of particles) {
        if (p.txId !== null) claimed.add(p.txId);
      }

      // Queue of unclaimed, uneaten txs available for assignment
      const available = combined.filter(tx => {
        const id = tx.id ?? tx.hash;
        return id && !claimed.has(id) && !eatenTxsRef.current.has(id);
      });
      let availIdx = 0;

      // Phase 3: ASSIGN neutral / REFRESH active ─────────────────────────────
      for (const p of particles) {
        if (p.txId !== null) {
          // Active particle — refresh its color from the current live feed
          if (eatenTxsRef.current.has(p.txId)) {
            // Eaten: blanked until TTL expires and it is recycled
            p.color = 'transparent';
            p.size  = 0;
          } else {
            const tx = txById.get(p.txId);
            if (tx) {
              const status = (tx.status ?? '').toUpperCase();
              p.color = STATUS_COLOR_MAP[status]
                ?? (tx.isError ? STATUS_COLOR_MAP.FAILED : '#ffffff');
            }
            // If tx has scrolled out of the feed window, keep its last color
            // until the TTL fires and the slot is recycled.
          }
        } else {
          // Neutral particle — claim the next available tx if one exists
          if (availIdx < available.length) {
            const tx     = available[availIdx++];
            const id     = tx.id ?? tx.hash;
            const status = (tx.status ?? '').toUpperCase();
            p.txId      = id;
            p.ttlExpiry = now + TTL_MS;
            p.size      = Math.random() * PCFG.sizeBase + 0.5; // restore active size
            p.color     = STATUS_COLOR_MAP[status]
              ?? (tx.isError ? STATUS_COLOR_MAP.FAILED : '#ffffff');
          }
          // else: remains dim/neutral until a slot opens
        }
      }
    }

    function updateParticles() {
      syncTxColors();
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        // out_mode: 'out' — exit one edge, reappear opposite
        if      (p.x < -p.size)                  p.x = canvas.width  + p.size;
        else if (p.x >  canvas.width  + p.size)  p.x = -p.size;
        if      (p.y < -p.size)                  p.y = canvas.height + p.size;
        else if (p.y >  canvas.height + p.size)  p.y = -p.size;
      }
    }

    function drawParticles() {
      ctx.globalAlpha = 1;
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawLinks() {
      const mx  = Input.mouse.x;
      const my  = Input.mouse.y;
      const n   = particles.length;
      const ld2 = PCFG.linkDist * PCFG.linkDist;
      const gd2 = PCFG.grabDist * PCFG.grabDist;
      ctx.lineWidth = PCFG.linkWidth;

      ctx.strokeStyle = '#ffffff';

      for (let i = 0; i < n; i++) {
        const a = particles[i];

        // Particle–particle links: alpha fades with distance
        for (let j = i + 1; j < n; j++) {
          const b  = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx*dx + dy*dy;
          if (d2 < ld2) {
            const alpha = PCFG.lineMaxOpacity * (1.5 - Math.sqrt(d2) / PCFG.linkDist);
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        // Grab mode: mouse–particle links
        const mdx = a.x - mx;
        const mdy = a.y - my;
        if (mdx*mdx + mdy*mdy < gd2) {
          ctx.globalAlpha = PCFG.lineMaxOpacity;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Push mode: click spawns PCFG.pushCount particles at cursor.
    // Hard cap prevents unbounded growth from rapid clicking.
    const MAX_PARTICLES = PCFG.count + 20;
    const onClick = e => {
      const rect  = canvas.getBoundingClientRect();
      const cx    = e.clientX - rect.left;
      const cy    = e.clientY - rect.top;
      const toAdd = Math.min(PCFG.pushCount, MAX_PARTICLES - particles.length);
      for (let i = 0; i < toAdd; i++) {
        particles.push(makeParticle(
          cx + (Math.random() - 0.5) * 10,
          cy + (Math.random() - 0.5) * 10,
        ));
      }
    };
    canvas.addEventListener('click', onClick);

    // ── Segment ────────────────────────────────────────────────────────────────
    var segmentCount = 0;
    class Segment {
      constructor(parent, size, angle, range, stiffness) {
        segmentCount++; this.parent = parent; this.size = size; this.relAngle = angle;
        this.defAngle = angle; this.absAngle = parent.absAngle + angle; this.range = range;
        this.stiffness = stiffness; this.children = []; this._ema = angle;
        if (parent.children) parent.children.push(this);
        this.updateRelative(false, true);
      }
      updateRelative(iter, flex) {
        this.relAngle -= 2 * Math.PI * Math.floor((this.relAngle - this.defAngle) / 2 / Math.PI + 1 / 2);
        if (flex) this.relAngle = Math.min(this.defAngle + this.range/2, Math.max(this.defAngle - this.range/2, (this.relAngle - this.defAngle) / this.stiffness + this.defAngle));
        this.absAngle = this.parent.absAngle + this.relAngle;
        this.x = this.parent.x + Math.cos(this.absAngle) * this.size;
        this.y = this.parent.y + Math.sin(this.absAngle) * this.size;
        if (iter) this.children.forEach(c => c.updateRelative(iter, flex));
      }
      draw(iter) {
        ctx.beginPath(); ctx.moveTo(this.parent.x, this.parent.y); ctx.lineTo(this.x, this.y); ctx.stroke();
        if (iter) this.children.forEach(c => c.draw(true));
      }
      follow(iter) {
        let x = this.parent.x, y = this.parent.y;
        let dist = ((this.x - x)**2 + (this.y - y)**2)**0.5;
        this.x = x + this.size * (this.x - x) / dist;
        this.y = y + this.size * (this.y - y) / dist;
        // EMA: blend raw FABRIK angle toward previous — prevents kinking
        const rawRel = Math.atan2(this.y - y, this.x - x) - this.parent.absAngle;
        let diff = rawRel - this._ema;
        diff -= 2 * Math.PI * Math.floor(diff / (2 * Math.PI) + 0.5);
        this._ema += diff * 0.15;  // lower factor = smoother spine, less kinking
        this.relAngle = this._ema;
        this.updateRelative(false, true);
        if (iter) this.children.forEach(c => c.follow(true));
      }
    }

    // ── LimbSystem ─────────────────────────────────────────────────────────────
    class LimbSystem {
      constructor(end, length, speed, creature) {
        this.end = end; this.length = length; this.speed = speed; this.creature = creature;
        this.nodes = []; let node = end;
        for (let i = 0; i < length; i++) { this.nodes.unshift(node); node = node.parent; }
        this.hip = this.nodes[0].parent; creature.systems.push(this);
      }
      moveTo(x, y) {
        this.nodes[0].updateRelative(true, true);
        let dist = ((x - this.end.x)**2 + (y - this.end.y)**2)**0.5;
        let len = Math.max(0, dist - this.speed);
        for (let i = this.nodes.length - 1; i >= 0; i--) {
          let node = this.nodes[i]; let ang = Math.atan2(node.y - y, node.x - x);
          node.x = x + len * Math.cos(ang); node.y = y + len * Math.sin(ang);
          x = node.x; y = node.y; len = node.size;
        }
        for (let node of this.nodes) {
          node.absAngle = Math.atan2(node.y - node.parent.y, node.x - node.parent.x);
          node.relAngle = node.absAngle - node.parent.absAngle;
          node.children.forEach(c => { if (!this.nodes.includes(c)) c.updateRelative(true, false); });
        }
      }
    }

    // ── LegSystem ──────────────────────────────────────────────────────────────
    class LegSystem extends LimbSystem {
      constructor(end, length, speed, creature) {
        super(end, length, speed, creature);
        this.goalX = end.x; this.goalY = end.y; this.step = 0; this.forwardness = 0;
        this.reach = 0.9 * ((end.x - this.hip.x)**2 + (end.y - this.hip.y)**2)**0.5;
        let relAngle = creature.absAngle - Math.atan2(end.y - this.hip.y, end.x - this.hip.x);
        this.swing = -relAngle + (2 * (relAngle < 0) - 1) * Math.PI / 2;
        this.swingOffset = creature.absAngle - this.hip.absAngle;
      }
      update() {
        this.moveTo(this.goalX, this.goalY);
        if (this.step === 0) {
          let dist = ((this.end.x - this.goalX)**2 + (this.end.y - this.goalY)**2)**0.5;
          if (dist > 1) {
            this.step = 1;
            this.goalX = this.hip.x + this.reach * Math.cos(this.swing + this.hip.absAngle + this.swingOffset) + (2*Math.random()-1)*this.reach/2;
            this.goalY = this.hip.y + this.reach * Math.sin(this.swing + this.hip.absAngle + this.swingOffset) + (2*Math.random()-1)*this.reach/2;
          }
        } else {
          let forwardness2 = (((this.end.x - this.hip.x)**2 + (this.end.y - this.hip.y)**2)**0.5) * Math.cos(Math.atan2(this.end.y - this.hip.y, this.end.x - this.hip.x) - this.hip.absAngle);
          if (Math.abs(this.forwardness - forwardness2) < 1) this.step = 0;
          this.forwardness = forwardness2;
        }
      }
    }

    // ── Creature ───────────────────────────────────────────────────────────────
    class Creature {
      constructor(x, y, angle, fAccel, fFric, fRes, fThresh, rAccel, rFric, rRes, rThresh) {
        this.x = x; this.y = y; this.absAngle = angle; this.fSpeed = 0; this.fAccel = fAccel;
        this.fFric = fFric; this.fRes = fRes; this.fThresh = fThresh; this.rSpeed = 0;
        this.rAccel = rAccel; this.rFric = rFric; this.rRes = rRes; this.rThresh = rThresh;
        this.children = []; this.systems = [];
      }
      follow(x, y) {
        let dist = ((this.x - x)**2 + (this.y - y)**2)**0.5;
        let angle = Math.atan2(y - this.y, x - this.x);
        let accel = this.fAccel * (this.systems.length ? this.systems.filter(s => s.step === 0).length / this.systems.length : 1);
        this.fSpeed = (this.fSpeed + accel * (dist > this.fThresh)) * (1 - this.fRes);
        let speed = Math.max(0, this.fSpeed - this.fFric);
        let dif = (this.absAngle - angle + Math.PI) % (2 * Math.PI) - Math.PI;
        if (Math.abs(dif) > this.rThresh && dist > this.fThresh) this.rSpeed -= this.rAccel * Math.sign(dif);
        this.rSpeed *= (1 - this.rRes);
        this.rSpeed = Math.abs(this.rSpeed) > this.rFric ? this.rSpeed - this.rFric * Math.sign(this.rSpeed) : 0;
        this.absAngle += this.rSpeed;
        this.x += speed * Math.cos(this.absAngle); this.y += speed * Math.sin(this.absAngle);
        this.absAngle += Math.PI;
        this.children.forEach(c => c.follow(true));
        this.systems.forEach(s => s.update(x, y));
        this.absAngle -= Math.PI; this.draw(true);
      }
      draw(iter) {
        const r = this.imgR ?? 22;
        if (headImgReady) {
          ctx.save();
          ctx.translate(this.x, this.y);
          ctx.rotate(this.absAngle + Math.PI / 2);
          ctx.drawImage(headImg, -r, -r, r * 2, r * 2);
          ctx.restore();
        } else {
          const gr = 4;
          ctx.beginPath();
          ctx.arc(this.x, this.y, gr, Math.PI/4 + this.absAngle, 7*Math.PI/4 + this.absAngle);
          ctx.lineTo(this.x + gr*Math.cos(this.absAngle)*Math.SQRT2, this.y + gr*Math.sin(this.absAngle)*Math.SQRT2);
          ctx.lineTo(this.x + gr*Math.cos(Math.PI/4 + this.absAngle), this.y + gr*Math.sin(Math.PI/4 + this.absAngle));
          ctx.stroke();
        }
        if (iter) this.children.forEach(c => c.draw(true));
      }
    }

    // ── setupLizard ────────────────────────────────────────────────────────────
    var critter;
    function setupLizard(size, legs, tail) {
      let s = size; critter = new Creature(canvas.width/2, canvas.height/2, 0, s*10, s*2, 0.5, 16, 0.5, 0.085, 0.5, 0.3);
      critter.imgR = s * 9;
      let spinal = critter;
      for (let i = 0; i < 6; i++) {
        spinal = new Segment(spinal, s*4, 0, 0.4, 2);
        for (let ii of [-1, 1]) {
          let n = new Segment(spinal, s*3, ii, 0.1, 2);
          for (let iii = 0; iii < 3; iii++) n = new Segment(n, s*0.1, -ii*0.1, 0.1, 2);
        }
      }
      for (let i = 0; i < legs; i++) {
        if (i > 0) for (let ii = 0; ii < 6; ii++) {
          spinal = new Segment(spinal, s*4, 0, 0.4, 2);
          for (let iii of [-1, 1]) {
            let n = new Segment(spinal, s*3, iii*1.57, 0.1, 1.5);
            for (let iv = 0; iv < 3; iv++) n = new Segment(n, s*3, -iii*0.3, 0.1, 2);
          }
        }
        for (let ii of [-1, 1]) {
          let n = new Segment(spinal, s*12, ii*0.78, 0, 8);
          n = new Segment(n, s*16, -ii*0.78, 6.28, 1);
          n = new Segment(n, s*16, ii*1.57, 3.14, 2);
          for (let iii = 0; iii < 4; iii++) new Segment(n, s*4, (iii/3-0.5)*1.57, 0.1, 4);
          new LegSystem(n, 3, s*12, critter);
        }
      }
      for (let i = 0; i < tail; i++) {
        spinal = new Segment(spinal, s*4, 0, 0.6, 1.5);
        for (let ii of [-1, 1]) {
          let n = new Segment(spinal, s*3, ii, 0.1, 2);
          for (let iii = 0; iii < 3; iii++) n = new Segment(n, s*3*(tail-i)/tail, -ii*0.1, 0.1, 2);
        }
      }
    }

    setupLizard(2.5, 4, 18.5);

    let huntX = canvas.width / 2, huntY = canvas.height / 2;

    // ── HUD label renderer ─────────────────────────────────────────────────────
    function drawLabels() {
      ctx.font         = '9px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';

      for (const p of particles) {
        // Only draw labels for active (assigned), non-neutral, non-eaten particles
        if (
          p.txId !== null &&
          p.color !== NEUTRAL_COLOR &&
          p.color !== 'transparent' &&
          !eatenTxsRef.current.has(p.txId)
        ) {
          const strId   = String(p.txId);
          const shortId = strId.length > 10 ? strId.slice(0, 6) + '...' + strId.slice(-4) : strId;

          const textY = p.y - p.size - 4;
          const textW = ctx.measureText(shortId).width;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(p.x - textW / 2 - 4, textY - 10, textW + 8, 12);

          ctx.fillStyle = p.color;
          ctx.fillText(shortId, p.x, textY);
        }
      }
    }

    // ── Animation loop ─────────────────────────────────────────────────────────
    let rafId;
    const loop = () => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 1 ── Particles layer (background, beneath lizard)
      updateParticles();
      drawLinks();
      drawParticles();
      drawLabels();

      // 2 ── Sparks layer: eat-explosion embers
      for (let i = explosions.length - 1; i >= 0; i--) {
        const p = explosions[i];
        p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        if (p.life <= 0) { explosions.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 3 ── Lizard layer: hunt FAILED/REJECTED or idle orbit
      ctx.strokeStyle = 'white';
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 1;

      // ── Hover detection: find closest active particle to the cursor ────────
      // Updates the imperative tooltip div directly — zero React re-renders.
      const HOVER_R = 18; // px proximity radius
      let closestP = null;
      let closestD = Infinity;
      for (const p of particles) {
        if (p.txId === null || eatenTxsRef.current.has(p.txId)) continue;
        const dx = p.x - Input.mouse.x;
        const dy = p.y - Input.mouse.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < HOVER_R + p.size && d < closestD) {
          closestD = d;
          closestP = p;
        }
      }
      const hoverHash = closestP?.txId ?? null;
      if (tooltipRef.current) {
        if (hoverHash) {
          // Only rebuild HTML when hover target changes — otherwise just reposition
          if (hoverHash !== prevHoverRef.current) {
            prevHoverRef.current = hoverHash;
            const allTxs = [...txFeedRef.current, ...stdTxsRef.current];
            const tx = allTxs.find(t => (t.id ?? t.hash) === hoverHash);
            if (tx) {
              tooltipRef.current.innerHTML  = buildTooltipHTML(tx);
              tooltipRef.current.style.display = 'block';
            } else {
              tooltipRef.current.style.display = 'none';
            }
          }
          // Reposition every frame: right of cursor, clamped to canvas bounds
          const TW = 246, TH = 130;
          const rawX = Input.mouse.x + 20;
          const rawY = Input.mouse.y - TH / 2;
          const tx = Math.min(rawX, canvas.width  - TW - 4);
          const ty = Math.max(4, Math.min(rawY, canvas.height - TH - 4));
          tooltipRef.current.style.transform = `translate(${tx}px,${ty}px)`;
        } else {
          if (prevHoverRef.current !== null) {
            prevHoverRef.current = null;
            tooltipRef.current.style.display = 'none';
          }
        }
      }

      const targets = particles.filter(p => HUNT_STATUS_COLORS.has(p.color));
      let rawHX, rawHY;
      if (targets.length > 0) {
        const target = targets[0];
        const dx = target.x - critter.x;
        const dy = target.y - critter.y;
        if (Math.sqrt(dx*dx + dy*dy) < 45) {
          // Mark as eaten — syncTxColors will blank this particle on the next
          // frame and the TTL will eventually recycle it back to the neutral pool
          eatenTxsRef.current.add(target.txId);
          target.x = -1000; target.y = -1000;
          // Notify parent of new kill count (fires infrequently — safe to call)
          totalEatenRef.current += 1;
          onEatRef.current?.(totalEatenRef.current);
          // Spawn 15 sparks at the kill position
          for (let s = 0; s < 15; s++) {
            const angle = Math.random() * Math.PI * 2;
            const spd   = Math.random() * 4 + 2;
            explosions.push({
              x:     rawHX ?? critter.x,
              y:     rawHY ?? critter.y,
              vx:    Math.cos(angle) * spd,
              vy:    Math.sin(angle) * spd,
              life:  1.0,
              decay: Math.random() * 0.05 + 0.03,
              size:  Math.random() * 2 + 1,
              color: target.color,
            });
          }
        }
        rawHX = target.x; rawHY = target.y;
      } else {
        const idleAngle = Date.now() / 3000;
        const idleR     = Math.min(canvas.width, canvas.height) * 0.2;
        rawHX = canvas.width  / 2 + Math.cos(idleAngle) * idleR;
        rawHY = canvas.height / 2 + Math.sin(idleAngle) * idleR;
      }
      // Smooth head turning: lerp toward raw target to prevent snapping
      huntX += (rawHX - huntX) * 0.06;
      huntY += (rawHY - huntY) * 0.06;
      critter.follow(huntX, huntY);

      rafId = requestAnimationFrame(loop);
    };
    loop();

    // ── Resize — update canvas dimensions AND re-scatter particles immediately ─
    // Without re-scattering, particles clump near old edges until the wrap-
    // around logic naturally redistributes them (which can take many seconds).
    const onResize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      for (const p of particles) {
        p.x = Math.random() * canvas.width;
        p.y = Math.random() * canvas.height;
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('click',       onClick);
      document.removeEventListener('keydown',   onKeyDown);
      document.removeEventListener('keyup',     onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize',      onResize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: '#000000',
          zIndex: 1,
          display: 'block',
        }}
      />
      {/* Imperative tooltip — positioned & populated directly by the RAF loop.
          position:absolute + transform avoids any layout reflow on update.    */}
      <div
        ref={tooltipRef}
        style={{
          display:        'none',         // shown/hidden imperatively
          position:       'absolute',
          top:            0,
          left:           0,
          zIndex:         20,
          background:     'rgba(13,13,24,0.95)',
          border:         '1px solid #2a2a3a',
          borderRadius:   6,
          boxShadow:      '0 4px 24px rgba(0,0,0,0.6)',
          pointerEvents:  'none',         // never blocks mouse on the canvas
          willChange:     'transform',    // GPU compositing for smooth repositioning
        }}
      />
    </>
  );
}
