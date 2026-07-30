from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
import csv, io
import models, schemas
from database import get_db
from auth import require_staff, require_agent_or_admin, require_supplies_or_above

# Mapea etiquetas/claves de bodega del CSV a la clave interna del enum.
_WAREHOUSE_ALIASES = {
    "principal": "principal", "bodega principal": "principal",
    "partes": "partes", "bodega de partes": "partes",
    "suministros_mps": "suministros_mps", "suministros mps": "suministros_mps",
    "impresoras_mps": "impresoras_mps", "bodega de impresoras mps": "impresoras_mps",
}


def _log_inventory_txn(db: Session, item_code: str, qty_delta: float, source_type: str = "manual", source_id: int = None, notes: str = None):
    delta_str = f"{qty_delta:.4f}".rstrip("0").rstrip(".")
    db.add(models.InventoryTransaction(
        item_code=item_code,
        qty_delta=delta_str,
        source_type=source_type,
        source_id=source_id,
        notes=notes,
    ))


router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("", response_model=List[schemas.InventoryItemOut])
def list_inventory(
    q: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    warehouse: Optional[str] = Query(default=None),
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    query = db.query(models.InventoryItem)
    if active_only:
        query = query.filter(models.InventoryItem.is_active == True)
    if category:
        query = query.filter(models.InventoryItem.category == category)
    if warehouse:
        query = query.filter(models.InventoryItem.warehouse == warehouse)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(
            models.InventoryItem.code.ilike(like),
            models.InventoryItem.name.ilike(like),
        ))
    return query.order_by(models.InventoryItem.code).all()


@router.get("/search", response_model=List[schemas.InventoryItemOut])
def search_inventory(
    q: str = Query(default=""),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Quick search for autocomplete in item editors."""
    like = f"%{q}%"
    return (
        db.query(models.InventoryItem)
        .filter(
            or_(
                models.InventoryItem.code.ilike(like),
                models.InventoryItem.name.ilike(like),
            ),
        )
        .order_by(models.InventoryItem.code)
        .limit(10)
        .all()
    )


@router.get("/transactions/all", response_model=List[schemas.InventoryTransactionOut])
def get_all_transactions(
    item_code: Optional[str] = Query(default=None),
    source_type: Optional[str] = Query(default=None),
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.InventoryTransaction)
    if item_code:
        q = q.filter(models.InventoryTransaction.item_code == item_code)
    if source_type:
        q = q.filter(models.InventoryTransaction.source_type == source_type)
    txns = q.order_by(models.InventoryTransaction.created_at.desc()).limit(limit).all()

    # Item names
    codes = list({t.item_code for t in txns})
    items_by_code = {}
    if codes:
        for it in db.query(models.InventoryItem.code, models.InventoryItem.name).filter(models.InventoryItem.code.in_(codes)).all():
            items_by_code[it.code] = it.name

    # Source labels + client + ticket — grouped by source type
    inv_ids  = [t.source_id for t in txns if t.source_type == "invoice"  and t.source_id]
    disp_ids = [t.source_id for t in txns if t.source_type == "dispatch" and t.source_id]
    ord_ids  = [t.source_id for t in txns if t.source_type == "order"    and t.source_id]

    # Invoices: label, client_name, ticket_id
    inv_data = {}
    if inv_ids:
        for r in db.query(models.Invoice.id, models.Invoice.invoice_number, models.Invoice.client_name, models.Invoice.ticket_id).filter(models.Invoice.id.in_(inv_ids)).all():
            inv_data[r.id] = {"label": r.invoice_number or f"#{r.id}", "client": r.client_name, "ticket_id": r.ticket_id}

    # Dispatches: label, client_name; ticket_id via dispatch.order_id → order.ticket_id
    disp_data = {}
    if disp_ids:
        disp_rows = db.query(models.Dispatch.id, models.Dispatch.dispatch_number, models.Dispatch.client_name, models.Dispatch.order_id).filter(models.Dispatch.id.in_(disp_ids)).all()
        disp_order_ids = [r.order_id for r in disp_rows if r.order_id]
        order_ticket_map = {r.id: r.ticket_id for r in db.query(models.Order.id, models.Order.ticket_id).filter(models.Order.id.in_(disp_order_ids)).all()} if disp_order_ids else {}
        for r in disp_rows:
            disp_data[r.id] = {"label": r.dispatch_number or f"#{r.id}", "client": r.client_name, "ticket_id": order_ticket_map.get(r.order_id) if r.order_id else None}

    # Orders: label, ticket_id (no client_name on purchase orders)
    ord_data = {}
    if ord_ids:
        for r in db.query(models.Order.id, models.Order.order_number, models.Order.ticket_id).filter(models.Order.id.in_(ord_ids)).all():
            ord_data[r.id] = {"label": r.order_number or f"#{r.id}", "ticket_id": r.ticket_id}

    # Company lookup via ticket_id → Ticket.client_id → User.company
    all_ticket_ids = list({
        *[d.get("ticket_id") for d in inv_data.values()  if d.get("ticket_id")],
        *[d.get("ticket_id") for d in disp_data.values() if d.get("ticket_id")],
        *[d.get("ticket_id") for d in ord_data.values()  if d.get("ticket_id")],
    })
    company_by_ticket = {}
    if all_ticket_ids:
        rows = (
            db.query(models.Ticket.id, models.User.company, models.User.name)
            .join(models.User, models.Ticket.client_id == models.User.id)
            .filter(models.Ticket.id.in_(all_ticket_ids))
            .all()
        )
        for r in rows:
            company_by_ticket[r.id] = {"company": r.company, "user_name": r.name}

    results = []
    for t in txns:
        source_label = client_name = client_company = ticket_id = None
        if t.source_type == "invoice" and t.source_id:
            d = inv_data.get(t.source_id, {})
            source_label, client_name, ticket_id = d.get("label"), d.get("client"), d.get("ticket_id")
        elif t.source_type == "dispatch" and t.source_id:
            d = disp_data.get(t.source_id, {})
            source_label, client_name, ticket_id = d.get("label"), d.get("client"), d.get("ticket_id")
        elif t.source_type == "order" and t.source_id:
            d = ord_data.get(t.source_id, {})
            source_label, ticket_id = d.get("label"), d.get("ticket_id")
        # Enrich with company from ticket → user
        if ticket_id and ticket_id in company_by_ticket:
            info = company_by_ticket[ticket_id]
            client_company = info.get("company")
            if not client_name:
                client_name = info.get("user_name")
        results.append({
            "id": t.id, "item_code": t.item_code, "qty_delta": t.qty_delta,
            "source_type": t.source_type, "source_id": t.source_id,
            "notes": t.notes, "created_at": t.created_at,
            "item_name": items_by_code.get(t.item_code),
            "source_label": source_label,
            "client_name": client_name,
            "client_company": client_company,
            "ticket_id": ticket_id,
        })
    return results


@router.get("/{item_id}", response_model=schemas.InventoryItemOut)
def get_inventory_item(item_id: int, db: Session = Depends(get_db), _=Depends(require_staff)):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    return item


@router.get("/{item_id}/transactions", response_model=List[schemas.InventoryTransactionOut])
def get_item_transactions(
    item_id: int,
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    return (
        db.query(models.InventoryTransaction)
        .filter(models.InventoryTransaction.item_code == item.code)
        .order_by(models.InventoryTransaction.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("", response_model=schemas.InventoryItemOut)
def create_inventory_item(
    data: schemas.InventoryItemCreate,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    existing = db.query(models.InventoryItem).filter(models.InventoryItem.code == data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"El código '{data.code}' ya existe en el inventario")
    item = models.InventoryItem(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/import")
async def import_inventory_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Importa/actualiza artículos desde CSV (upsert por código).
    Columnas: codigo, nombre, categoria, descripcion, unidad, precio_venta, costo, stock, proveedor, bodega."""
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .csv")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo excede 5 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    sample = text[:2048]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)

    def norm(s):
        return (s or "").strip().lower().replace(" ", "_")

    suppliers = {s.name.strip().lower(): s.id for s in db.query(models.Supplier).all() if s.name}

    created = updated = 0
    errors = []
    for i, row in enumerate(reader, start=2):  # fila 1 = encabezados
        r = {norm(k): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k is not None}
        code = r.get("codigo") or r.get("code") or r.get("código")
        name = r.get("nombre") or r.get("name")
        if not code or not name:
            if any((v for v in r.values() if v)):
                errors.append({"row": i, "message": "Falta código o nombre"})
            continue
        supplier_id = None
        prov = r.get("proveedor")
        if prov:
            supplier_id = suppliers.get(prov.lower())
            if supplier_id is None:
                errors.append({"row": i, "message": f"Proveedor '{prov}' no existe (quedó sin proveedor)"})
        wh = (r.get("bodega") or r.get("warehouse") or "").strip().lower()
        warehouse = _WAREHOUSE_ALIASES.get(wh, "principal")
        fields = {
            "name": name,
            "description": r.get("descripcion") or r.get("descripción") or None,
            "unit": r.get("unidad") or "unidad",
            "unit_price": r.get("precio_venta") or r.get("precio") or "0.00",
            "cost_price": r.get("costo") or "0.00",
            "quantity": r.get("stock") or r.get("cantidad") or "0",
            "category": r.get("categoria") or r.get("categoría") or None,
            "warehouse": warehouse,
        }
        if supplier_id is not None:
            fields["supplier_id"] = supplier_id
        existing = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(models.InventoryItem(code=code, **fields))
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "error_count": len(errors), "errors": errors[:100]}


