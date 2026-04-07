# CLAUDE.md — ik-dragon-genlayer

---

## ⚠️ CRITICAL RULES — READ BEFORE EVERY TASK

> **These rules are absolute and override all other instructions.**

1. **NEVER touch game logic.** `ReptileLogic.jsx` canvas drawing, IK segment math, particle physics, hunt/eat/kill scoring, lizard setup, animation loop — all sacred. Zero modifications.
2. **NEVER touch the smart contract.** `contracts/ReptileRPG.py` and `contracts/deploy_reptile.mjs` are frozen. Do not edit, rewrite, or redeploy unless the user explicitly requests it in a dedicated task.
3. **NEVER rename copy/labels.** `VALIDATORS`, `STAGE`, `EXPLORER`, `EPOCHS`, `ANALYTICS`, `TX FEED`, `LOADING CORE`, `SOUL DISCONNECTED`, `SAVING TO GAARA`, `SYNAPTIC PAYLOAD COMMITTED`, `ETERNAL LEDGER UPDATED` — these exact strings are immutable for hackathon credibility.
4. **NEVER change the 50/50 layout split.** `panel-left` and `panel-right` widths stay at `50vw`. Do not adjust.
5. **Styling scope only.** All design work targets `App.css`, `Dashboard.jsx` inline styles, `DragonHUD.jsx`, and `TxToast.jsx` visual properties. Anything else requires explicit permission.

---

## Design Context

### Project Summary

A live split-panel dashboard monitoring the GenLayer Bradbury testnet. Left panel: IDE-style terminal showing real transactions, validator state, epochs, and analytics. Right panel: full-bleed canvas where an IK dragon hunts "failed" and "rejected" transactions (red/orange particles), kill count permanently on-chain via `ReptileRPG.py`.

**Stack**: React 18 · Vite · Custom CSS only (no UI library) · JetBrains Mono · genlayer-js

---

### Users

**Primary**: GenLayer hackathon judges and builders — technical credibility and real chain data are non-negotiable.
**Secondary**: Public demo / viral showcase — instant wow-factor for non-crypto audiences.
Both must be satisfied simultaneously: *impress the judge and enchant the stranger.*

---

### Brand Personality

**Mystical · Technical · Alive**

The interface channels data, not just displays it. Lore-heavy language reinforces that the blockchain is a living organism and the dragon is its guardian. Tone: dramatically understated, precise, clinical mysticism.

---

### First Impression (must land in under 3 seconds)

1. **"What IS this?"** — Immediate intrigue, unfamiliar enough to demand attention.
2. **"This is impressive"** — Instant credibility; real chain data, working on-chain contract, technical precision.
3. **"This is alive"** — Particles move, terminal updates, dragon hunts. Nothing is static.

---

### Aesthetic Direction

**Dark mode only. Non-negotiable.**

Push backgrounds deeper than VS Code defaults — near-`#000` anchors every section. Contrast lives entirely in neon status colors and the `#569cd6` accent, never in background variation.

**Anti-references**: No rounded cards. No friendly gradients. No white. No soft shadows. No sans-serif.

---

### Color Palette

```
Backgrounds:   #020208 (deep base) · #0f0f16 · #141422 · #1e1e1e · #252526 · #2d2d30
Borders:       #1e1e30 standard · #1a1a24 deeper
Text:          #e2e2e2 primary · #4e5057 muted · #686882 label grey
Accent blue:   #569cd6
Status neon:
  Red    #ef4444  — FAILED / ERROR
  Orange #f97316  — REJECTED
  Green  #22c55e  — ACCEPTED / FINALIZED
  Yellow #eab308  — PENDING / NEW
  Cyan   #06b6d4  — PROPOSING / COMMITTING / WRITING TO CHAIN
Extra:   #4ec9b0 teal · #69ff47 neon green · #b388ff purple hint
```

---

### CSS Tokens

```css
:root {
  --mono:    "JetBrains Mono", "Consolas", "Courier New", monospace;
  --bg-main: #020208;   /* deepest base — html/body/root */
  --bg:      #020208;
  --bg2:     #0f0f16;
  --bg3:     #141422;
  --bdr:     #1e1e30;
  --dim:     #4e5057;
  --txt:     #e2e2e2;
  --act:     #569cd6;
  /* Glow values used inline (not yet formally tokenized): */
  /* --glow-cyan: rgba(6, 182, 212, 0.15)                  */
  /* --glow-blue: rgba(86, 156, 214, 0.12)                 */
}
```

---

### Typography

JetBrains Mono exclusively. Sizes 9–13px. Weight 400/600/700. Generous letter-spacing on labels (0.08–0.13em). ALL CAPS for section headers and status labels.

---

### Design Principles

1. **Cinematic darkness first** — Near-black backgrounds anchor every section. Neon and `#569cd6` provide all contrast.
2. **Earn every glow** — Glow/pulse effects reserved for semantically meaningful moments (active status, on-chain confirmations, live transmissions). Decorative glows dilute signal.
3. **Lore coherence** — Copy, colors, and micro-animations reinforce the mystical/technical narrative. A cyan border glow means something is *transmitting*.
4. **Data as organism** — The terminal breathes: pulsing status dots, log line entrances, block number ticks. No static rows.
5. **Sacred copy, sacred canvas** — Labels never change. The dragon's world is never touched. Design work lives in the shell around them.

---

### Component Reference

**DragonHUD** (`height: 60px`, `zIndex: 10`, `pointerEvents: none` — mouse events pass through to canvas)
- Left 32%: Soul Identity — `LOADING CORE…` → `SOUL DISCONNECTED` → `SAVING TO GAARA…` → `(我愛羅) [VERIFIED ON-CHAIN]`
- Center flex: Level number · XP bar (100 hunts/level) · Batch sub-bar (25 hunts/TX) · SYNC indicator
- Right 30%: Contract address link · Total Hunts · Chain status dot

**SYNC Indicator states**:
| State | Color | Animation | Label |
|-------|-------|-----------|-------|
| loading | `#569cd6` | searchPulse 1.4s | LOADING |
| fetching | `#569cd6` | searchPulse 1.4s | FETCH |
| synced | `#69ff47` | none | SYNCED |
| pending | `#b388ff` | searchPulse 1.0s | PENDING |
| writing | `#06b6d4` | searchPulse 0.8s | SAVING |
| failed | `#f44747` | none | FAILED |
| disconnected | `#4e5057` | none | OFFLINE |

**TxToast** — Glassmorphism notification, `top: 62px`, centered under HUD (`left: 32%`, `right: 30%`)
- `background: rgba(0, 8, 20, 0.84)`, `backdropFilter: blur(18px)`, cyan border `rgba(6, 182, 212, 0.22)`
- Neon gradient accent line at top, cyan left-edge glow stripe
- Phase animation: hidden → visible (30ms delay) → fading (6500ms) → dismiss (8000ms)
- Copy: `SYNAPTIC PAYLOAD COMMITTED.` in cyan · `ETERNAL LEDGER UPDATED.` in neon green
