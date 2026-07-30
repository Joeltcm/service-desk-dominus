import json
import os
from datetime import date, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from auth import get_current_user, require_superadmin
import models

router = APIRouter(prefix="/api/system", tags=["system"])


# ── Permiso de escritura por módulo (nivel Edición) ────────────────────────────
def _role_feature_level(db: Session, role, key: str) -> str:
    """Nivel del rol para un módulo: 'none' | 'read' | 'write'. Sin configurar = 'write'
    (preserva el comportamiento previo). Compatible con valores booleanos antiguos."""
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "role_features").first()
    data = {}
    if row and row.value:
        try:
            data = json.loads(row.value)
        except Exception:
            data = {}
    rname = role.value if hasattr(role, "value") else str(role)
    v = (data.get(rname) or {}).get(key)
    if v is True:
        return "write"
    if v is False:
        return "none"
    if v in ("read", "write", "none"):
        return v
    return "write"


def require_module_write(feature_key: str) -> Callable:
    """Dependencia a nivel de router: las lecturas (GET) siempre pasan; las escrituras
    (POST/PUT/PATCH/DELETE) exigen nivel 'write' del rol para ese módulo. Admin/superadmin
    siempre pueden escribir."""
    def _dep(
        request: Request,
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if request.method.upper() in ("GET", "HEAD", "OPTIONS"):
            return current_user
        if current_user.role in (models.UserRole.admin, models.UserRole.superadmin):
            return current_user
        if _role_feature_level(db, current_user.role, feature_key) != "write":
            raise HTTPException(status_code=403, detail="Tu rol es de solo lectura en este módulo")
        return current_user
    return _dep

# Roles que cuentan como "staff" (asientos de trabajo). No incluye superadmin ni cliente.
STAFF_ROLES = (
    models.UserRole.admin, models.UserRole.supervisor,
    models.UserRole.agent, models.UserRole.ventas, models.UserRole.supplies,
)


def _get_max_users(db: Session) -> int:
    """Límite de usuarios staff configurado por el superadmin. 0 = ilimitado."""
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "max_users").first()
    try:
        return max(0, int(row.value)) if row and row.value else 0
    except (ValueError, TypeError):
        return 0


def count_staff_users(db: Session) -> int:
    return db.query(func.count(models.User.id)).filter(
        models.User.is_active == True,
        models.User.role.in_(STAFF_ROLES),
    ).scalar() or 0

ALL_MODULES = [
    "tickets", "agenda", "proyectos", "dashboard_servicios",
    "reportes", "knowledge_base",
    "contactos", "oportunidades", "cotizaciones", "pedidos",
    "facturas", "gastos", "inventario", "proveedores",
    "garantias", "licencias", "dashboard_ventas",
    "contratos", "impresoras", "suministros",
    "cartas",
]

DEFAULT_MODULES = {k: True for k in ALL_MODULES}
DEFAULT_TRIAL = {"enabled": False, "start_date": None, "days": 14}


# ── Modules ───────────────────────────────────────────────────────────────────

def _get_modules(db: Session) -> dict:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "system_modules").first()
    if not row or not row.value:
        return dict(DEFAULT_MODULES)
    try:
        stored = json.loads(row.value)
        merged = dict(DEFAULT_MODULES)
        merged.update({k: v for k, v in stored.items() if k in DEFAULT_MODULES})
        return merged
    except Exception:
        return dict(DEFAULT_MODULES)


# ── Trial ─────────────────────────────────────────────────────────────────────

def _get_trial(db: Session) -> dict:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "trial").first()
    if not row or not row.value:
        return dict(DEFAULT_TRIAL)
    try:
        return {**DEFAULT_TRIAL, **json.loads(row.value)}
    except Exception:
        return dict(DEFAULT_TRIAL)


def _trial_days_remaining(trial: dict) -> Optional[int]:
    """Returns days remaining (can be negative if expired). None if no trial configured."""
    if not trial.get("enabled") or not trial.get("start_date"):
        return None
    try:
        start = date.fromisoformat(trial["start_date"])
        end = start + timedelta(days=int(trial.get("days", 14)))
        return (end - date.today()).days
    except Exception:
        return None


