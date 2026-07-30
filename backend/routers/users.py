import os
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from database import get_db
import models, schemas
from auth import get_current_user, require_admin, require_staff, get_password_hash
from audit_helper import log_action
from routers.system import _get_max_users, count_staff_users, STAFF_ROLES


def _client_ip(request: Request) -> Optional[str]:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else None)

router = APIRouter(prefix="/api/users", tags=["users"])


def _hide_superadmin() -> bool:
    """Cuando HIDE_SUPERADMIN=on, el superadmin es invisible/intocable para
    perfiles admin o inferiores (se usa en instancias de cliente, ej. Dominus Tech).
    Default off → instancias como DG no cambian."""
    return os.getenv("HIDE_SUPERADMIN", "false").strip().lower() in ("1", "true", "yes")


def _superadmin_hidden_from(current_user: models.User) -> bool:
    return _hide_superadmin() and current_user.role != models.UserRole.superadmin


class SignaturePayload(BaseModel):
    signature: Optional[str] = None  # base64 data URL, or null to delete


class PhotoPayload(BaseModel):
    photo: Optional[str] = None  # base64 data URL, or null to delete


@router.post("/me/signature")
def upload_my_signature(
    data: SignaturePayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in [models.UserRole.agent, models.UserRole.admin, models.UserRole.supervisor]:
        raise HTTPException(status_code=403, detail="Solo agentes y administradores pueden subir firmas")
    if data.signature and len(data.signature) > 700_000:
        raise HTTPException(status_code=400, detail="La imagen es demasiado grande. Máximo ~500 KB.")
    current_user.signature = data.signature or None
    db.commit()
    return {"ok": True}


@router.post("/me/photo")
def upload_my_photo(
    data: PhotoPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in [models.UserRole.agent, models.UserRole.admin, models.UserRole.supervisor]:
        raise HTTPException(status_code=403, detail="Solo agentes y administradores pueden subir foto de perfil")
    if data.photo and len(data.photo) > 700_000:
        raise HTTPException(status_code=400, detail="La imagen es demasiado grande. Máximo ~500 KB.")
    current_user.profile_photo = data.photo or None
    db.commit()
    return {"ok": True}


# ── Client Categories ──────────────────────────────────────────────────────

@router.get("/client-categories", response_model=List[schemas.ClientCategoryOut])
def list_client_categories(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.ClientCategory).order_by(
        models.ClientCategory.order, models.ClientCategory.name
    ).all()


@router.post("/client-categories", response_model=schemas.ClientCategoryOut)
def create_client_category(
    data: schemas.ClientCategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    cat = models.ClientCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/client-categories/{cat_id}", response_model=schemas.ClientCategoryOut)
def update_client_category(
    cat_id: int,
    data: schemas.ClientCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    cat = db.query(models.ClientCategory).filter(models.ClientCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/client-categories/{cat_id}")
def delete_client_category(
    cat_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    cat = db.query(models.ClientCategory).filter(models.ClientCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    count = db.query(models.User).filter(models.User.client_category_id == cat_id).count()
    if count > 0:
        raise HTTPException(status_code=400, detail=f"No se puede eliminar: {count} cliente(s) asignado(s)")
    db.delete(cat)
    db.commit()
    return {"ok": True}


@router.get("", response_model=List[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    q = db.query(models.User)
    if _superadmin_hidden_from(current_user):
        q = q.filter(models.User.role != models.UserRole.superadmin)
    return q.order_by(models.User.created_at.desc()).all()


@router.get("/agents", response_model=List[schemas.UserOut])
def list_agents(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.User).filter(
        models.User.role.in_([models.UserRole.agent, models.UserRole.admin, models.UserRole.supervisor]),
        models.User.is_active == True,
    ).order_by(models.User.name).all()


@router.get("/clients", response_model=List[schemas.UserOut])
def list_clients(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.User).filter(
        models.User.role == models.UserRole.client,
        models.User.is_active == True,
    ).order_by(models.User.name).all()


@router.post("", response_model=schemas.UserOut)
def create_user(
    data: schemas.UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    # Todo el staff puede crear CLIENTES (ej. al abrir un ticket, cotización o
    # factura). Crear cuentas de staff (agent, admin, etc.) sigue siendo solo admin.
    if current_user.role not in (models.UserRole.superadmin, models.UserRole.admin) \
            and data.role != models.UserRole.client:
        raise HTTPException(
            status_code=403,
            detail="Solo puedes crear clientes; para crear usuarios de staff se requiere administrador",
        )
    # Solo un superadmin puede crear otro superadmin (evita cuentas invisibles
    # cuando HIDE_SUPERADMIN está activo).
    if data.role == models.UserRole.superadmin and _superadmin_hidden_from(current_user):
        raise HTTPException(status_code=403, detail="No autorizado")

    # Límite de usuarios staff (configurado por el superadmin). El superadmin nunca
    # queda limitado; los clientes no cuentan.
    if current_user.role != models.UserRole.superadmin and data.role in STAFF_ROLES:
        limit = _get_max_users(db)
        if limit and count_staff_users(db) >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Límite de usuarios alcanzado ({limit}). Contacta al proveedor para ampliarlo.",
            )

    import uuid as _uuid
    email = data.email or f"sin-correo-{_uuid.uuid4().hex[:12]}@sin-correo.local"

    if data.email and db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(status_code=400, detail="El email ya está registrado")
    contact = None
    if data.email:
        contact = db.query(models.Contact).filter(
            models.Contact.email == data.email,
            models.Contact.deleted_at.is_(None),
        ).first()
    if contact:
        # Promote existing contact to a user account — soft-delete the contact to avoid duplicates
        user = models.User(
            name=contact.name or data.name,
            email=email,
            password_hash=get_password_hash(data.password),
            role=data.role,
            phone=contact.phone or data.phone,
            company=contact.company or data.company,
            address=contact.address or data.address,
            client_category_id=data.client_category_id or None,
        )
        db.add(user)
        from datetime import datetime, timezone as _tz
        contact.deleted_at = datetime.now(_tz.utc)
        db.commit()
        db.refresh(user)
        log_action(db, current_user, "create", "usuario", user.id, user.name,
                   {"role": user.role.value if hasattr(user.role, "value") else str(user.role)},
                   _client_ip(request))
        db.commit()
        return user

    user = models.User(
        name=data.name,
        email=email,
        password_hash=get_password_hash(data.password),
        role=data.role,
        phone=data.phone,
        company=data.company,
        address=data.address,
        client_category_id=data.client_category_id or None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(db, current_user, "create", "usuario", user.id, user.name,
               {"role": user.role.value if hasattr(user.role, "value") else str(user.role)},
               _client_ip(request))
    db.commit()
    return user


@router.get("/{user_id}", response_model=schemas.UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (user.role == models.UserRole.superadmin and _superadmin_hidden_from(current_user)):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (user.role == models.UserRole.superadmin and _superadmin_hidden_from(current_user)):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    _changed = [k for k in data.model_fields_set if k != 'password']
    if data.name is not None:
        user.name = data.name
    if data.email is not None:
        user.email = data.email
    if data.phone is not None:
        user.phone = data.phone
    if data.company is not None:
        user.company = data.company
    if data.address is not None:
        user.address = data.address
    if data.role is not None:
        if data.role == models.UserRole.superadmin and _superadmin_hidden_from(current_user):
            raise HTTPException(status_code=403, detail="No autorizado")
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password:
        user.password_hash = get_password_hash(data.password)
    if 'client_category_id' in data.model_fields_set:
        user.client_category_id = data.client_category_id or None

    db.commit()
    db.refresh(user)
    details = {"campos": _changed}
    if data.password:
        details["password"] = "cambiada"
    log_action(db, current_user, "update", "usuario", user.id, user.name, details, _client_ip(request))
    db.commit()
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (user.role == models.UserRole.superadmin and _superadmin_hidden_from(current_user)):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Bloquea la desactivación si el usuario tiene tickets activos (asignados o como
    # cliente). Los pedidos van siempre ligados a un ticket, así que quedan cubiertos.
    ticket_count = db.query(func.count(models.Ticket.id)).filter(
        models.Ticket.deleted_at.is_(None),
        (models.Ticket.assigned_to_id == user_id) | (models.Ticket.client_id == user_id),
    ).scalar() or 0

    if ticket_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede desactivar: {ticket_count} ticket(s) activo(s) vinculado(s). Reasígnalos primero.",
        )

    user.is_active = False
    db.commit()
    log_action(db, current_user, "delete", "usuario", user.id, user.name,
               {"accion": "desactivado"}, _client_ip(request))
    db.commit()
    return {"ok": True}
