from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime, timezone
import os, uuid, json, re
from database import get_db
from auth import require_staff, get_current_user
import models, schemas
import storage


def _log_dispatch_event(db: Session, dispatch_id: int, user_id: Optional[int], content: str,
                        entry_type: str = "comment", is_internal: bool = False):
    """Registra un evento en el historial del pedido/despacho (espejo del timeline de tickets)."""
    db.add(models.DispatchTimeline(
        dispatch_id=dispatch_id, user_id=user_id, content=content,
        entry_type=entry_type, is_internal=is_internal,
    ))

MAX_FILE_SIZE = 20 * 1024 * 1024

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "text/csv",
    "application/zip",
}

router = APIRouter(prefix="/api/despachos", tags=["despachos"])


def _is_it_support() -> bool:
    return os.getenv("PRODUCT_VERTICAL", "mps") == "it_support"


def _warranty_completeness(w) -> str:
    """'complete' si la garantía tiene items y todos con N° de serie; 'incomplete' si no."""
    if not w:
        return "none"
    items = list(w.items or [])
    if not items:
        return "incomplete"
    if any(not (it.serial or "").strip() for it in items):
        return "incomplete"
    return "complete"


def _warranty_for_dispatch(d: "models.Dispatch", db: Session):
    """Garantía vinculada a un pedido: por dispatch_id, o (legacy) por invoice_ref == n° de pedido."""
    w = (
        db.query(models.Warranty)
        .filter(models.Warranty.dispatch_id == d.id)
        .first()
    )
    if not w and d.dispatch_number:
        w = (
            db.query(models.Warranty)
            .filter(models.Warranty.invoice_ref == d.dispatch_number)
            .first()
        )
    return w


def _attach_warranty_status(dispatches, db: Session):
    """Adjunta d.warranty_status a cada pedido (solo it_support; en mps queda None).
    Una sola consulta (con items precargados) para toda la lista, en vez de N por pedido."""
    if not _is_it_support():
        return
    ids = [d.id for d in dispatches]
    nums = [d.dispatch_number for d in dispatches if d.dispatch_number]
    if not ids and not nums:
        return
    conds = []
    if ids:
        conds.append(models.Warranty.dispatch_id.in_(ids))
    if nums:
        conds.append(models.Warranty.invoice_ref.in_(nums))
    warrs = (
        db.query(models.Warranty)
        .options(joinedload(models.Warranty.items))
        .filter(or_(*conds))
        .all()
    )
    by_disp, by_ref = {}, {}
    for w in warrs:
        if w.dispatch_id and w.dispatch_id not in by_disp:
            by_disp[w.dispatch_id] = w
        if w.invoice_ref and w.invoice_ref not in by_ref:
            by_ref[w.invoice_ref] = w
    for d in dispatches:
        w = by_disp.get(d.id) or (by_ref.get(d.dispatch_number) if d.dispatch_number else None)
        d.warranty_status = _warranty_completeness(w)


# ── Inventario: resta/reposición automática por estado del pedido ──────────────

def _iter_dispatch_coded_items(d: models.Dispatch):
    """Devuelve (code, qty) de los items del pedido que tienen código de inventario."""
    try:
        items = json.loads(d.items or "[]")
    except Exception:
        return
    for it in items:
        code = (it.get("code") or "").strip()
        if not code:
            continue
        try:
            qty = float(it.get("qty") or 0)
        except (ValueError, TypeError):
            qty = 0
        if qty > 0:
            yield code, qty