# ── Dependency ────────────────────────────────────────────────────────────────

def require_module(module_key: str) -> Callable:
    """Blocks access if module is disabled or trial has expired. Superadmin always bypasses."""
    def _check(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if current_user.role == models.UserRole.superadmin:
            return current_user
        trial = _get_trial(db)
        remaining = _trial_days_remaining(trial)
        if remaining is not None and remaining < 0:
            raise HTTPException(status_code=402, detail="El período de prueba ha expirado")
        modules = _get_modules(db)
        if not modules.get(module_key, True):
            raise HTTPException(
                status_code=403,
                detail=f"El módulo '{module_key}' está deshabilitado en esta instalación",
            )
        return current_user
    return _check


# ── Startup seed ──────────────────────────────────────────────────────────────

def migrate_despacho_to_pedidos(db: Session):
    """One-time migration: rename 'despacho' key to 'pedidos' in system_modules."""
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "system_modules").first()
    if not row or not row.value:
        return
    try:
        data = json.loads(row.value)
        if "despacho" not in data:
            return
        data["pedidos"] = data.pop("despacho")
        row.value = json.dumps(data)
        db.commit()
    except Exception:
        pass


def seed_default_modules(db: Session):
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "system_modules").first()
    if not row:
        db.add(models.AppSetting(key="system_modules", value=json.dumps(DEFAULT_MODULES)))
        db.commit()


# ── Module endpoints ──────────────────────────────────────────────────────────

@router.get("/modules")
def get_modules(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_modules(db)


@router.put("/modules")
def update_modules(
    data: dict,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    clean = {k: bool(v) for k, v in data.items() if k in ALL_MODULES}
    merged = dict(DEFAULT_MODULES)
    merged.update(clean)
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "system_modules").first()
    if row:
        row.value = json.dumps(merged)
    else:
        db.add(models.AppSetting(key="system_modules", value=json.dumps(merged)))
    db.commit()
    return merged


# ── Trial endpoints ───────────────────────────────────────────────────────────

@router.get("/trial/status")
def get_trial_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Trial countdown visible to all authenticated users. Superadmin always gets inactive."""
    if current_user.role == models.UserRole.superadmin:
        return {"active": False, "expired": False, "days_remaining": None}
    trial = _get_trial(db)
    remaining = _trial_days_remaining(trial)
    if remaining is None:
        return {"active": False, "expired": False, "days_remaining": None}
    return {
        "active": True,
        "expired": remaining < 0,
        "days_remaining": max(0, remaining),
    }


@router.get("/trial")
def get_trial_config(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    return _get_trial(db)


@router.put("/trial")
def update_trial_config(
    data: dict,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    enabled = bool(data.get("enabled", False))
    start_date = data.get("start_date") or None
    # Si se activa el trial sin fecha de inicio, arranca hoy automáticamente
    # (evita que el contador quede inactivo por olvidar la fecha).
    if enabled and not start_date:
        start_date = date.today().isoformat()
    trial = {
        "enabled": enabled,
        "start_date": start_date,
        "days": max(1, int(data.get("days", 14))),
    }
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "trial").first()
    if row:
        row.value = json.dumps(trial)
    else:
        db.add(models.AppSetting(key="trial", value=json.dumps(trial)))
    db.commit()
    return trial


# ── Límite de usuarios ────────────────────────────────────────────────────────

@router.get("/max-users")
def get_max_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Visible para staff: cuántos usuarios staff hay y cuál es el tope."""
    return {"max_users": _get_max_users(db), "staff_count": count_staff_users(db)}


@router.put("/max-users")
def set_max_users(
    data: dict,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    try:
        val = max(0, int(data.get("max_users", 0) or 0))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Valor inválido")
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "max_users").first()
    if row:
        row.value = str(val)
    else:
        db.add(models.AppSetting(key="max_users", value=str(val)))
    db.commit()
    return {"max_users": val, "staff_count": count_staff_users(db)}
