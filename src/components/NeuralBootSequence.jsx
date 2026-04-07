import React, { useEffect, useState, useRef } from 'react';
import { ORACLE_ADDRESS, LORE_ADDRESS } from '../hooks/useMultiContract.js';

const BOOT_MS   = 6000;
const FADE_MS   = 500;
const EXPLORER  = 'https://studio.genlayer.com/';

// Terminal lines — real project data, no filler
const LINES = [
  { text: 'NEURAL INDEXER v1.0 — GenLayer Bradbury', color: '#e2e2e2', delay: 0    },
  { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color: '#1e1e30',  delay: 80   },
  { text: 'SYSTEM_INIT     Bootstrapping IK-Dragon runtime', color: '#6e7080', delay: 160  },
  { text: 'CHAIN           GenLayer Bradbury testnet',        color: '#6e7080', delay: 300  },
  { text: 'CONTRACT_ORACLE HuntOracle.py — monitoring',       color: '#569cd6', delay: 480  },
  { text: '                network congestion + threat level', color: '#4e5057', delay: 560  },
  { text: `                ${ORACLE_ADDRESS ? ORACLE_ADDRESS.slice(0,10)+'…'+ORACLE_ADDRESS.slice(-6) : 'NOT DEPLOYED'}`, color: ORACLE_ADDRESS ? '#22c55e' : '#ef4444', delay: 680, link: ORACLE_ADDRESS ? `${EXPLORER}#/address/${ORACLE_ADDRESS}` : null },
  { text: 'CONTRACT_LORE   DragonLore.py — AI chronicles',    color: '#eab308', delay: 860  },
  { text: '                GenLayer LLM consensus engine',    color: '#4e5057', delay: 940  },
  { text: `                ${LORE_ADDRESS ? LORE_ADDRESS.slice(0,10)+'…'+LORE_ADDRESS.slice(-6) : 'NOT DEPLOYED'}`,   color: LORE_ADDRESS   ? '#22c55e' : '#ef4444', delay: 1060, link: LORE_ADDRESS ? `${EXPLORER}#/address/${LORE_ADDRESS}` : null },
  { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color: '#1e1e30',  delay: 1240 },
  { text: 'NEURAL_MAP      Mapping txs → dendrite topology',  color: '#6e7080', delay: 1360 },
  { text: '                6-node axon graph · cubic bezier', color: '#4e5057', delay: 1440 },
  { text: 'HUNT_LOGIC      IK dragon targets FAILED/REJECTED', color: '#6e7080', delay: 1600 },
  { text: '                kills committed on-chain via RPG',  color: '#4e5057', delay: 1680 },
  { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color: '#1e1e30',  delay: 1860 },
  { text: 'READY           Entering neural terminal…',         color: '#69ff47', delay: 2000 },
];

const SPINNER = ['/', '—', '\\', '|'];

