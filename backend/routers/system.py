import json
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
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
    # Integraciones (no son ítems de navegación; se togglean como feature).
    "google_calendar",
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


# ── Facturación / Corte mensual del portal ──────────────────────────────────────
# El acceso del STAFF (nunca clientes, nunca superadmin) depende de la confirmación
# mensual de pago que registra el superadmin. Los tiempos (día de corte, cuándo
# aparece el aviso y cuánto dura antes de cortar el acceso) son configurables por
# el superadmin; estos son solo los valores por defecto. Fechas en horario de Panamá.
DEFAULT_CUTOFF_DAY = 15     # día del corte mensual
DEFAULT_NOTICE_DAYS = 5     # días tras el corte en que arranca el aviso
DEFAULT_SUSPEND_DAYS = 15   # días tras el corte en que se suspende el acceso (absoluto)
_TZ_PA = ZoneInfo("America/Panama")

DEFAULT_BILLING = {"last_confirmed_at": None}


def _today_pa() -> date:
    return datetime.now(_TZ_PA).date()


def _get_billing(db: Session) -> dict:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "billing").first()
    if not row or not row.value:
        return dict(DEFAULT_BILLING)
    try:
        return {**DEFAULT_BILLING, **json.loads(row.value)}
    except Exception:
        return dict(DEFAULT_BILLING)


def _billing_cfg(billing: dict) -> dict:
    """Tiempos configurables (con fallback a los valores por defecto y saneados):
    cutoff_day 1–28, notice_days ≥ 0, suspend_days (absoluto, días tras el corte)
    estrictamente mayor que notice_days para que haya al menos 1 día de aviso."""
    def _int(key, default):
        try:
            return int(billing.get(key))
        except (TypeError, ValueError):
            return default
    cutoff_day = min(28, max(1, _int("cutoff_day", DEFAULT_CUTOFF_DAY)))
    notice_days = max(0, _int("notice_days", DEFAULT_NOTICE_DAYS))
    # Compatibilidad con la config antigua por 'grace_days' (días de aviso):
    if "suspend_days" in billing:
        suspend_days = _int("suspend_days", DEFAULT_SUSPEND_DAYS)
    elif "grace_days" in billing:
        suspend_days = notice_days + max(1, _int("grace_days", DEFAULT_SUSPEND_DAYS - DEFAULT_NOTICE_DAYS))
    else:
        suspend_days = DEFAULT_SUSPEND_DAYS
    suspend_days = max(notice_days + 1, suspend_days)  # al menos 1 día de aviso
    return {"cutoff_day": cutoff_day, "notice_days": notice_days, "suspend_days": suspend_days}


def _next_due(confirmed: date, cutoff_day: int) -> date:
    """Próximo corte = el día de corte del mes SIGUIENTE al de la última confirmación."""
    y, m = confirmed.year, confirmed.month
    if m == 12:
        y, m = y + 1, 1
    else:
        m += 1
    return date(y, m, cutoff_day)


def _billing_state(billing: dict) -> dict:
    """Estado calculado: al_dia | aviso | suspendido, con días restantes y próximo corte.
    'active' False = sin baseline (no bloquea ni muestra contador)."""
    cfg = _billing_cfg(billing)
    raw = billing.get("last_confirmed_at")
    if not raw:
        return {"status": "al_dia", "days_left": None, "next_due": None,
                "last_confirmed_at": None, "active": False, **cfg}
    try:
        confirmed = date.fromisoformat(str(raw)[:10])
    except Exception:
        return {"status": "al_dia", "days_left": None, "next_due": None,
                "last_confirmed_at": None, "active": False, **cfg}
    due = _next_due(confirmed, cfg["cutoff_day"])
    suspend_after = cfg["suspend_days"]  # días tras el corte (absoluto)
    days_late = (_today_pa() - due).days
    if days_late < cfg["notice_days"]:
        status, days_left = "al_dia", None
    elif days_late < suspend_after:
        status, days_left = "aviso", suspend_after - days_late
    else:
        status, days_left = "suspendido", 0
    return {"status": status, "days_left": days_left, "next_due": due.isoformat(),
            "last_confirmed_at": raw, "active": True, **cfg}


# ── Dependency ────────────────────────────────────────────────────────────────

