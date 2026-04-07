# ⚡ NEURAL TERMINAL

A live split-panel blockchain explorer for the [GenLayer Bradbury testnet](https://explorer-bradbury.genlayer.com).
The left panel is an IDE-style terminal showing real transactions, validator state, epochs, and
network analytics. The right panel is a full-bleed canvas where an IK creature — **Zahif** — hunts
failed and rejected transactions rendered as colour-coded particles, writing every confirmed kill
batch permanently to a GenLayer smart contract.

**Stack:** React 18 · Vite 5 · Custom CSS · JetBrains Mono · genlayer-js · HTML5 Canvas API

---

## How It Works

### Neural Graph — `NeuralCanvas.jsx`

The background canvas is not decorative. It is a direct visual encoding of the GenLayer
consensus pipeline. Six nodes are placed at fixed percentage coordinates across the canvas:

```
Node 0 → (10%, 50%)   PENDING
Node 1 → (30%, 30%)   PROPOSING  — Leader selected, transaction broadcast
Node 2 → (50%, 70%)   COMMITTING — Validators lock in encrypted votes
Node 3 → (70%, 40%)   REVEALING  — Votes decrypted, tally computed
Node 4 → (85%, 60%)   ACCEPTED   — Supermajority reached
Node 5 → (95%, 50%)   FINALIZED  — Block inclusion confirmed
```

On every animation frame, `buildLivePulseMap(txFeed)` walks the live transaction feed and
produces a `Map<nodeIdx, { color }>` keyed by `tx.stageIdx`. The stageIdx is derived in
`useGenLayer.js` from the raw Bradbury status string via a `STATUS_TO_STAGE` lookup table.
When multiple transactions occupy the same stage simultaneously, the one with the higher
stageIdx takes priority for that node slot.

Node colour encodes consensus health:

| Condition | Colour | Meaning |
|---|---|---|
| `tx.isError === true` | `#ff5252` | Execution reverted |
| `stageIdx >= 4` | `#69ff47` | Accepted / Finalized |
| `stageIdx >= 2` | `#ffb300` | Mid-consensus (Committing / Revealing) |
| `stageIdx < 2` | `#ffe040` | Early-stage (Pending / Proposing) |
| No tx | `#00e5ff` | Idle node — default network colour |

Nodes are connected by bezier axons rendered in three passes per connection: a wide diffused
glow, a mid-intensity stroke, and a sharp core thread. Dendrite branches are spawned at
3–5 positions along each axon, curling perpendicular to the curve tangent. All geometry
uses `dRand(seed)` — a deterministic sin-based PRNG — so the layout is identical across
every session and device, no `Math.random()`.

An expanding radar ring is drawn behind each nucleus on every frame, fading to zero at a
50 px radius over a 1.5 s cycle. Per-node phase stagger prevents all six rings from
pulsing in lockstep.

---

### Particle Engine — `ReptileLogic.jsx`

The right canvas maintains a pool of **180 particles**. Each particle can be in one of
two states:

- **Neutral** — small dim dot (`1.5 px`, `#2a2a3a`), drifting at speed ≤ 1 unit/frame
- **Active** — sized `0.5–8 px`, coloured by `STATUS_COLOR_MAP[tx.status]`, bound to a
  specific transaction hash for a 5 000 ms TTL

Every animation frame runs a three-phase `syncTxColors()` pass:

1. **EXPIRE** — particles whose `ttlExpiry` has elapsed release their transaction binding
   and return to the neutral pool. The eaten-set entry is also cleared, allowing that
   hash to be re-claimed if the transaction reappears in the feed.
2. **ASSIGN** — neutral particles claim unclaimed, uneaten transactions from an interleaved
   merge of `txFeed` (GenLayer Bradbury) and `standardTxs` (standard explorer API).
3. **REFRESH** — active particles update their colour from the latest feed state, so a
   transaction moving from PENDING → FINALIZED changes colour in real time.

Zahif is a 3-segment IK skeleton (`critter.follow(huntX, huntY)`) that smoothly tracks
the first particle whose colour appears in `HUNT_STATUS_COLORS` — the set of red and
orange status colours associated with failed and rejected transactions. On contact
(`distance < 45 px`), the particle's hash is added to `eatenTxsRef`, its position is
teleported off-canvas, and 15 spark particles are emitted. A running kill count is passed
to `App.jsx` via the `onEat` callback.

---

### Kill Accounting & On-Chain Persistence — `ReptileRPG.py`

Kills are tracked optimistically client-side. Every time the cumulative kill count crosses
a multiple of `BATCH_SIZE` (default 25, dynamically scaled by `HuntOracle.batch_multiplier`),
`App.jsx` calls `useReptileRPG.recordBatch(amount)`. The burner wallet signs a
`record_batch(amount)` transaction against the deployed `ReptileRPG` contract. A polling
loop then reads `get_stats()` silently every 10 s for up to 8 minutes until
`total_hunts` increases, confirming on-chain acceptance. If the level threshold
(`floor(total_hunts / 100)`) advances after confirmation, `register_level_up(newLevel)` is
automatically dispatched in the same write session.

The display total is always: `chain.total_hunts + unconfirmed_session_kills`, keeping the
UI responsive during the 1–5 minute GenLayer consensus window.

---

## Smart Contracts

Both optional contracts are deployed on the **GenLayer Bradbury testnet** and read from the
frontend via `genlayer-js` using a shared read-only client (no account required for views).
`useMultiContract.js` polls both every 60 s with a 5 s stagger; strict equality guards
(`oracleEqual`, `loreEqual`) prevent re-renders when values are unchanged.

---

### `HuntOracle.py` — Network Threat Detection

The oracle measures live Bradbury network congestion and translates it into a threat tier
that dynamically scales the frontend's kill-batch size.

**On-chain behaviour (`update_threat`):**

Every GenLayer validator independently executes three `gl.get_webpage()` calls against the
Bradbury explorer API — pending transactions, current epoch, and validator count. Because
`gl.get_webpage()` is a non-deterministic operation, all five validators must reach
consensus on the fetched result before any state mutation is committed. This is the core
property of GenLayer: untrusted external data is made trustworthy through multi-party
agreement, not a single oracle relay.

```
Pending TX count → Threat tier → batch_multiplier
─────────────────────────────────────────────────
> 20             → CRITICAL    → 1.40×  (140 basis points)
> 10             → HIGH        → 1.25×  (125)
>  5             → MEDIUM      → 1.15×  (115)
  ≤ 5            → LOW         → 1.00×  (100)
```

The `batch_multiplier` is read by the frontend and applied as:
```
BATCH_SIZE = clamp(round(25 × multiplier / 100), 25, 50)
```

Under CRITICAL network load the batch threshold rises to 35, meaning the dragon must
consume 35 particles before a chain write fires — slowing writes to reduce congestion
pressure from the burner wallet.

**View:** `get_oracle()` → `{ threat_level, pending_count, validator_count, last_epoch, batch_multiplier }`

**Explorer:** `https://explorer-bradbury.genlayer.com/address/<VITE_HUNT_ORACLE_ADDRESS>`

---

### `DragonLore.py` — AI Chronicles via GenLayer Consensus

Each time Zahif clears a level milestone, an off-chain trigger calls `evolve(total_hunts,
current_level)`. The contract calls `gl.exec_prompt()` with a structured prompt asking a
language model to produce a single terse system-log line reflecting the entity's current
state. GenLayer validators each run the LLM call independently; the resulting text must
reach consensus before it is stored.

The prompt encodes a milestone tier (`_era_for`) based on cumulative hunt count:

| Range | Era |
|---|---|
| < 100 | `bootstrap` |
| 100 – 499 | `initialized` |
| 500 – 999 | `active-trace` |
| 1 000 – 4 999 | `sustained-index` |
| 5 000 – 9 999 | `deep-sync` |
| ≥ 10 000 | `ancient-epoch` |

The LLM output is sanitised (stripped of quotes, newlines, hard-capped at 100 characters)
and stored in `chronicle`. The HUD ticker displays this line in real time. LLM failure is
explicitly non-fatal — the previous chronicle is retained.

**View:** `get_lore()` → `{ chronicle, evolution_count, last_milestone }`

**Explorer:** `https://explorer-bradbury.genlayer.com/address/<VITE_DRAGON_LORE_ADDRESS>`

---

## Setup

```bash
git clone https://github.com/YoneCode/-U26A1-NEURAL-TERMINAL.git
cd -U26A1-NEURAL-TERMINAL
npm install
cp .env.example .env
```

Edit `.env`:

```env
# Required — deployed ReptileRPG contract address
VITE_REPTILE_RPG_ADDRESS=0x...

# Required — dedicated burner wallet private key (testnet only, zero real value)
VITE_PLAYER_PRIVATE_KEY=0x...

# Required once — deployer/owner key, used by setup scripts only, never the browser
DEPLOYER_PRIVATE_KEY=0x...

# Optional — enables live threat level and dynamic batch scaling
VITE_HUNT_ORACLE_ADDRESS=0x...

# Optional — enables AI chronicle ticker in the HUD
VITE_DRAGON_LORE_ADDRESS=0x...
```

```bash
npm run dev
```

---

## Deployment

### 1. Deploy contracts

```bash
npm run deploy-contracts
```

This deploys `ReptileRPG.py`, `HuntOracle.py`, and `DragonLore.py` to Bradbury and
writes the resulting addresses back into `.env` automatically.

### 2. Authorise the burner wallet

```bash
npm run set-burner
```

Calls `set_burner(VITE_PLAYER_PRIVATE_KEY address)` on ReptileRPG from the deployer
wallet. Until this runs, `record_batch()` will revert for any address that is not
the contract owner.

### 3. Build and deploy frontend

```bash
npm run build
```

Deploy the `dist/` directory to **Cloudflare Pages** (recommended). The `public/_redirects`
file contains proxy rules that mirror the Vite dev-server configuration, routing
`/bradbury-api/*` and `/standard-api/*` transparently to the GenLayer explorer APIs
without CORS restrictions.

### 4. Update the oracle (optional, recurring)

```bash
npm run update-oracle
```

Calls `update_threat()` on the deployed `HuntOracle` contract. Run this on a cron job or
manually before a demo to refresh the threat level from live chain state.

---

## Architecture

```
GenLayer Bradbury Testnet
  ├── ReptileRPG.py      Kill tracking, level registration
  ├── HuntOracle.py      Network congestion → threat tier (gl.get_webpage)
  └── DragonLore.py      AI system-log generation (gl.exec_prompt)
        ↕ genlayer-js (leaderOnly reads, burner wallet writes)
React 18 Frontend (Vite)
  ├── useGenLayer.js     WS + polling feed, O(1) Map-based state updates
  ├── useReptileRPG.js   Kill batching, optimistic UI, 8-min consensus poll
  ├── useMultiContract.js  Oracle + Lore reads, 60 s interval, equality guards
  ├── NeuralCanvas.jsx   6-node stage graph, live pulse map, deterministic geometry
  ├── ReptileLogic.jsx   180-particle pool, TTL lifecycle, IK hunt skeleton
  └── Dashboard.jsx      Terminal feed, validator state, epochs, analytics
```

---

## Testnet

All contracts are deployed on the **GenLayer Bradbury testnet**. This is not a production
environment. The burner wallet private key is intentionally bundled into the client build
for frictionless testnet interaction — never use a key holding real assets.

Bradbury explorer: [explorer-bradbury.genlayer.com](https://explorer-bradbury.genlayer.com)