const css = `
/* ── Overlay ── */
.nbs-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #020208;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  transition: opacity ${FADE_MS}ms cubic-bezier(0.4,0,1,1);
}
.nbs-overlay.fading {
  opacity: 0;
  pointer-events: none;
}

/* ── Bar: fixed sibling, top of viewport ── */
.nbs-bar {
  position: fixed;
  top: 0; left: 0;
  width: 100vw;
  height: 5px;
  z-index: 10000;
  overflow: hidden;
}
.nbs-bar > div {
  position: absolute;
  top: 0; left: 0;
  height: 100%; width: 100%;
  transform-origin: left center;
  transform: scaleX(0);
}
.nbs-bar > div:nth-child(1) { background: #3369E8; animation: nbs-loading-bar 2s infinite backwards ease-out; animation-delay: -1.5s; }
.nbs-bar > div:nth-child(2) { background: #EEB211; animation: nbs-loading-bar 2s infinite backwards ease-out; animation-delay: -1s;   }
.nbs-bar > div:nth-child(3) { background: #009925; animation: nbs-loading-bar 2s infinite backwards ease-out; animation-delay: -.5s;  }
.nbs-bar > div:nth-child(4) { background: #D50F25; animation: nbs-loading-bar 2s infinite backwards ease-out; animation-delay: 0s;    }
@keyframes nbs-loading-bar {
  0%   { transform: scaleX(0); z-index: 15; }
  22%  { transform: scaleX(0); z-index: 15; }
  50%  { transform: scaleX(1); }
  90%  { transform: scaleX(1); z-index: 1; }
  100% { transform: scaleX(1); z-index: 0; }
}

/* ── Left: terminal panel ── */
.nbs-terminal {
  flex: 0 0 auto;
  width: min(420px, 90vw);
  padding: 32px 36px;
  display: flex;
  flex-direction: column;
  gap: 0;
  font-family: "JetBrains Mono", "Consolas", "Courier New", monospace;
  font-size: 10px;
  line-height: 1.9;
  letter-spacing: 0.03em;
}
.nbs-term-header {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #4e5057;
  margin-bottom: 10px;
  text-transform: uppercase;
}
.nbs-term-line {
  display: flex;
  align-items: baseline;
  gap: 0;
  white-space: pre;
  opacity: 0;
  transform: translateY(3px);
  animation: nbs-line-in 0.12s ease forwards;
}
.nbs-term-line a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.nbs-term-line a:hover { opacity: 0.75; }
.nbs-spinner {
  font-size: 11px;
  font-weight: 700;
  color: #569cd6;
  margin-right: 6px;
  flex-shrink: 0;
  line-height: 1;
}
@keyframes nbs-line-in {
  to { opacity: 1; transform: translateY(0); }
}

/* ── Divider ── */
.nbs-divider {
  width: 1px;
  height: 280px;
  background: linear-gradient(to bottom, transparent, #1e1e30 20%, #1e1e30 80%, transparent);
  flex-shrink: 0;
  margin: 0 48px;
}
@media (max-width: 700px) {
  .nbs-divider { display: none; }
  .nbs-wrap    { display: none; }
  .nbs-terminal {
    width: 100%;
    padding: 28px 24px;
  }
}

/* ── Right: orbit loader ── */
.nbs-wrap {
  position: relative;
  flex-shrink: 0;
  width: 15rem;
  height: 15rem;
  font-size: 10px;
}
.nbs-wrap .red    { background-color: #D50F25; }
.nbs-wrap .yellow { background-color: #EEB211; }
.nbs-wrap .green  { background-color: #009925; }
.nbs-wrap .blue   { background-color: #3369E8; }

/* ── Circle ── */
.nbs-circle {
  position: absolute;
  height: 1.5rem; width: 1.5rem;
  border-radius: 50%;
  top: 2.25rem; right: 2.25rem;
  overflow: hidden;
}
.nbs-circle > div {
  position: absolute;
  top: 0; left: 0;
  height: 100%; width: 100%;
  border-radius: 50%;
}
.nbs-circle > div:nth-child(1) { background-color: #3369E8; animation: nbs-loading-circle 2s infinite backwards ease-out; animation-delay: -1.5s; transform: translateX(-500%); }
.nbs-circle > div:nth-child(2) { background-color: #D50F25; animation: nbs-loading-circle 2s infinite backwards ease-out; animation-delay: -1s;   transform: translateY(500%);  }
.nbs-circle > div:nth-child(3) { background-color: #EEB211; animation: nbs-loading-circle 2s infinite backwards ease-out; animation-delay: -.5s;  transform: translateX(500%);  }
.nbs-circle > div:nth-child(4) { background-color: #009925; animation: nbs-loading-circle 2s infinite backwards ease-out; animation-delay: 0s;    transform: translateY(-500%); }
@keyframes nbs-loading-circle {
  0%   { z-index: 10; }
  75%  { transform: translateX(0); z-index: 1; }
  100% { transform: translateX(0); z-index: 0; }
}

/* ── Orbit (scaled 0.75×: 15rem outer, 11.25rem arm) ── — hidden ≤700px */
.nbs-orbit {
  position: absolute;
  height: 15rem; width: 15rem;
  top: 0; left: 0; bottom: 0; right: 0;
  margin: auto;
  overflow: visible;
  background: #0f0f16;
  border-radius: 50%;
}
.nbs-orbit > div {
  top: 1.875rem; left: 1.875rem;
  font-size: 1rem;
  height: 11.25rem; width: 11.25rem;
  transform-origin: center center;
  position: absolute;
  animation: nbs-loading-orbit 6s infinite linear;
}
.nbs-orbit > div::before {
  position: absolute;
  left: calc(50% - .5em);
  display: block;
  content: '';
  height: 1em; width: 1em;
  border-radius: 50%;
  transform: scale(1);
  animation: nbs-loading-orbit-before 2s infinite ease-in-out;
}
.nbs-orbit > div:nth-child(1)::before { background-color: #3369E8; }
.nbs-orbit > div:nth-child(2)::before { background-color: #D50F25; }
.nbs-orbit > div:nth-child(3)::before { background-color: #009925; }
.nbs-orbit > div:nth-child(4)::before { background-color: #EEB211; }
.nbs-orbit > div:nth-child(1) { animation-delay: 0s;     }
.nbs-orbit > div:nth-child(2) { animation-delay: -.75s;  }
.nbs-orbit > div:nth-child(3) { animation-delay: -1.5s;  }
.nbs-orbit > div:nth-child(4) { animation-delay: -2.25s; }
.nbs-orbit > div:nth-child(1)::before { animation-delay: 0s;    }
.nbs-orbit > div:nth-child(2)::before { animation-delay: -.5s;  }
.nbs-orbit > div:nth-child(3)::before { animation-delay: -1s;   }
.nbs-orbit > div:nth-child(4)::before { animation-delay: -1.5s; }
@keyframes nbs-loading-orbit {
  0%   { transform: rotate(0deg);   }
  100% { transform: rotate(360deg); }
}
@keyframes nbs-loading-orbit-before {
  0%   { height: 1em; width: 1em; transform: translate3d(0,0,0);           z-index: 5;  }
  25%  { height: 2em; width: 2em;                                           z-index: 10; }
  50%  { transform: translate3d(.75rem,11.25rem,0); z-index: 0; height: 1em; width: 1em; }
  100% { transform: translate3d(0,0,0);             z-index: 0; height: 1em; width: 1em; }
}
`;

