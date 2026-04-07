import React, { useState } from 'react';
import { REPTILE_CONTRACT_ADDRESS, EXPLORER_BASE } from '../hooks/useReptileRPG.js';
import { ORACLE_ADDRESS, LORE_ADDRESS } from '../hooks/useMultiContract.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortAddr(a) {
  return a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : (a ?? '—');
}

// ── SYNC Indicator ────────────────────────────────────────────────────────────
// Small dot + label that reflects the live RPC / chain sync state.
// References keyframe animations defined in App.css (blink, searchPulse).
function SyncIndicator({ syncState }) {
  const MAP = {
    loading:      { color: '#569cd6', animation: 'searchPulse 1.4s ease-in-out infinite', label: 'LOADING' },
    fetching:     { color: '#569cd6', animation: 'searchPulse 1.4s ease-in-out infinite', label: 'FETCH'   },
    synced:       { color: '#69ff47', animation: 'hudLivePulse 2.4s ease-in-out infinite', label: 'SYNCED'  },
    pending:      { color: '#b388ff', animation: 'searchPulse 1.0s ease-in-out infinite', label: 'PENDING' },
    writing:      { color: '#06b6d4', animation: 'searchPulse 0.8s ease-in-out infinite', label: 'SAVING'  },
    failed:       { color: '#f44747', animation: 'none',                                  label: 'FAILED'  },
    disconnected: { color: '#4e5057', animation: 'none',                                  label: 'OFFLINE' },
  };
  const s = MAP[syncState] ?? MAP.disconnected;
  const isLive = syncState === 'synced';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span
        className={isLive ? 'sync-dot sync-dot--live' : 'sync-dot'}
        style={{
          fontSize:  9,
          color:     s.color,
          animation: s.animation,
          lineHeight: 1,
          textShadow: isLive ? `0 0 6px ${s.color}, 0 0 12px ${s.color}88` : 'none',
        }}
      >●</span>
      <span style={{
        fontSize:     9,
        color:        s.color,
        letterSpacing:'0.1em',
        fontWeight:   700,
        textTransform:'uppercase',
        textShadow:   isLive ? `0 0 8px ${s.color}88` : 'none',
      }}>
        {s.label}
      </span>
    </div>
  );
}

// ── Soul Identity display ─────────────────────────────────────────────────────
// States, in priority order:
//   LOADING CORE    — initial fetch in progress, no data yet
//   SOUL DISCONNECTED — contract unreachable, no cached data
//   SAVING TO GAARA — TX in-flight, writing batch to chain
//   SYNC FAILED     — TX reverted or timed out, local count retained
//   <name> [VERIFIED ON-CHAIN] — live or stale data present
function SoulDisplay({ chainStats, syncState }) {
  if (syncState === 'loading' && !chainStats) {
    return {
      node:     <span style={{ color: '#3c3c4a', animation: 'blink 1s step-end infinite' }}>LOADING CORE…</span>,
      color:    '#3c3c4a',
      subtitle: 'Hydrating from chain',
    };
  }

  if (!chainStats) {
    return {
      node:     <span style={{ color: '#f44747', letterSpacing: '0.06em' }}>SOUL DISCONNECTED</span>,
      color:    '#f44747',
      subtitle: 'Contract unreachable',
    };
  }

  if (syncState === 'writing') {
    return {
      node:     <span style={{ color: '#06b6d4', animation: 'searchPulse 0.8s ease-in-out infinite' }}>SAVING TO GAARA…</span>,
      color:    '#06b6d4',
      subtitle: 'Writing to chain',
    };
  }

  if (syncState === 'failed') {
    return {
      node:     <span style={{ color: '#f44747' }}>SYNC FAILED — LOCAL COUNT RETAINED</span>,
      color:    '#f44747',
      subtitle: 'Retrying on next batch',
    };
  }

  const name = chainStats.soul_name ?? '(我愛羅)';
  return {
    node: (
      <>
        <span style={{ textShadow: '0 0 10px rgba(156,220,254,0.7), 0 0 20px rgba(156,220,254,0.3)' }}>{name}</span>
        <span style={{ fontSize: 8, color: '#4ec9b0', letterSpacing: '0.12em', marginLeft: 7, opacity: 0.8 }}>
          [VERIFIED ON-CHAIN]
        </span>
      </>
    ),
    color:    '#9cdcfe',
    subtitle: 'Intelligent Contract Core',
  };
}