def _apply_inventory_from_dispatch(d: models.Dispatch, db: Session):
    if d.inventory_applied:
        return
    for code, qty in _iter_dispatch_coded_items(d):
        inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv:
            continue
        try:
            current = float(inv.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        new_qty = max(0.0, current - qty)
        delta = current - new_qty
        inv.quantity = f"{new_qty:.4f}".rstrip("0").rstrip(".") or "0"
        db.add(models.InventoryTransaction(
            item_code=code, qty_delta=f"-{delta:.4f}".rstrip("0").rstrip("."),
            source_type="dispatch", source_id=d.id,
            notes=f"Pedido {d.dispatch_number or d.id} · {d.status}",
        ))
    d.inventory_applied = True


def _revert_inventory_from_dispatch(d: models.Dispatch, db: Session):
    if not d.inventory_applied:
        return
    for code, qty in _iter_dispatch_coded_items(d):
        inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if not inv:
            continue
        try:
            current = float(inv.quantity or "0")
        except (ValueError, TypeError):
            current = 0.0
        inv.quantity = f"{current + qty:.4f}".rstrip("0").rstrip(".") or "0"
        db.add(models.InventoryTransaction(
            item_code=code, qty_delta=f"+{qty:.4f}".rstrip("0").rstrip("."),
            source_type="dispatch_revert", source_id=d.id,
            notes=f"Reposición pedido {d.dispatch_number or d.id} · {d.status}",
        ))
    d.inventory_applied = False


def _sync_dispatch_inventory(d: models.Dispatch, db: Session, items_changed: bool = False):
    """Resta el stock cuando el pedido está en un estado distinto a Borrador/Cancelado;
    lo repone al volver a esos estados. Si cambian los items estando ya aplicado, resincroniza."""
    deduct = d.status not in ("Borrador", "Cancelado") and d.deleted_at is None
    if deduct:
        if d.inventory_applied and items_changed:
            _revert_inventory_from_dispatch(d, db)
        if not d.inventory_applied:
            _apply_inventory_from_dispatch(d, db)
    else:
        if d.inventory_applied:
            _revert_inventory_from_dispatch(d, db)


def _sync_order_status(order: models.Order, db: Session) -> None:
    """Derive order.status from the aggregate state of all its active dispatches."""
    dispatches = db.query(models.Dispatch).filter(
        models.Dispatch.order_id == order.id,
        models.Dispatch.deleted_at.is_(None),
    ).all()

    active = [d for d in dispatches if d.status != "Cancelado"]

    if not active:
        if order.status in ("En despacho", "Entregado al cliente"):
            order.status = "En proceso"
        return

    active_statuses = {d.status for d in active}
    if active_statuses == {"Entregado"}:
        order.status = "Entregado al cliente"
    elif "Entregado" in active_statuses:
        order.status = "En despacho"
    else:
        order.status = "En despacho"


@router.get("/next-number")
def next_dispatch_number(db: Session = Depends(get_db), _=Depends(require_staff)):
    prefix = "PED" if os.getenv("PRODUCT_VERTICAL", "mps") == "it_support" else "DSP"
    rows = db.query(models.Dispatch.dispatch_number).filter(models.Dispatch.dispatch_number.like(f"{prefix}-%"), models.Dispatch.deleted_at.is_(None)).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    n = (max(nums) + 1) if nums else 1
    return {"number": f"{prefix}-{n:04d}"}


@router.get("", response_model=List[schemas.DispatchOut])
def list_dispatches(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.Dispatch).filter(models.Dispatch.deleted_at.is_(None))
    if status:
        q = q.filter(models.Dispatch.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(
            models.Dispatch.title.ilike(like) |
            models.Dispatch.client_name.ilike(like) |
            models.Dispatch.dispatch_number.ilike(like) |
            models.Dispatch.items.ilike(like) |
            models.Dispatch.notes.ilike(like)
        )
    rows = q.order_by(models.Dispatch.created_at.desc()).all()
    _attach_warranty_status(rows, db)
    return rows


@router.post("", response_model=schemas.DispatchOut)
def create_dispatch(
    data: schemas.DispatchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    dispatch = models.Dispatch(**data.model_dump())
    db.add(dispatch)
    db.commit()
    db.refresh(dispatch)
    _sync_dispatch_inventory(dispatch, db)
    db.commit()
    if dispatch.order_id:
        order = db.query(models.Order).filter(models.Order.id == dispatch.order_id).first()
        if order:
            _sync_order_status(order, db)
            db.commit()
    # Aviso a admin/supervisor (campana + push) de pedido nuevo — solo it_support.
    try:
        from notify import notify_admins
        notify_admins(
            db, "📦 Nuevo pedido",
            f"{dispatch.dispatch_number or '#' + str(dispatch.id)} · {dispatch.client_name or 'sin cliente'}",
            url="/pedidos", kind="pedido", exclude_user_id=current_user.id,
        )
        db.commit()
    except Exception:
        db.rollback()
    _attach_warranty_status([dispatch], db)
    return dispatch


# ── Portal del cliente: crear y ver sus propios pedidos ──

@router.get("/mis", response_model=List[schemas.MyDispatchOut])
def my_dispatches(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Pedidos que el cliente autenticado ha solicitado desde el portal."""
    return (
        db.query(models.Dispatch)
        .filter(models.Dispatch.client_id == current_user.id, models.Dispatch.deleted_at.is_(None))
        .order_by(models.Dispatch.created_at.desc())
        .all()
    )


@router.post("/mis", response_model=schemas.MyDispatchOut)
def create_client_dispatch(
    data: schemas.ClientDispatchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """El cliente crea una solicitud de pedido (Borrador). Descripción genérica y
    artículos en texto libre (sin inventario). Un agente la evalúa y la ajusta después."""
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="El asunto del pedido es obligatorio")
    d = models.Dispatch(
        title=title,
        status="Borrador",
        client_id=current_user.id,
        client_name=current_user.name or current_user.email,
        notes=(data.notes or None),
        items=(data.items or None),
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    # Notifica a admin/supervisor (campana + push) de una nueva solicitud de pedido del cliente.
    try:
        from notify import notify_admins
        notify_admins(
            db, "📦 Nueva solicitud de pedido",
            f"{current_user.name or current_user.email} solicitó: {title}",
            url="/pedidos", kind="pedido", exclude_user_id=current_user.id,
        )
        db.commit()
    except Exception:
        db.rollback()
    return d


@router.get("/{dispatch_id}", response_model=schemas.DispatchOut)
def get_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    _attach_warranty_status([d], db)
    return d


@router.put("/{dispatch_id}", response_model=schemas.DispatchOut)
def update_dispatch(
    dispatch_id: int,
    data: schemas.DispatchUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    old_status = d.status
    old_assigned = d.assigned_to_id
    updates = data.model_dump(exclude_unset=True)
    # Bloqueo de entrega (it_support): no se puede pasar a "Entregado" sin una garantía
    # vinculada que tenga los N° de serie de todos los equipos del pedido.
    if (_is_it_support()
            and updates.get("status") == "Entregado"
            and old_status != "Entregado"):
        if _warranty_completeness(_warranty_for_dispatch(d, db)) != "complete":
            raise HTTPException(
                status_code=400,
                detail="No se puede marcar como Entregado: falta el certificado de garantía con el N° de serie de todos los equipos.",
            )
    for field, value in updates.items():
        setattr(d, field, value)
    _sync_dispatch_inventory(d, db, items_changed="items" in updates)
    # Auto-log en el historial del pedido/despacho
    if "status" in updates and d.status != old_status:
        _log_dispatch_event(db, d.id, current_user.id, f"Cambió el estado a «{d.status}»", entry_type="status_change")
    if "assigned_to_id" in updates and d.assigned_to_id != old_assigned:
        if d.assigned_to_id:
            tech = db.query(models.User).filter(models.User.id == d.assigned_to_id).first()
            _log_dispatch_event(db, d.id, current_user.id, f"Asignó el pedido a {tech.name if tech else '—'}", entry_type="assignment")
        else:
            _log_dispatch_event(db, d.id, current_user.id, "Quitó la asignación del pedido", entry_type="assignment")
    db.commit()
    db.refresh(d)
    if d.order_id and "status" in updates:
        order = db.query(models.Order).filter(models.Order.id == d.order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    _attach_warranty_status([d], db)
    return d


@router.post("/{dispatch_id}/cancel", response_model=schemas.DispatchOut)
def cancel_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Cancela un pedido: elimina el certificado de garantía vinculado (si existe) y
    devuelve al inventario los artículos que había descontado."""
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if d.status == "Cancelado":
        raise HTTPException(status_code=400, detail="El pedido ya está cancelado")

    # 1) Elimina la garantía vinculada (por dispatch_id o, legacy, por n° de pedido).
    w = _warranty_for_dispatch(d, db)
    if w:
        db.delete(w)

    # 2) Cambia a Cancelado → _sync_dispatch_inventory repone el stock descontado.
    d.status = "Cancelado"
    _sync_dispatch_inventory(d, db)
    # 3) Devuelve al inventario las partes que el técnico había instalado.
    _revert_dispatch_parts(d, db)
    db.commit()
    db.refresh(d)

    if d.order_id:
        order = db.query(models.Order).filter(models.Order.id == d.order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    _attach_warranty_status([d], db)
    return d


@router.delete("/{dispatch_id}")
def delete_dispatch(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(
        models.Dispatch.id == dispatch_id,
        models.Dispatch.deleted_at.is_(None),
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    order_id = d.order_id
    _revert_inventory_from_dispatch(d, db)  # repone stock si estaba aplicado
    _revert_dispatch_parts(d, db)           # devuelve las partes instaladas al inventario
    d.deleted_at = datetime.now(timezone.utc)
    db.commit()
    if order_id:
        order = db.query(models.Order).filter(models.Order.id == order_id).first()
        if order and order.status not in ("Inventariado",):
            _sync_order_status(order, db)
            db.commit()
    return {"ok": True}


# ── Historial (timeline) ──────────────────────────────

@router.get("/{dispatch_id}/timeline", response_model=List[schemas.DispatchTimelineOut])
def get_dispatch_timeline(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    return (
        db.query(models.DispatchTimeline)
        .filter(models.DispatchTimeline.dispatch_id == dispatch_id)
        .order_by(models.DispatchTimeline.created_at)
        .all()
    )


@router.post("/{dispatch_id}/timeline", response_model=schemas.DispatchTimelineOut)
def add_dispatch_timeline(
    dispatch_id: int,
    data: schemas.DispatchTimelineCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío")
    entry = models.DispatchTimeline(
        dispatch_id=dispatch_id, user_id=current_user.id, content=content,
        entry_type="comment", is_internal=bool(data.is_internal),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _can_edit_note(entry: models.DispatchTimeline, user: models.User) -> bool:
    """Solo el autor de la nota o un admin/supervisor pueden editarla/eliminarla."""
    return (
        entry.user_id == user.id
        or user.role in (models.UserRole.admin, models.UserRole.supervisor, models.UserRole.superadmin)
    )


@router.patch("/{dispatch_id}/timeline/{entry_id}", response_model=schemas.DispatchTimelineOut)
def update_dispatch_timeline(
    dispatch_id: int,
    entry_id: int,
    data: schemas.DispatchTimelineUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    entry = db.query(models.DispatchTimeline).filter(
        models.DispatchTimeline.id == entry_id,
        models.DispatchTimeline.dispatch_id == dispatch_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    if entry.entry_type != "comment":
        raise HTTPException(status_code=400, detail="Solo se pueden editar las notas, no los eventos automáticos")
    if not _can_edit_note(entry, current_user):
        raise HTTPException(status_code=403, detail="No tienes permiso para editar esta nota")
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="La nota no puede estar vacía")
    entry.content = content
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{dispatch_id}/timeline/{entry_id}")
def delete_dispatch_timeline(
    dispatch_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    entry = db.query(models.DispatchTimeline).filter(
        models.DispatchTimeline.id == entry_id,
        models.DispatchTimeline.dispatch_id == dispatch_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    if entry.entry_type != "comment":
        raise HTTPException(status_code=400, detail="Solo se pueden eliminar las notas, no los eventos automáticos")
    if not _can_edit_note(entry, current_user):
        raise HTTPException(status_code=403, detail="No tienes permiso para eliminar esta nota")
    db.delete(entry)
    db.commit()
    return {"ok": True}


# ── Checklist de preparación (tasks) ──────────────────

@router.get("/tasks/suggestions", response_model=List[str])
def dispatch_task_suggestions(db: Session = Depends(get_db), _=Depends(require_staff)):
    """Títulos de tareas ya creadas (en todos los pedidos), ordenados por frecuencia,
    para autocompletar el checklist."""
    rows = (
        db.query(models.DispatchTask.title, func.count(models.DispatchTask.id).label("c"))
        .group_by(models.DispatchTask.title)
        .order_by(func.count(models.DispatchTask.id).desc())
        .limit(50)
        .all()
    )
    return [r[0] for r in rows if r[0]]


@router.get("/{dispatch_id}/tasks", response_model=List[schemas.DispatchTaskOut])
def get_dispatch_tasks(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    return (
        db.query(models.DispatchTask)
        .filter(models.DispatchTask.dispatch_id == dispatch_id)
        .order_by(models.DispatchTask.position, models.DispatchTask.id)
        .all()
    )


@router.post("/{dispatch_id}/tasks", response_model=schemas.DispatchTaskOut)
def add_dispatch_task(
    dispatch_id: int,
    data: schemas.DispatchTaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="La tarea no puede estar vacía")
    max_pos = db.query(func.max(models.DispatchTask.position)).filter(models.DispatchTask.dispatch_id == dispatch_id).scalar() or 0
    task = models.DispatchTask(dispatch_id=dispatch_id, title=title, position=max_pos + 1)
    db.add(task)
    _log_dispatch_event(db, dispatch_id, current_user.id, f"Agregó la tarea: {title}", entry_type="task")
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{dispatch_id}/tasks/{task_id}", response_model=schemas.DispatchTaskOut)
def update_dispatch_task(
    dispatch_id: int,
    task_id: int,
    data: schemas.DispatchTaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    task = db.query(models.DispatchTask).filter(
        models.DispatchTask.id == task_id, models.DispatchTask.dispatch_id == dispatch_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    upd = data.model_dump(exclude_unset=True)
    if upd.get("title") is not None:
        new_title = upd["title"].strip()
        if new_title:
            task.title = new_title
    if upd.get("is_done") is not None:
        if upd["is_done"] and not task.is_done:
            task.is_done = True
            task.done_by_id = current_user.id
            task.done_at = datetime.now(timezone.utc)
            _log_dispatch_event(db, dispatch_id, current_user.id, f"Completó la tarea: {task.title}", entry_type="task")
        elif not upd["is_done"] and task.is_done:
            task.is_done = False
            task.done_by_id = None
            task.done_at = None
            _log_dispatch_event(db, dispatch_id, current_user.id, f"Reabrió la tarea: {task.title}", entry_type="task")
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{dispatch_id}/tasks/{task_id}")
def delete_dispatch_task(
    dispatch_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    task = db.query(models.DispatchTask).filter(
        models.DispatchTask.id == task_id, models.DispatchTask.dispatch_id == dispatch_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ── Partes instaladas (consumo de inventario) ─────────

def _fmt_qty(v) -> str:
    return f"{float(v):.4f}".rstrip("0").rstrip(".") or "0"


def _revert_dispatch_parts(d: models.Dispatch, db: Session, user_id: Optional[int] = None):
    """Devuelve al inventario todas las partes instaladas de un pedido (al cancelar/eliminar)."""
    from routers.inventory import _log_inventory_txn
    parts = db.query(models.DispatchPart).filter(models.DispatchPart.dispatch_id == d.id).all()
    for p in parts:
        try:
            qty = float(p.qty or 0)
        except (ValueError, TypeError):
            qty = 0.0
        if qty > 0:
            inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == p.item_code).first()
            if inv:
                try:
                    current = float(inv.quantity or "0")
                except (ValueError, TypeError):
                    current = 0.0
                inv.quantity = _fmt_qty(current + qty)
            _log_inventory_txn(db, p.item_code, qty, source_type="dispatch_part_return", source_id=d.id,
                               notes=f"Reverso de parte instalada · Pedido {d.dispatch_number or d.id}", unit_cost=p.unit_cost)
        db.delete(p)


@router.get("/{dispatch_id}/parts", response_model=List[schemas.DispatchPartOut])
def get_dispatch_parts(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    return (
        db.query(models.DispatchPart)
        .filter(models.DispatchPart.dispatch_id == dispatch_id)
        .order_by(models.DispatchPart.created_at)
        .all()
    )


@router.post("/{dispatch_id}/parts", response_model=schemas.DispatchPartOut)
def add_dispatch_part(
    dispatch_id: int,
    data: schemas.DispatchPartCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    from routers.inventory import _log_inventory_txn
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id, models.Dispatch.deleted_at.is_(None)).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    if d.status == "Cancelado":
        raise HTTPException(status_code=400, detail="No se pueden agregar partes a un pedido cancelado")
    qty = float(data.qty or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
    code = (data.item_code or "").strip()
    inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Artículo de inventario no encontrado")
    try:
        current = float(inv.quantity or "0")
    except (ValueError, TypeError):
        current = 0.0
    if qty > current:
        raise HTTPException(status_code=400, detail=f"Stock insuficiente de {code}: disponible {current:g}")
    inv.quantity = _fmt_qty(current - qty)
    part = models.DispatchPart(
        dispatch_id=dispatch_id, item_code=code, item_name=inv.name,
        qty=_fmt_qty(qty), unit_cost=inv.cost_price, created_by_id=current_user.id,
    )
    db.add(part)
    _log_inventory_txn(db, code, -qty, source_type="dispatch_part", source_id=dispatch_id,
                       notes=f"Parte instalada · Pedido {d.dispatch_number or d.id}", unit_cost=inv.cost_price)
    _log_dispatch_event(db, dispatch_id, current_user.id,
                        f"Instaló {qty:g} × {code} ({inv.name}) — descontado del inventario", entry_type="task")
    db.commit()
    db.refresh(part)
    return part


@router.delete("/{dispatch_id}/parts/{part_id}")
def delete_dispatch_part(
    dispatch_id: int,
    part_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    from routers.inventory import _log_inventory_txn
    part = db.query(models.DispatchPart).filter(
        models.DispatchPart.id == part_id, models.DispatchPart.dispatch_id == dispatch_id
    ).first()
    if not part:
        raise HTTPException(status_code=404, detail="Parte no encontrada")
    try:
        qty = float(part.qty or 0)
    except (ValueError, TypeError):
        qty = 0.0
    if qty > 0:
        inv = db.query(models.InventoryItem).filter(models.InventoryItem.code == part.item_code).first()
        if inv:
            try:
                current = float(inv.quantity or "0")
            except (ValueError, TypeError):
                current = 0.0
            inv.quantity = _fmt_qty(current + qty)
        _log_inventory_txn(db, part.item_code, qty, source_type="dispatch_part_return", source_id=dispatch_id,
                           notes=f"Reverso de parte instalada · Pedido {dispatch_id}", unit_cost=part.unit_cost)
        _log_dispatch_event(db, dispatch_id, current_user.id,
                            f"Quitó la parte {qty:g} × {part.item_code} — devuelta al inventario", entry_type="task")
    db.delete(part)
    db.commit()
    return {"ok": True}


# ── Attachments ───────────────────────────────────────

@router.post("/{dispatch_id}/attachments", response_model=schemas.DispatchAttachmentOut)
async def upload_dispatch_attachment(
    dispatch_id: int,
    doc_type: str = "otro",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff),
):
    d = db.query(models.Dispatch).filter(models.Dispatch.id == dispatch_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="El archivo excede 20MB")
    ext = os.path.splitext(file.filename or "file")[1]
    stored_name = f"{uuid.uuid4()}{ext}"
    storage.save_file(f"dispatches/{dispatch_id}/{stored_name}", content, file.content_type)
    attachment = models.DispatchAttachment(
        dispatch_id=dispatch_id,
        doc_type=doc_type,
        filename=stored_name,
        original_name=file.filename or stored_name,
        file_size=len(content),
        content_type=file.content_type,
        uploaded_by_id=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{dispatch_id}/attachments/{att_id}/download")
def download_dispatch_attachment(
    dispatch_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.DispatchAttachment).filter(
        models.DispatchAttachment.id == att_id,
        models.DispatchAttachment.dispatch_id == dispatch_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage_key = f"dispatches/{dispatch_id}/{att.filename}"
    if not storage.file_exists(storage_key):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    safe_name = re.sub(r'["\r\n\\]', '_', att.original_name or "archivo")
    return Response(
        content=storage.read_file(storage_key),
        media_type=att.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@router.delete("/{dispatch_id}/attachments/{att_id}")
def delete_dispatch_attachment(
    dispatch_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    att = db.query(models.DispatchAttachment).filter(
        models.DispatchAttachment.id == att_id,
        models.DispatchAttachment.dispatch_id == dispatch_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    storage.delete_file(f"dispatches/{dispatch_id}/{att.filename}")
    db.delete(att)
    db.commit()
    return {"ok": True}
