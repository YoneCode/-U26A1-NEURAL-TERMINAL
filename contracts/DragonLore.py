# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

# ── Milestone tiers — map total_hunts floor to a system descriptor ─────────────
# The LLM receives this descriptor so its output matches the indexer theme.
def _era_for(total_hunts: int) -> str:
    if total_hunts >= 10_000: return "ancient-epoch"
    if total_hunts >=  5_000: return "deep-sync"
    if total_hunts >=  1_000: return "sustained-index"
    if total_hunts >=    500: return "active-trace"
    if total_hunts >=    100: return "initialized"
    return "bootstrap"


class DragonLore(gl.Contract):
    # ── Persistent state ────────────────────────────────────────────────────────
    owner:          str
    rpg_contract:   str    # address of ReptileRPG — also permitted to trigger evolve
    chronicle:      str    # last AI-generated system log line
    evolution_count: u64   # number of successful evolutions
    last_milestone:  u64   # total_hunts value at last evolution

    # ── Constructor ─────────────────────────────────────────────────────────────
    def __init__(self, rpg_contract: str) -> None:
        self.owner            = str(gl.message.sender_address)
        self.rpg_contract     = rpg_contract.lower()
        self.chronicle        = "Entity boot sequence complete. Awaiting first index cycle."
        self.evolution_count  = u64(0)
        self.last_milestone   = u64(0)

    # ── Guards ──────────────────────────────────────────────────────────────────
    def _only_authorized(self) -> None:
        sender = str(gl.message.sender_address).lower()
        assert sender in [self.owner.lower(), self.rpg_contract], \
            "DragonLore: caller is not authorized"

    # ── Write: generate a new chronicle entry via LLM ───────────────────────────
    # Called by the owner's automated script after a confirmed level-up.
    # The LLM is asked only to return a single system-log style sentence — no JSON,
    # no formatting — so output is safe to store directly.
    @gl.public.write
    def evolve(self, total_hunts: u64, current_level: u64) -> None:
        """
        Uses gl.exec_prompt() to generate a new chronicle entry reflecting
        the indexer's current milestone. Never called from the browser —
        always triggered by the owner wallet after a confirmed register_level_up.
        """
        self._only_authorized()

        hunts = int(total_hunts)
        level = int(current_level)
        era   = _era_for(hunts)

        prompt = (
            "You are the logging system of an autonomous blockchain indexer called (我愛羅). "
            "Write ONE single line of system-log output — no quotes, no labels — that reports "
            f"the current state: entity has completed {hunts} index cycles, "
            f"is operating at tier {level}, classified as '{era}'. "
            "Style: terse, technical, 50–90 characters, present tense. "
            "Do not use markdown. Output ONLY the log line, nothing else."
        )

        try:
            raw = gl.exec_prompt(prompt)
            line = str(raw).strip()
            # Strip any accidental quotes or newlines from the LLM output
            line = line.strip('"').strip("'").replace("\n", " ").strip()
            # Hard cap to 100 chars so the HUD ticker never overflows
            if len(line) > 100:
                line = line[:97] + "..."
            if line:
                self.chronicle = line
            self.evolution_count = self.evolution_count + u64(1)
            self.last_milestone  = u64(hunts)
        except Exception:
            pass  # LLM failure is non-fatal — keep current chronicle

    # ── View ────────────────────────────────────────────────────────────────────
    @gl.public.view
    def get_lore(self) -> dict:
        return {
            "chronicle":       self.chronicle,
            "evolution_count": int(self.evolution_count),
            "last_milestone":  int(self.last_milestone),
        }