// ── InspectorTooltip ─────────────────────────────────────────────────────────
// Raw debugging console popover. Pure CSS absolute positioning — floats above
// the RosterItem's relative container. No JS measurement required.
function InspectorTooltip({ lines, accentColor }) {
  return (
    <div
      style={{
        position:      'absolute',
        top:           'calc(100% + 6px)',
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        9999,
        background:    '#000000',
        border:        '1px solid rgba(0,255,136,0.4)',
        borderLeft:    `2px solid ${accentColor}`,
        boxShadow:     '0 4px 20px rgba(0,0,0,0.8)',
        padding:       '7px 11px',
        whiteSpace:    'nowrap',
        pointerEvents: 'none',
        fontFamily:    '"JetBrains Mono", monospace',
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize:      8,
            lineHeight:    1.8,
            whiteSpace:    'pre',
            color:         line.startsWith('>') ? '#33ff66' : '#4a5568',
            letterSpacing: '0.04em',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}

// ── ChronicleTicker ───────────────────────────────────────────────────────────
// Scrolls a chronicle string across a fixed-width container.
// No setInterval — uses CSS animation so it never triggers a React re-render
// after mount. The key prop on the inner span forces a CSS restart when the
// chronicle text changes. Prefixes with a [SYS_TIME] stamp derived from the
// content key so it updates only when the chronicle itself changes.
function ChronicleTicker({ text, status }) {
  const dim = '#3a3a50';
  if (status === 'missing') {
    return (
      <div style={{ fontSize: 8, color: dim, letterSpacing: '0.1em', overflow: 'hidden', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
        LORE CONTRACT NOT DEPLOYED
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div style={{ fontSize: 8, color: '#3d5a50', animation: 'blink 1.2s step-end infinite', overflow: 'hidden', whiteSpace: 'nowrap', letterSpacing: '0.1em' }}>
        AWAITING LORE SYNC…
      </div>
    );
  }
  const raw     = text || '—';
  // Stable timestamp: changes only when the chronicle text changes, not every render.
  // We derive it from a hash of the content so it reads as a real system time.
  const tsMs    = raw.length > 1
    ? raw.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) * 1337 % 86400000
    : 0;
  const hh      = String(Math.floor(tsMs / 3600000)).padStart(2, '0');
  const mm      = String(Math.floor((tsMs % 3600000) / 60000)).padStart(2, '0');
  const ss      = String(Math.floor((tsMs % 60000) / 1000)).padStart(2, '0');
  const stamp   = `[${hh}:${mm}:${ss}]`;
  const content = `${stamp} ${raw}`;
  return (
    <div style={{ overflow: 'hidden', width: '100%', position: 'relative', height: 13 }}>
      <span
        key={raw}
        style={{
          display:      'inline-block',
          whiteSpace:   'nowrap',
          fontSize:     8,
          color:        '#5ecfaa',
          letterSpacing:'0.07em',
          fontWeight:   500,
          textShadow:   '0 0 8px rgba(94,207,170,0.5)',
          animation:    content.length > 32
            ? 'chronicleScroll 14s linear infinite'
            : 'none',
          paddingRight: 40,
        }}
      >
        {content}
      </span>
    </div>
  );
}

// ── ThreatBadge ───────────────────────────────────────────────────────────────
// Color-coded pill that reflects HuntOracle threat_level.
const THREAT_COLORS = {
  LOW:      { bg: 'rgba(105,255,71,0.08)',  border: 'rgba(105,255,71,0.5)',  text: '#69ff47', glow: 'rgba(105,255,71,0.3)'  },
  MEDIUM:   { bg: 'rgba(255,179,0,0.08)',   border: 'rgba(255,179,0,0.5)',   text: '#ffb300', glow: 'rgba(255,179,0,0.3)'   },
  HIGH:     { bg: 'rgba(255,82,82,0.1)',    border: 'rgba(255,82,82,0.6)',   text: '#ff6b6b', glow: 'rgba(255,82,82,0.35)'  },
  CRITICAL: { bg: 'rgba(244,71,71,0.14)',   border: 'rgba(244,71,71,0.7)',   text: '#ff4444', glow: 'rgba(244,71,71,0.5)'   },
};
function ThreatBadge({ level, status }) {
  if (status === 'missing' || status === 'loading') {
    return (
      <span style={{
        fontSize:     8,
        color:        '#2e2e3e',
        letterSpacing:'0.12em',
        border:       '1px solid #2a2a3a',
        borderRadius: 2,
        padding:      '2px 6px',
        fontWeight:   700,
      }}>
        THREAT —
      </span>
    );
  }
  const c = THREAT_COLORS[level] ?? THREAT_COLORS.LOW;
  const pulse = level === 'CRITICAL' || level === 'HIGH';
  return (
    <span style={{
      fontSize:     8,
      fontWeight:   700,
      letterSpacing:'0.12em',
      color:        c.text,
      background:   c.bg,
      border:       `1px solid ${c.border}`,
      borderRadius: 2,
      padding:      '2px 6px',
      boxShadow:    `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 8px ${c.glow}`,
      textShadow:   `0 0 8px ${c.glow}`,
      animation:    pulse ? 'searchPulse 1.2s ease-in-out infinite' : 'none',
      flexShrink:   0,
    }}>
      {level}
    </span>
  );
}

// ── RosterItem ────────────────────────────────────────────────────────────────
// Single contract row with optional InspectorTooltip on hover.
// position:relative on the outer div gives InspectorTooltip its anchor.
function RosterItem({ label, addr, status, color, tooltipLines }) {
  const [hovered, setHovered] = useState(false);
  const online     = status === 'ok';
  const loading    = status === 'loading';
  const dot        = online ? '#69ff47' : loading ? '#569cd6' : '#2a2a3a';
  const dotAnim    = online
    ? 'hudLivePulse 2.4s ease-in-out infinite'
    : loading ? 'searchPulse 1.4s ease-in-out infinite' : 'none';
  const dotGlow    = online ? '0 0 5px #69ff47, 0 0 10px rgba(105,255,71,0.4)' : 'none';
  const hasTooltip = tooltipLines && tooltipLines.length > 0;
  const showTip    = hovered && hasTooltip;

  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            4,
        lineHeight:     1,
        position:       'relative',
        pointerEvents:  'auto',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{
        fontSize:   7,
        color:      dot,
        animation:  dotAnim,
        lineHeight: 1,
        textShadow: dotGlow,
        flexShrink: 0,
      }}>●</span>

      {addr ? (
        <a
          href={`${EXPLORER_BASE}/address/${addr}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize:      10,
            lineHeight:    1,
            color:         hovered && online ? '#ffffff' : online ? color : '#2e2e3e',
            textDecoration:'none',
            pointerEvents: 'auto',
            letterSpacing: '0.08em',
            cursor:        online ? 'pointer' : 'default',
            fontWeight:    700,
            textShadow:    hovered && online
              ? `0 0 12px ${color}, 0 0 24px ${color}66`
              : online ? `0 0 8px ${color}88, 0 0 2px ${color}` : 'none',
            transition:    'color 0.15s ease, text-shadow 0.15s ease',
            whiteSpace:    'nowrap',
          }}
        >
          [{label}] ↗
        </a>
      ) : (
        <span style={{ fontSize: 10, lineHeight: 1, color: '#252535', letterSpacing: '0.08em', fontWeight: 700, whiteSpace: 'nowrap' }}>
          [{label}] —
        </span>
      )}

      {showTip && (
        <InspectorTooltip lines={tooltipLines} accentColor={color} />
      )}
    </div>
  );
}

// ── ContractRoster ────────────────────────────────────────────────────────────
// All three items carry InspectorTooltip lines. Tooltips show on hover
// regardless of contract status — offline contracts display a status message.
function ContractRoster({ oracleStatus, loreStatus, oracleData, loreData, liveEatenCount }) {
  const rpgLines = [
    '> CONTRACT: ReptileRPG Core',
    '> STATUS: ACTIVE',
    `> TOTAL BATCHES INDEXED: ${liveEatenCount ?? '—'}`,
  ];

  const loreOnline = loreStatus === 'ok';
  const loreLines = loreOnline ? [
    '> gl.exec_prompt() active',
    '> ENGINE: GenLayer Consensus LLM',
    `> EVOLUTIONS    : ${loreData?.evolution_count ?? '—'}`,
    `> LAST MILESTONE: ${loreData?.last_milestone  ?? '—'}`,
    '> MODEL VOTE: 5/5 validators',
  ] : [
    '> gl.exec_prompt() initialized',
    '> ENGINE: GenLayer LLM',
    '> STATUS: AWAITING FIRST MILESTONE',
  ];

  const oracleOnline = oracleStatus === 'ok';
  const oracleLines = oracleOnline ? [
    '> gl.get_webpage() active',
    '> TARGET: Bradbury API /pending',
    `> PENDING TXS  : ${oracleData?.pending_count    ?? '—'}`,
    `> VALIDATORS   : ${oracleData?.validator_count  ?? '—'}`,
    `> THREAT LEVEL : ${oracleData?.threat_level     ?? '—'}`,
    `> MULTIPLIER   : ${oracleData?.batch_multiplier ?? '—'} bps`,
  ] : [
    '> gl.get_webpage() initialized',
    '> TARGET: Bradbury API /pending',
    '> STATUS: AWAITING ORACLE SYNC',
  ];

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'row',
      alignItems:    'center',
      gap:           15,
      pointerEvents: 'auto',
    }}>
      <RosterItem
        label="RPG CORE"
        addr={REPTILE_CONTRACT_ADDRESS}
        status={REPTILE_CONTRACT_ADDRESS ? 'ok' : 'missing'}
        color="#4ec9b0"
        tooltipLines={rpgLines}
      />
      <RosterItem
        label="LORE AI"
        addr={LORE_ADDRESS}
        status={loreStatus}
        color="#b388ff"
        tooltipLines={loreLines}
      />
      <RosterItem
        label="ORACLE"
        addr={ORACLE_ADDRESS}
        status={oracleStatus}
        color="#38bdf8"
        tooltipLines={oracleLines}
      />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
// Pure display — all state comes from props. No internal data fetching.
//
// Props:
//   liveEatenCount  null | number
//   chainStats      null | false | object
//   syncState       string
//   batchSize       number   dynamic batch size from oracle
//   oracleData      object   { threat_level, batch_multiplier, ... }
//   oracleStatus    string   'loading' | 'ok' | 'error' | 'missing'
//   loreData        object   { chronicle, ... }
//   loreStatus      string   'loading' | 'ok' | 'error' | 'missing'
export default function DragonHUD({
  liveEatenCount = null,
  chainStats     = null,
  syncState      = 'loading',
  batchSize      = 25,
  oracleData     = { threat_level: 'LOW', batch_multiplier: 100 },
  oracleStatus   = 'missing',
  loreData       = { chronicle: '' },
  loreStatus     = 'missing',
}) {
  const isHydrated    = liveEatenCount !== null;
  const count         = liveEatenCount ?? 0;

  // ── Derived values ─────────────────────────────────────────────────────────
  const level        = Math.floor(count / 100);
  const huntsInLevel = count % 100;
  const levelPct     = huntsInLevel;
  const toNextLevel  = 100 - huntsInLevel;
  // Batch progress uses the dynamic batchSize from oracle
  const batchProgress = batchSize > 0 ? (count % batchSize) / batchSize : 0;

  // ── Soul identity ──────────────────────────────────────────────────────────
  const soul = SoulDisplay({ chainStats, syncState });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:      'absolute',
        top: 0, left: 0, right: 0,
        height:        60,
        zIndex:        10,
        display:       'flex',
        alignItems:    'stretch',
        background:    'linear-gradient(180deg, rgba(6,6,16,0.98) 0%, rgba(4,4,12,0.97) 100%)',
        borderBottom:  '1px solid rgba(78,78,120,0.35)',
        boxShadow:     '0 1px 0 rgba(78,78,120,0.1), 0 2px 16px rgba(0,0,0,0.6)',
        fontFamily:    '"JetBrains Mono", Consolas, monospace',
        userSelect:    'none',
        pointerEvents: 'none',
        overflow:      'visible',
      }}
    >

      {/* ── LEFT: Identity + Chronicle Ticker ───────────────────────────────────── */}
      <div
        className="hud-col-left"
        style={{
          flex:          '0 0 30%',
          padding:       '0 16px',
          borderRight:   '1px solid rgba(40,40,64,0.8)',
          boxShadow:     'inset -1px 0 0 rgba(255,255,255,0.025)',
          display:       'flex',
          flexDirection: 'column',
          justifyContent:'center',
          gap:           2,
          minWidth:      0,
        }}
      >
        <div style={{ fontSize: 8, letterSpacing: '0.14em', color: '#42425a', fontWeight: 700, textTransform: 'uppercase' }}>
          ENTITY ID
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: soul.color, letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
          {soul.node}
        </div>
        {/* Chronicle ticker — replaces static subtitle when lore is available */}
        <ChronicleTicker
          text={loreStatus === 'ok' ? loreData.chronicle : null}
          status={loreStatus}
        />
      </div>

      {/* ── CENTER: Total Indexed + Horizontal Contract Roster ─────────────── */}
      <div
        style={{
          flex:          '1 1 auto',
          padding:       '0 18px',
          borderRight:   '1px solid rgba(40,40,64,0.8)',
          boxShadow:     'inset -1px 0 0 rgba(255,255,255,0.025)',
          display:       'flex',
          flexDirection: 'column',
          justifyContent:'center',
          gap:           4,
          minWidth:      0,
          overflow:      'visible',
        }}
      >
        {/* Total Indexed */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 8, color: '#42425a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', flexShrink: 0 }}>
            TOTAL INDEXED
          </span>
          <span
            className={isHydrated ? 'hud-total-num hud-total-num--live' : 'hud-total-num'}
            style={{
              fontSize:      15,
              fontWeight:    700,
              color:         isHydrated ? '#e8e8f0' : '#252535',
              transition:    'color 0.4s ease',
              letterSpacing: '0.02em',
              lineHeight:    1,
              textShadow:    isHydrated ? '0 0 14px rgba(232,232,240,0.25)' : 'none',
            }}
          >
            {isHydrated ? (liveEatenCount ?? 0).toLocaleString() : '···'}
          </span>
        </div>

        {/* Horizontal Contract Roster */}
        <ContractRoster
          oracleStatus={oracleStatus}
          loreStatus={loreStatus}
          oracleData={oracleData}
          loreData={loreData}
          liveEatenCount={liveEatenCount}
        />
      </div>

      {/* ── RIGHT: Level + Bars + Batch + Threat ──────────────────────────────────── */}
      <div
        className="hud-col-right"
        style={{
          flex:          '0 0 28%',
          padding:       '0 16px',
          display:       'flex',
          flexDirection: 'column',
          justifyContent:'center',
          gap:           4,
          minWidth:      0,
        }}
      >
        {/* Level row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <img
              src="/genlayer-icon.png"
              alt="GL"
              style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }}
            />
            <span style={{ fontSize: 8, color: '#545470', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              LVL
            </span>
            <span
              className={isHydrated ? 'hud-level-num hud-level-num--live' : 'hud-level-num'}
              style={{
                fontSize:   18,
                fontWeight: 700,
                color:      isHydrated ? '#00ff88' : '#3c3c4a',
                lineHeight: 1,
                transition: 'color 0.4s ease',
                textShadow: isHydrated ? '0 0 8px rgba(0,255,136,0.5)' : 'none',
              }}
            >
              {isHydrated ? String(level).padStart(2, '0') : '--'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {isHydrated && (
              <span style={{ fontSize: 8, color: '#4a5a72', fontWeight: 600, letterSpacing: '0.06em' }}>{huntsInLevel}<span style={{ color: '#2e2e42' }}>/100</span></span>
            )}
            <SyncIndicator syncState={syncState} />
          </div>
        </div>

        {/* XP bar */}
        <div style={{
          width:     '100%',
          height:    4,
          background:'rgba(255,255,255,0.05)',
          borderRadius: 3,
          overflow:  'hidden',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}>
          <div style={{
            height: '100%',
            width:  `${isHydrated ? levelPct : 0}%`,
            background: isHydrated
              ? 'linear-gradient(90deg, #00c96a 0%, #00ff88 50%, #00e87a 100%)'
              : 'rgba(255,255,255,0.03)',
            borderRadius: 3,
            transition:   'width 0.5s cubic-bezier(0.4,0,0.2,1)',
            boxShadow:    isHydrated ? '0 0 8px rgba(0,255,136,0.6), 0 0 2px rgba(0,255,136,0.9), inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
          }} />
        </div>

        {/* Batch sub-bar + BATCH LIMIT label + Threat Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 7.5, color: '#383850', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
            BATCH<span style={{ color: '#505068', marginLeft: 4 }}>{batchSize}</span>
          </span>
          <div style={{
            flex:         1,
            height:       2,
            background:   'rgba(255,255,255,0.04)',
            borderRadius: 1,
            overflow:     'hidden',
            boxShadow:    'inset 0 1px 1px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              height:     '100%',
              width:      `${isHydrated ? batchProgress * 100 : 0}%`,
              background: 'linear-gradient(90deg, #7c3aed 0%, #a855f7 60%, #c084fc 100%)',
              borderRadius: 1,
              transition: 'width 0.3s ease',
              boxShadow:  '0 0 6px rgba(168,85,247,0.7), inset 0 1px 0 rgba(255,255,255,0.2)',
            }} />
          </div>
          <span style={{ fontSize: 7.5, color: '#383850', flexShrink: 0, letterSpacing: '0.04em' }}>
            {isHydrated ? `${count % batchSize}/${batchSize}` : `·/${batchSize}`}
          </span>
          <ThreatBadge level={oracleData.threat_level} status={oracleStatus} />
        </div>
      </div>

    </div>
  );
}
