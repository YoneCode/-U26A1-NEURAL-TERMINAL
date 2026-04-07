import React from 'react';
import { REPTILE_CONTRACT_ADDRESS, EXPLORER_BASE } from '../hooks/useReptileRPG.js';

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
    synced:       { color: '#69ff47', animation: 'none',                                  label: 'SYNCED'  },
    pending:      { color: '#b388ff', animation: 'searchPulse 1.0s ease-in-out infinite', label: 'PENDING' },
    writing:      { color: '#06b6d4', animation: 'searchPulse 0.8s ease-in-out infinite', label: 'SAVING'  },
    failed:       { color: '#f44747', animation: 'none',                                  label: 'FAILED'  },
    disconnected: { color: '#4e5057', animation: 'none',                                  label: 'OFFLINE' },
  };
  const s = MAP[syncState] ?? MAP.disconnected;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <span className={syncState === 'synced' ? 'sync-dot sync-dot--live' : 'sync-dot'} style={{ fontSize: 9, color: s.color, animation: s.animation, lineHeight: 1 }}>●</span>
      <span style={{ fontSize: 9, color: s.color, letterSpacing: '0.1em', fontWeight: 700, textTransform: 'uppercase' }}>
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
        {name}
        <span style={{ fontSize: 9, color: '#4ec9b0', letterSpacing: '0.1em', marginLeft: 6 }}>
          [VERIFIED ON-CHAIN]
        </span>
      </>
    ),
    color:    '#9cdcfe',
    subtitle: 'Intelligent Contract Core',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