def require_module(module_key: str) -> Callable:
    """Blocks access if module is disabled or trial has expired. Superadmin always bypasses."""
    def _check(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if current_user.role == models.UserRole.superadmin:
            return current_user
        # Corte por falta de pago: solo afecta al STAFF (nunca a los clientes).
        if current_user.role in STAFF_ROLES:
            if _billing_state(_get_billing(db))["status"] == "suspendido":
                raise HTTPException(
                    status_code=402,
                    detail="ACCESO_SUSPENDIDO: Realiza tu pago y contacta al administrador para reactivar el acceso al portal.",
                )
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


# ── Facturación: estado (staff) y confirmación (superadmin) ──────────────────────

@router.get("/billing/status")
def get_billing_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Contador/bloqueo del corte mensual. Solo el staff lo ve; superadmin y
    clientes reciben estado inactivo (sin banner ni bloqueo)."""
    if current_user.role not in STAFF_ROLES:
        return {"active": False, "status": "al_dia", "days_left": None, "next_due": None}
    return _billing_state(_get_billing(db))


def _save_billing(db: Session, billing: dict) -> None:
    """Persiste el dict de facturación completo (preserva config + baseline)."""
    payload = json.dumps(billing)
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "billing").first()
    if row:
        row.value = payload
    else:
        db.add(models.AppSetting(key="billing", value=payload))


def _clear_notice_marker(db: Session) -> None:
    nrow = db.query(models.AppSetting).filter(
        models.AppSetting.key == "billing_notice_sent_for"
    ).first()
    if nrow:
        db.delete(nrow)


@router.get("/billing")
def get_billing_config(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
):
    # _billing_state ya incluye cutoff_day / notice_days / suspend_days.
    return _billing_state(_get_billing(db))


@router.put("/billing/config")
def set_billing_config(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_superadmin),
):
    """Ajusta los tiempos del corte: día de corte (1–28), días tras el corte
    para el aviso (≥0) y días tras el corte para cortar el acceso (absoluto,
    mayor que el del aviso). Preserva la fecha del último pago; el estado se
    recalcula al instante."""
    def _req_int(key):
        try:
            return int(data.get(key))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Valor inválido para {key}")
    cutoff_day = _req_int("cutoff_day")
    notice_days = _req_int("notice_days")
    suspend_days = _req_int("suspend_days")
    if not (1 <= cutoff_day <= 28):
        raise HTTPException(status_code=400, detail="El día de corte debe estar entre 1 y 28")
    if notice_days < 0:
        raise HTTPException(status_code=400, detail="Los días para el aviso no pueden ser negativos")
    if suspend_days <= notice_days:
        raise HTTPException(
            status_code=400,
            detail="Los días para cortar el acceso deben ser mayores que los días del aviso",
        )
    billing = _get_billing(db)
    billing.pop("grace_days", None)  # migra la config antigua al modelo absoluto
    billing.update({"cutoff_day": cutoff_day, "notice_days": notice_days, "suspend_days": suspend_days})
    _save_billing(db, billing)
    try:
        from audit_helper import log_action
        log_action(db, current_user, "config_corte", "facturacion",
                   details={"cutoff_day": cutoff_day, "notice_days": notice_days, "suspend_days": suspend_days})
    except Exception:
        pass
    db.commit()
    return _billing_state(_get_billing(db))


@router.put("/billing")
def set_billing_date(
    data: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_superadmin),
):
    """Ajuste manual de la fecha del último pago recibido (corrección de baseline).
    Recibe {"last_confirmed_at": "YYYY-MM-DD"}. El próximo corte = día de corte del
    mes siguiente a esa fecha, y el estado se recalcula al instante."""
    raw = (data.get("last_confirmed_at") or "").strip()
    try:
        d = date.fromisoformat(raw[:10])
    except Exception:
        raise HTTPException(status_code=400, detail="Fecha inválida (usa YYYY-MM-DD)")
    stored = f"{d.isoformat()}T12:00:00"
    billing = _get_billing(db)
    billing["last_confirmed_at"] = stored
    _save_billing(db, billing)
    _clear_notice_marker(db)
    try:
        from audit_helper import log_action
        log_action(db, current_user, "ajustar_pago", "facturacion",
                   details={"last_confirmed_at": stored})
    except Exception:
        pass
    db.commit()
    return _billing_state(_get_billing(db))


@router.post("/billing/confirm")
def confirm_billing_payment(
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_superadmin),
):
    """Registra el pago del mes: reinicia el ciclo (próximo corte = día de corte del
    mes siguiente) y reactiva el acceso del staff si estaba suspendido."""
    now_iso = datetime.now(_TZ_PA).isoformat()
    billing = _get_billing(db)
    billing["last_confirmed_at"] = now_iso
    _save_billing(db, billing)
    # Limpia la marca de aviso enviado para que el próximo ciclo vuelva a avisar.
    _clear_notice_marker(db)
    try:
        from audit_helper import log_action
        log_action(db, current_user, "confirmar_pago", "facturacion",
                   details={"confirmed_at": now_iso})
    except Exception:
        pass
    db.commit()
    return _billing_state(_get_billing(db))