@router.put("/{item_id}", response_model=schemas.InventoryItemOut)
def update_inventory_item(
    item_id: int,
    data: schemas.InventoryItemUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    if data.code and data.code != item.code:
        conflict = db.query(models.InventoryItem).filter(
            models.InventoryItem.code == data.code,
            models.InventoryItem.id != item_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=400, detail=f"El código '{data.code}' ya existe en el inventario")

    old_qty = item.quantity
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    if data.quantity is not None and data.quantity != old_qty:
        try:
            old_val = float(old_qty or 0)
            new_val = float(data.quantity or 0)
            delta = new_val - old_val
            _log_inventory_txn(db, item.code, delta, source_type="manual", notes=f"Ajuste manual: {old_qty} → {data.quantity}")
        except (ValueError, TypeError):
            pass

    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/withdraw")
def withdraw_inventory_item(
    item_id: int,
    data: dict,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    qty = float(data.get("qty") or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
    current = float(item.quantity or 0)
    if qty > current:
        raise HTTPException(status_code=400, detail=f"Stock insuficiente (disponible: {current})")
    motivo = str(data.get("motivo") or "Consumo interno").strip() or "Consumo interno"
    item.quantity = str(round(current - qty, 4))
    _log_inventory_txn(db, item.code, -qty, source_type="consumo_interno", notes=motivo)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_inventory_item(
    item_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    has_history = db.query(models.InventoryTransaction).filter(
        models.InventoryTransaction.item_code == item.code
    ).first() is not None
    if has_history:
        # Mantiene el registro para no huerfanar las transacciones históricas (referenciadas por code, no FK)
        item.is_active = False
        db.commit()
        return {"ok": True, "message": "Artículo desactivado (tiene movimientos históricos)"}
    db.delete(item)
    db.commit()
    return {"ok": True}