// Pure display — all state comes from props. No internal data fetching.
//
// Props:
//   liveEatenCount  null | number   null = loading skeleton; number = optimistic total
//   chainStats      null | false | object  mirrors useReptileRPG stats shape
//   syncState       string   one of the syncState machine values
export default function DragonHUD({
  liveEatenCount = null,
  chainStats     = null,
  syncState      = 'loading',
}) {
  const isHydrated = liveEatenCount !== null;
  const count      = liveEatenCount ?? 0;  // safe fallback for math when loading

  // ── Derived values ─────────────────────────────────────────────────────────
  const level         = Math.floor(count / 100);
  const huntsInLevel  = count % 100;
  const levelPct      = huntsInLevel;                 // 0-100, maps directly to %
  const toNextLevel   = 100 - huntsInLevel;
  const batchProgress = (count % 25) / 25;            // 0-1 toward next batch TX

  // ── Soul identity ──────────────────────────────────────────────────────────
  const soul = SoulDisplay({ chainStats, syncState });

  // ── Chain status dot (bottom-right cell) ──────────────────────────────────
  const chainDotColor = syncState === 'synced'                           ? '#69ff47'
                      : syncState === 'failed'                           ? '#f44747'
                      : syncState === 'disconnected'                     ? '#4e5057'
                      : syncState === 'writing'                          ? '#06b6d4'
                      : '#b388ff';
  const chainLabel    = syncState === 'synced'                           ? 'live'
                      : syncState === 'failed'                           ? 'failed'
                      : syncState === 'disconnected'                     ? 'down'
                      : syncState === 'writing'                          ? 'saving'
                      : 'sync';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:         'absolute',
        top: 0, left: 0, right: 0,
        height:           60,
        zIndex:           10,
        display:          'flex',
        alignItems:       'center',
        background:       'rgba(4, 4, 10, 0.96)',
        borderBottom:     '1px solid #252540',
        fontFamily:       '"JetBrains Mono", Consolas, monospace',
        userSelect:       'none',
        pointerEvents:    'none',   // mouse events pass through to canvas below
        overflow:         'hidden',
      }}
    >

      {/* ── LEFT: Soul Identity ─────────────────────────────────────────────── */}
      <div
        style={{
          flex:           '0 0 32%',
          padding:        '0 16px',
          borderRight:    '1px solid #1e1e2c',
          height:         '100%',
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'center',
          gap:            2,
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: '0.18em', color: '#686882', fontWeight: 700, textTransform: 'uppercase' }}>
          Soul Identity
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: soul.color, letterSpacing: '0.04em' }}>
          {soul.node}
        </div>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#5ec8b0', fontWeight: 600, textTransform: 'uppercase' }}>
          {soul.subtitle}
        </div>
      </div>

      {/* ── CENTER: Level + XP bars + SYNC indicator ────────────────────────── */}
      <div
        style={{
          flex:           '1 1 auto',
          padding:        '0 20px',
          borderRight:    '1px solid #1e1e2c',
          height:         '100%',
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'center',
          gap:            4,
        }}
      >
        {/* Level row — number left, hunt count + SYNC indicator right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <img
              src="/genlayer-icon.png"
              alt="GL"
              style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0, marginRight: 2 }}
            />
            <span style={{ fontSize: 9, color: '#a0a0b8', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Level
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isHydrated && (
              <>
                <span style={{ fontSize: 9, color: '#8a9ab4', fontWeight: 600 }}>{huntsInLevel} / 100</span>
                <span style={{ fontSize: 9, color: '#5e5e76' }}>{toNextLevel} to next</span>
              </>
            )}
            {/* SYNC indicator — always visible */}
            <SyncIndicator syncState={syncState} />
          </div>
        </div>

        {/* XP bar — 100 hunts per level */}
        <div
          style={{
            width:        '100%',
            height:       5,
            background:   'rgba(255,255,255,0.07)',
            borderRadius: 3,
            overflow:     'hidden',
          }}
        >
          <div
            style={{
              height:     '100%',
              width:      `${isHydrated ? levelPct : 0}%`,
              background: isHydrated
                ? 'linear-gradient(90deg, #00ff88 0%, #00bd68 100%)'
                : 'rgba(255,255,255,0.04)',
              borderRadius: 3,
              transition:   'width 0.5s cubic-bezier(0.4,0,0.2,1)',
              boxShadow:    isHydrated ? '0 0 10px rgba(0,255,136,0.4)' : 'none',
            }}
          />
        </div>

        {/* Batch sub-bar — 25 hunts per batch TX */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: '#5e5e76', letterSpacing: '0.12em', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
            Batch
          </span>
          <div
            style={{
              flex:         1,
              height:       2,
              background:   'rgba(255,255,255,0.05)',
              borderRadius: 1,
              overflow:     'hidden',
            }}
          >
            <div
              style={{
                height:     '100%',
                width:      `${isHydrated ? batchProgress * 100 : 0}%`,
                background:  'linear-gradient(90deg, #a855f7 0%, #7c3aed 100%)',
                borderRadius: 1,
                transition:  'width 0.3s ease',
                boxShadow:   '0 0 10px rgba(168,85,247,0.4)',
              }}
            />
          </div>
          <span style={{ fontSize: 9, color: '#686882', flexShrink: 0 }}>
            {isHydrated ? `${count % 25} / 25` : '· / 25'}
          </span>
        </div>
      </div>

      {/* ── RIGHT: Contract address + live stats ─────────────────────────────── */}
      <div
        style={{
          flex:           '0 0 30%',
          padding:        '0 14px',
          height:         '100%',
          display:        'flex',
          flexDirection:  'column',
          justifyContent: 'center',
          gap:            3,
        }}
      >
        {/* Contract address — clickable link (pointerEvents restored locally) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: '#686882', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Contract
          </span>
          {REPTILE_CONTRACT_ADDRESS ? (
            <a
              href={`${EXPLORER_BASE}/contract/${REPTILE_CONTRACT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              title={REPTILE_CONTRACT_ADDRESS}
              style={{
                fontSize:      9,
                color:         '#4ec9b0',
                textDecoration:'none',
                pointerEvents: 'auto',   // restore clicks through the no-pointer parent
                letterSpacing: '0.04em',
                cursor:        'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#80ffea'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#4ec9b0'; }}
            >
              {shortAddr(REPTILE_CONTRACT_ADDRESS)} ↗
            </a>
          ) : (
            <span style={{ fontSize: 9, color: '#3c3c4a', fontStyle: 'italic' }}>not deployed</span>
          )}
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 9, color: '#686882', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Total Hunts
            </span>
            <span
              className={isHydrated ? 'hud-total-num hud-total-num--live' : 'hud-total-num'}
              style={{
                fontSize:   14,
                fontWeight: 700,
                color:      isHydrated ? '#f0f0f0' : '#3c3c4a',
                transition: 'color 0.4s ease',
              }}
            >
              {isHydrated ? (liveEatenCount ?? 0).toLocaleString() : '···'}
            </span>
          </div>

          <div style={{ width: 1, alignSelf: 'stretch', background: '#1e1e2c', flexShrink: 0 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 9, color: '#686882', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Chain
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: chainDotColor, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 7 }}>●</span>
              {chainLabel}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
