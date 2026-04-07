import React, { useEffect, useState, useCallback } from 'react';
import { EXPLORER_BASE } from '../hooks/useReptileRPG.js';

// ── Timing ────────────────────────────────────────────────────────────────────
const FADE_IN_DELAY  =  30;    // ms after mount before fade-in begins
const FADE_OUT_START = 6_500;  // ms before the fade-out transition starts
const DISMISS_AFTER  = 8_000;  // ms total display time

// ── TxToast ───────────────────────────────────────────────────────────────────
// Glassmorphism terminal-style notification that slides down from beneath the
// HUD center section when a batch TX is accepted on-chain.
//
// Props:
//   txHash   string  — full 0x transaction hash to display and link
//   id       number  — unique key; changing it remounts and re-animates
//   onDismiss fn     — called after DISMISS_AFTER ms; parent clears the state
//
// Position: absolute, top 62px (2px gap below HUD border), spanning the center
// section (left: 32%, right: 30%) to align pixel-perfectly under the level bar.
export default function TxToast({ txHash, id, onDismiss }) {
  // Tri-state opacity drives all animation: hidden → visible → hidden
  const [phase, setPhase] = useState('hidden'); // 'hidden' | 'visible' | 'fading'

  const stableDismiss = useCallback(() => onDismiss?.(), [onDismiss]);

  useEffect(() => {
    // Micro-delay lets the browser paint the initial hidden state before
    // applying the transition so the fade-in is actually visible.
    const inTimer  = setTimeout(() => setPhase('visible'), FADE_IN_DELAY);
    const outTimer = setTimeout(() => setPhase('fading'),  FADE_OUT_START);
    const endTimer = setTimeout(stableDismiss,               DISMISS_AFTER);
    return () => {
      clearTimeout(inTimer);
      clearTimeout(outTimer);
      clearTimeout(endTimer);
    };
  }, [id, stableDismiss]);

  const opacity   = phase === 'visible' ? 1 : 0;
  const translateY = phase === 'visible' ? '0px' : '-6px';

  // Shorten hash for display: 0x1234…abcd
  const shortHash = txHash
    ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}`
    : '—';

  return (
    <div
      aria-live="polite"
      style={{
        position:    'absolute',
        top:         62,      // 2px gap below HUD's bottom border (height: 60px + 1px border)
        left:        '32%',   // aligned with center section left edge
        right:       '30%',   // aligned with center section right edge
        zIndex:      9,       // below HUD (10), above canvas (1)

        // Animation
        opacity,
        transform:   `translateY(${translateY})`,
        transition:  phase === 'hidden'
          ? 'none'
          : 'opacity 1.4s cubic-bezier(0.4,0,0.2,1), transform 1.4s cubic-bezier(0.4,0,0.2,1)',
        pointerEvents: phase === 'visible' ? 'auto' : 'none',

        // Glassmorphism shell
        background:          'rgba(0, 8, 20, 0.84)',
        backdropFilter:      'blur(18px)',
        WebkitBackdropFilter:'blur(18px)',
        border:              '1px solid rgba(6, 182, 212, 0.22)',
        borderTop:           'none',   // flush with HUD's bottom border
        boxShadow:           '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(6,182,212,0.08)',

        padding:    '10px 16px 12px',
        fontFamily: '"JetBrains Mono", Consolas, monospace',
        userSelect: 'none',
        overflow:   'hidden',
      }}
    >
      {/* Top neon accent line — replaces the missing borderTop */}
      <div style={{
        position:   'absolute',
        top: 0, left: 0, right: 0,
        height:     1,
        background: 'linear-gradient(90deg, transparent 0%, rgba(6,182,212,0.7) 25%, rgba(105,255,71,0.5) 75%, transparent 100%)',
      }} />

      {/* Subtle left-edge glow stripe */}
      <div style={{
        position:   'absolute',
        top: 0, bottom: 0, left: 0,
        width:      2,
        background: 'linear-gradient(180deg, rgba(6,182,212,0.8) 0%, rgba(6,182,212,0.1) 100%)',
      }} />

      {/* Main message */}
      <div style={{
        paddingLeft:   8,
        fontSize:      9,
        fontWeight:    700,
        letterSpacing: '0.13em',
        lineHeight:    1.5,
        marginBottom:  6,
      }}>
        <span style={{ color: '#06b6d4' }}>SYNAPTIC PAYLOAD COMMITTED.&nbsp;</span>
        <span style={{ color: '#69ff47' }}>ETERNAL LEDGER UPDATED.</span>
      </div>

      {/* TX hash — full hyperlink to Bradbury explorer */}
      <a
        href={`${EXPLORER_BASE}/transactions/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            6,
          paddingLeft:    8,
          fontSize:       9,
          color:          '#4ec9b0',
          textDecoration: 'none',
          letterSpacing:  '0.04em',
          cursor:         'pointer',
          transition:     'color 0.15s ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = '#80ffea';
          const arrow = e.currentTarget.querySelector('[data-arrow]');
          if (arrow) arrow.style.transform = 'translateX(3px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = '#4ec9b0';
          const arrow = e.currentTarget.querySelector('[data-arrow]');
          if (arrow) arrow.style.transform = 'translateX(0)';
        }}
      >
        <span style={{ fontSize: 7, color: '#4e5057', letterSpacing: '0.1em' }}>TX</span>
        <span style={{ fontWeight: 600 }}>{shortHash}</span>
        <span
          data-arrow=""
          style={{ transition: 'transform 0.15s ease', fontSize: 10, color: '#4ec9b0' }}
        >
          ↗
        </span>
      </a>
    </div>
  );
}
