# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

MAX_BATCH_SIZE = 25


class ReptileRPG(gl.Contract):
    # ── Persistent state ───────────────────────────────────────────────────────
    # GenLayer storage requires sized integers — plain `int` is rejected by the
    # storage generator since Bradbury runtime v2. Use u64 for counters and
    # str for address / name fields.
    owner:              str
    soul_name:          str
    total_hunts:        u64
    current_level:      u64
    authorized_burner:  str   # whitelisted address allowed to call record_batch

    # ── Constructor ────────────────────────────────────────────────────────────
    def __init__(self) -> None:
        # gl.message.sender_address is an Address object — str() cast for str storage
        self.owner              = str(gl.message.sender_address)
        self.soul_name          = "(我愛羅)"
        self.total_hunts        = u64(0)
        self.current_level      = u64(0)
        self.authorized_burner  = ""   # empty until owner calls set_burner()

    # ── Internal guards ────────────────────────────────────────────────────────
    # GenLayer returns sender_address in lowercase hex. Normalize all comparisons
    # to lowercase so checksummed (EIP-55) input strings match correctly.
    def _only_owner(self) -> None:
        assert str(gl.message.sender_address).lower() == self.owner.lower(), \
            "ReptileRPG: caller is not the owner"

    def _only_authorized(self) -> None:
        """Allows both the owner and the whitelisted burner wallet."""
        sender = str(gl.message.sender_address).lower()
        assert sender in [self.owner.lower(), self.authorized_burner.lower()], \
            "Not authorized to feed"

    # ── Write: register the burner wallet (owner-only) ────────────────────────
    @gl.public.write
    def set_burner(self, burner_address: str) -> None:
        self._only_owner()
        self.authorized_burner = burner_address.lower()

    # ── Write: record a batch of hunts ────────────────────────────────────────
    @gl.public.write
    def record_batch(self, amount: u64) -> None:
        self._only_authorized()
        assert amount > u64(0),               "amount must be positive"
        assert amount <= u64(MAX_BATCH_SIZE), "amount exceeds MAX_BATCH_SIZE"
        self.total_hunts = self.total_hunts + amount

    # ── Write: register a new level milestone ─────────────────────────────────
    @gl.public.write
    def register_level_up(self, new_level: u64) -> None:
        self._only_owner()
        assert new_level > self.current_level, \
            "new_level must strictly exceed current_level"
        self.current_level = new_level

    # ── View: return all stats in one call ────────────────────────────────────
    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "soul_name":         self.soul_name,
            "total_hunts":       int(self.total_hunts),
            "current_level":     int(self.current_level),
            "authorized_burner": self.authorized_burner,
        }
