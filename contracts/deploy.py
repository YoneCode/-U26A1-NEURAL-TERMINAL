"""
Deploy ReptileRPG.py to GenLayer Bradbury testnet.

Usage:
  1. Set DEPLOYER_PRIVATE_KEY in your .env (or export it in your shell).
  2. Run: python contracts/deploy.py

The script loads .env automatically (via python-dotenv if available, or
manual parse as a fallback) so you never need to hardcode secrets here.
"""
import collections.abc
if not hasattr(collections.abc, "Buffer"):
    collections.abc.Buffer = bytes

# ── Cloudflare UA bypass ───────────────────────────────────────────────────────
# rpc-bradbury.genlayer.com sits behind Cloudflare, which blocks the default
# "python-requests/x.x" User-Agent with a 403 challenge page.
# We patch requests.Session before any library imports it so every outbound
# HTTP call carries a neutral UA that Cloudflare passes through.
import requests as _req
_orig_req = _req.Session.request
def _ua_patched(self, method, url, **kwargs):
    hdrs = dict(kwargs.get("headers") or {})
    hdrs.setdefault("User-Agent", "Mozilla/5.0 (GenLayer Deploy/1.0)")
    kwargs["headers"] = hdrs
    return _orig_req(self, method, url, **kwargs)
_req.Session.request = _ua_patched

import os
import sys

# ── Load .env from project root (one level up from this file) ─────────────────
# Uses python-dotenv when installed; falls back to a minimal manual parser so
# the script works even in a bare venv without extra dependencies.
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env")

try:
    from dotenv import load_dotenv
    load_dotenv(_env_path, override=False)
except ModuleNotFoundError:
    # Minimal .env parser — handles KEY=VALUE and KEY="VALUE" lines
    if os.path.exists(_env_path):
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                _line = _line.strip()
                if not _line or _line.startswith("#") or "=" not in _line:
                    continue
                _k, _, _v = _line.partition("=")
                _v = _v.strip().strip('"').strip("'")
                os.environ.setdefault(_k.strip(), _v)

# ── Resolve private key — never hardcoded ─────────────────────────────────────
PRIVATE_KEY = os.environ.get("DEPLOYER_PRIVATE_KEY", "").strip()
if not PRIVATE_KEY or PRIVATE_KEY == "REPLACE_WITH_YOUR_PRIVATE_KEY":
    sys.exit(
        "\n[deploy] ERROR: DEPLOYER_PRIVATE_KEY is not set.\n"
        "  Add it to your .env file or export it in your shell:\n"
        "    export DEPLOYER_PRIVATE_KEY=0x<your-key>\n"
    )

RPC_URL        = os.environ.get("VITE_GENLAYER_RPC", "https://rpc-bradbury.genlayer.com")
CHAIN_ID       = 4221
CONSENSUS_MAIN = "0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D"
CONSENSUS_DATA = "0x85D7bf947A512Fc640C75327A780c90847267697"
CONTRACT_FILE  = os.path.join(os.path.dirname(__file__), "ReptileRPG.py")

from genlayer_py.types import GenLayerChain, NativeCurrency
from genlayer_py.consensus.abi import CONSENSUS_MAIN_ABI, CONSENSUS_DATA_ABI
from genlayer_py.chains.testnet_asimov import testnet_asimov
from genlayer_py.client import create_client
from eth_account import Account

bradbury: GenLayerChain = GenLayerChain(
    id=CHAIN_ID,
    name="GenLayer Bradbury Testnet",
    rpc_urls={"default": {"http": [RPC_URL]}},
    native_currency=NativeCurrency(name="GEN Token", symbol="GEN", decimals=18),
    block_explorers={"default": {"name": "Bradbury Explorer",
                                  "url": "https://explorer-bradbury.genlayer.com"}},
    testnet=True,
    consensus_main_contract={
        "address": CONSENSUS_MAIN,
        "abi": CONSENSUS_MAIN_ABI,
        "bytecode": "",
    },
    consensus_data_contract={
        "address": CONSENSUS_DATA,
        "abi": CONSENSUS_DATA_ABI,
        "bytecode": "",
    },
    default_number_of_initial_validators=5,
    default_consensus_max_rotations=3,
)

deployer = Account.from_key(PRIVATE_KEY)
print(f"Deployer address : {deployer.address}")
print(f"RPC              : {RPC_URL}")
print(f"Chain ID         : {CHAIN_ID}")
print(f"Consensus main   : {CONSENSUS_MAIN}")
print()

client = create_client(chain=bradbury, account=deployer)

with open(CONTRACT_FILE, "r", encoding="utf-8") as f:
    code = f.read()

print("Deploying ReptileRPG.py …")
tx_hash = client.deploy_contract(code=code.encode())
print(f"Deploy tx hash   : {tx_hash}")

receipt = client.w3.eth.get_transaction_receipt(tx_hash)
if receipt:
    print(f"Block            : {receipt.blockNumber}")

print()
print("Fetching deployed contract address from Bradbury explorer …")
import urllib.request, json, time

for attempt in range(10):
    time.sleep(6)
    try:
        url = f"https://explorer-bradbury.genlayer.com/api/v1/transactions/{tx_hash}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        data = json.loads(urllib.request.urlopen(req, timeout=10).read())
        addr = data.get("deployed_contract_address")
        if addr:
            print(f"\n✅  CONTRACT ADDRESS: {addr}\n")
            env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
            with open(env_path, "r") as ef:
                env_text = ef.read()
            # Replace existing value or append if not present
            if "VITE_REPTILE_RPG_ADDRESS=" in env_text:
                import re
                env_text = re.sub(
                    r"VITE_REPTILE_RPG_ADDRESS=.*",
                    f"VITE_REPTILE_RPG_ADDRESS={addr}",
                    env_text,
                )
            else:
                env_text += f"\nVITE_REPTILE_RPG_ADDRESS={addr}\n"
            with open(env_path, "w") as ef:
                ef.write(env_text)
            print(f"VITE_REPTILE_RPG_ADDRESS written to .env")
            break
        else:
            print(f"  attempt {attempt+1}/10 — status: {data.get('status','?')} — waiting …")
    except Exception as e:
        print(f"  attempt {attempt+1}/10 — error: {e}")
else:
    print("Could not retrieve contract address automatically.")
    print(f"Check: https://explorer-bradbury.genlayer.com/transaction/{tx_hash}")
