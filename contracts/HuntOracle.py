# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json

# ── Configuration ──────────────────────────────────────────────────────────────
# All validators independently fetch this URL during consensus. The result must
# be deterministic enough that all 5 validators reach the same threat_level.
BRADBURY_API = "https://explorer-bradbury.genlayer.com/api/v1"

# pending tx count → threat tier (evaluated in descending threshold order)
THREAT_MAP = [
    (20, "CRITICAL", 140),  # >20 pending   → 1.40× batch multiplier (basis pts)
    (10, "HIGH",     125),  # >10 pending   → 1.25×
    ( 5, "MEDIUM",   115),  # > 5 pending   → 1.15×
    ( 0, "LOW",      100),  # anything else → 1.00×
]


class HuntOracle(gl.Contract):
    # ── Persistent state ────────────────────────────────────────────────────────
    owner:            str
    threat_level:     str   # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    pending_count:    u64   # raw pending tx count from last update
    validator_count:  u64   # number of active validators
    last_epoch:       u64   # epoch number at last update
    batch_multiplier: u64   # basis points: 100 = 1×, 125 = 1.25×, etc.

    # ── Constructor ─────────────────────────────────────────────────────────────
    def __init__(self) -> None:
        self.owner            = str(gl.message.sender_address)
        self.threat_level     = "LOW"
        self.pending_count    = u64(0)
        self.validator_count  = u64(0)
        self.last_epoch       = u64(0)
        self.batch_multiplier = u64(100)

    # ── Guards ──────────────────────────────────────────────────────────────────
    def _only_owner(self) -> None:
        assert str(gl.message.sender_address).lower() == self.owner.lower(), \
            "HuntOracle: caller is not the owner"

    # ── Write: refresh threat level from live chain data ────────────────────────
    # Called by the owner's automated script (scripts/update_oracle.mjs).
    # GenLayer validators each execute the web requests independently; consensus
    # ensures only an agreed result mutates state.
    @gl.public.write
    def update_threat(self) -> None:
        """
        Fetches live Bradbury network congestion via gl.get_webpage().
        All 5 validators must reach consensus on the result before state updates.
        Public — any caller may refresh the oracle (data is read from a public API).
        """

        # ── Fetch pending transactions ─────────────────────────────────────────
        pending = 0
        try:
            raw = gl.get_webpage(
                f"{BRADBURY_API}/transactions?page=1&page_size=50&status=pending",
                mode="text",
            )
            data = json.loads(raw)
            txs  = data.get("transactions") or data.get("items") or []
            pending = len(txs)
        except Exception:
            pass

        # ── Fetch epoch number ─────────────────────────────────────────────────
        epoch_n = 0
        try:
            raw = gl.get_webpage(
                f"{BRADBURY_API}/epochs?page=1&page_size=1",
                mode="text",
            )
            data   = json.loads(raw)
            epochs = data.get("epochs") or []
            if epochs:
                epoch_n = int(epochs[0].get("epoch_number", 0))
        except Exception:
            pass

        # ── Fetch validator count ──────────────────────────────────────────────
        val_cnt = 0
        try:
            raw = gl.get_webpage(
                f"{BRADBURY_API}/validators?page=1&page_size=1",
                mode="text",
            )
            data    = json.loads(raw)
            val_cnt = int(data.get("total", 0))
        except Exception:
            pass

        # ── Derive threat tier ─────────────────────────────────────────────────
        threat, mult = "LOW", 100
        for threshold, level, basis_pts in THREAT_MAP:
            if pending > threshold:
                threat = level
                mult   = basis_pts
                break

        # ── Commit ────────────────────────────────────────────────────────────
        self.pending_count    = u64(pending)
        self.validator_count  = u64(val_cnt)
        self.last_epoch       = u64(epoch_n)
        self.threat_level     = threat
        self.batch_multiplier = u64(mult)

    # ── View ────────────────────────────────────────────────────────────────────
    @gl.public.view
    def get_oracle(self) -> dict:
        return {
            "threat_level":    self.threat_level,
            "pending_count":   int(self.pending_count),
            "validator_count": int(self.validator_count),
            "last_epoch":      int(self.last_epoch),
            "batch_multiplier": int(self.batch_multiplier),
        }