export default function NeuralBootSequence({ onDone }) {
  const [fading,      setFading]      = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [spinnerIdx,  setSpinnerIdx]  = useState(0);
  const spinnerRef = useRef(null);

  // Reveal lines one by one based on their delay
  useEffect(() => {
    const timers = LINES.map((line, i) =>
      setTimeout(() => setVisibleCount(c => Math.max(c, i + 1)), line.delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // Spin the cursor while not fading
  useEffect(() => {
    spinnerRef.current = setInterval(() => {
      setSpinnerIdx(i => (i + 1) % SPINNER.length);
    }, 120);
    return () => clearInterval(spinnerRef.current);
  }, []);

  // Boot timer
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFading(true);
      clearInterval(spinnerRef.current);
    }, BOOT_MS);
    const doneTimer = setTimeout(() => onDone(), BOOT_MS + FADE_MS + 50);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <>
      <style>{css}</style>

      {/* Bar: position:fixed, true sibling, top of viewport */}
      {!fading && (
        <div className="nbs-bar">
          <div /><div /><div /><div />
        </div>
      )}

      {/* Overlay: full viewport, flex row, centers both panels */}
      <div className={`nbs-overlay${fading ? ' fading' : ''}`}>

        {/* LEFT — terminal */}
        <div className="nbs-terminal">
          <div className="nbs-term-header">neural terminal · init sequence</div>
          {LINES.slice(0, visibleCount).map((line, i) => (
            <div
              key={i}
              className="nbs-term-line"
              style={{ color: line.color, animationDelay: '0ms' }}
            >
              <span className="nbs-spinner">
                {i === visibleCount - 1 && !fading ? SPINNER[spinnerIdx] : ' '}
              </span>
              {line.link
                ? <a href={line.link} target="_blank" rel="noopener noreferrer">{line.text}</a>
                : line.text
              }
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="nbs-divider" />

        {/* RIGHT — orbit loader */}
        <div className="nbs-wrap">
          <div className="nbs-circle">
            <div className="blue" /><div className="red" />
            <div className="yellow" /><div className="green" />
          </div>
          <div className="nbs-orbit">
            <div /><div /><div /><div />
          </div>
        </div>

      </div>
    </>
  );
}
