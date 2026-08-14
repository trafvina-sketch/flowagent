"""
License management router — proxies requests to Supabase Edge Functions.
Persists license to license.json for offline/restart support.
"""

import logging
import os
import json
import time
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

import aiohttp

logger = logging.getLogger("license")

router = APIRouter(prefix="/api/license", tags=["License"])

SUPABASE_FUNCTIONS_URL = "https://qgcixqkkkgjenlvyagja.supabase.co/functions/v1"

# License file stored next to the exe (or CWD in dev)
LICENSE_FILE = os.path.join(os.getcwd(), "license.json")


# ── Request models ──────────────────────────────────────────────

class ValidateLicenseRequest(BaseModel):
    license_key: str
    device_id: str
    device_name: Optional[str] = None
    ip_address: Optional[str] = None


class CheckStatusRequest(BaseModel):
    license_key: str


class DeactivateRequest(BaseModel):
    activation_ids: Optional[list[str]] = None
    license_id: Optional[str] = None


# ── License file helpers ────────────────────────────────────────

def _save_license_file(license_key: str, license_data: dict):
    """Save license to local file for persistence across restarts."""
    try:
        payload = {
            "license_key": license_key,
            "license": license_data,
            "timestamp": time.time(),
            "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        with open(LICENSE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        logger.info("[License] Saved to %s", LICENSE_FILE)
    except Exception as e:
        logger.error("[License] Failed to save: %s", e)


def _load_license_file() -> dict | None:
    """Load license from local file."""
    try:
        if os.path.isfile(LICENSE_FILE):
            with open(LICENSE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.error("[License] Failed to load: %s", e)
    return None


def _clear_license_file():
    """Remove local license file."""
    try:
        if os.path.isfile(LICENSE_FILE):
            os.remove(LICENSE_FILE)
    except Exception:
        pass


# ── Supabase proxy helper ──────────────────────────────────────

async def _proxy_to_supabase(edge_fn: str, payload: dict) -> dict:
    """Forward a JSON payload to a Supabase Edge Function and return the response."""
    url = f"{SUPABASE_FUNCTIONS_URL}/{edge_fn}"
    logger.info("[License] Proxying to %s", url)

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                body = await resp.json(content_type=None)
                logger.info("[License] %s responded %s", edge_fn, resp.status)
                return {"status": resp.status, "data": body}
    except aiohttp.ClientError as exc:
        logger.error("[License] Network error reaching %s: %s", edge_fn, exc)
        return {"status": 502, "data": {"error": f"Supabase unreachable: {exc}"}}
    except Exception as exc:
        logger.error("[License] Unexpected error: %s", exc)
        return {"status": 500, "data": {"error": f"Internal proxy error: {exc}"}}


# ── Endpoints ───────────────────────────────────────────────────

@router.post("/validate")
async def validate_license(body: ValidateLicenseRequest):
    """Validate a license key and register the device. Auto-saves to file on success."""
    result = await _proxy_to_supabase("validate-license", body.model_dump(exclude_none=True))
    data = result.get("data", result)

    # Auto-save on successful validation
    if isinstance(data, dict) and data.get("valid"):
        _save_license_file(body.license_key, data)

    return data


@router.post("/check-status")
async def check_license_status(body: CheckStatusRequest):
    """Check the current status of a license key."""
    result = await _proxy_to_supabase("check-license-status", body.model_dump())
    return result.get("data", result)


@router.post("/deactivate")
async def deactivate_device(body: DeactivateRequest):
    """Deactivate device(s) by activation IDs or license ID."""
    result = await _proxy_to_supabase("deactivate-device", body.model_dump(exclude_none=True))
    return result.get("data", result)


# ── Local license cache endpoints ──────────────────────────────

@router.get("/local")
async def get_local_license():
    """Read saved license from local file."""
    data = _load_license_file()
    if data and data.get("license", {}).get("valid"):
        return {"success": True, **data}
    return {"success": False, "license": None}


@router.post("/local/save")
async def save_local_license(body: dict):
    """Manually save license to local file."""
    license_key = body.get("license_key", "")
    license_data = body.get("license", {})
    if license_key and license_data:
        _save_license_file(license_key, license_data)
        return {"success": True}
    return {"success": False, "error": "Missing license_key or license data"}


@router.post("/local/clear")
async def clear_local_license():
    """Clear saved license."""
    _clear_license_file()
    return {"success": True}
