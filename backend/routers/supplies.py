import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
import models, schemas
from database import get_db
from auth import require_agent_or_admin, require_supplies_or_above

router = APIRouter(prefix="/api/supplies", tags=["supplies"])


# ── Helpers ───────────────────────────────────────────

def _next_delivery_num(db: Session) -> str:
    rows = db.query(models.SupplyDelivery.delivery_number).filter(
        models.SupplyDelivery.delivery_number.like("ENT-%")
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"ENT-{(max(nums) + 1) if nums else 1:04d}"


def _lot_dispatched_qty(db: Session, lot_id: int) -> int:
    result = db.query(func.coalesce(func.sum(models.SupplyDispatch.quantity_dispatched), 0)).filter(
        models.SupplyDispatch.lot_id == lot_id
    ).scalar()
    return int(result or 0)


def _fifo_allocate(db: Session, item_code: str, qty_needed: int) -> list:
    """Devuelve [(lot_id, item_name, qty)] en orden FIFO (entry_date ASC)."""
    lots = db.query(models.SupplyLot).filter(
        models.SupplyLot.item_code == item_code
    ).order_by(models.SupplyLot.entry_date, models.SupplyLot.id).all()

    allocations = []
    remaining = qty_needed
    for lot in lots:
        avail = lot.quantity_received - _lot_dispatched_qty(db, lot.id)
        if avail <= 0:
            continue
        take = min(avail, remaining)
        allocations.append((lot.id, lot.item_name, take))
        remaining -= take
        if remaining <= 0:
            break

    if remaining > 0:
        available_total = qty_needed - remaining
        raise HTTPException(
            400,
            f"Stock insuficiente para '{item_code}': disponible {available_total}, solicitado {qty_needed}"
        )
    return allocations


def _printer_snapshot(printer: models.Printer) -> str:
    return json.dumps({
        "id": printer.id,
        "brand": printer.brand,
        "model": printer.model,
        "serial_number": printer.serial_number,
        "asset_id": printer.asset_id,
        "location": printer.location,
        "contact_name": printer.contact_name,
        "ip_address": printer.ip_address,
    }, ensure_ascii=False)


def _lot_out(lot: models.SupplyLot, db: Session) -> schemas.SupplyLotOut:
    dispatched = _lot_dispatched_qty(db, lot.id)
    return schemas.SupplyLotOut(
        id=lot.id,
        item_code=lot.item_code,
        item_name=lot.item_name,
        supplier_id=lot.supplier_id,
        entry_date=lot.entry_date,
        unit_cost=lot.unit_cost,
        quantity_received=lot.quantity_received,
        notes=lot.notes,
        created_at=lot.created_at,
        updated_at=lot.updated_at,
        dispatched_qty=dispatched,
        available=lot.quantity_received - dispatched,
    )


def _line_out(line: models.SupplyDispatch) -> schemas.SupplyDispatchLineOut:
    return schemas.SupplyDispatchLineOut(
        id=line.id,
        lot_id=line.lot_id,
        item_code=line.lot.item_code if line.lot else "",
        item_name=line.lot.item_name if line.lot else "",
        quantity_dispatched=line.quantity_dispatched,
        serial_number=line.serial_number,
        exit_price=line.exit_price,
        unit_cost=line.lot.unit_cost if line.lot else None,
        printer_id=line.printer_id,
        printer_snapshot=line.printer_snapshot,
        notes=line.notes,
        created_at=line.created_at,
    )


def _delivery_out(d: models.SupplyDelivery) -> schemas.SupplyDeliveryOut:
    contract_number = contract_client = None
    if d.contract:
        contract_number = d.contract.contract_number
        contract_client = d.contract.client_company or d.contract.client_name
    invoice_number = d.invoice.invoice_number if d.invoice else None
    client_name = d.client_name or (d.client.name if d.client else None)
    return schemas.SupplyDeliveryOut(
        id=d.id,
        delivery_number=d.delivery_number,
        delivery_date=d.delivery_date,
        contract_id=d.contract_id,
        contract_number=contract_number,
        contract_client=contract_client,
        client_id=d.client_id,
        client_name=client_name,
        invoice_id=d.invoice_id,
        invoice_number=invoice_number,
        dispatch_condition=d.dispatch_condition,
        delivery_method=d.delivery_method,
        notes=d.notes,
        created_at=d.created_at,
        lines=[_line_out(l) for l in (d.lines or [])],
    )


def _next_invoice_num(db: Session) -> str:
    rows = db.query(models.Invoice.invoice_number).filter(
        models.Invoice.invoice_number.like("FAC-%"),
        models.Invoice.deleted_at.is_(None),
    ).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    return f"FAC-{(max(nums) + 1) if nums else 1:04d}"


# ── Lots ──────────────────────────────────────────────

@router.get("/lots", response_model=List[schemas.SupplyLotOut])
def list_lots(
    item_code: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    qs = db.query(models.SupplyLot)
    if item_code:
        qs = qs.filter(models.SupplyLot.item_code == item_code)
    if q:
        like = f"%{q}%"
        qs = qs.filter(
            models.SupplyLot.item_code.ilike(like) |
            models.SupplyLot.item_name.ilike(like)
        )
    lots = qs.order_by(models.SupplyLot.item_code, models.SupplyLot.entry_date.desc()).all()
    return [_lot_out(lot, db) for lot in lots]


@router.get("/lots/{lot_id}", response_model=schemas.SupplyLotOut)
def get_lot(lot_id: int, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    lot = db.query(models.SupplyLot).filter(models.SupplyLot.id == lot_id).first()
    if not lot:
        raise HTTPException(404, "Lote no encontrado")
    return _lot_out(lot, db)


@router.post("/lots", response_model=schemas.SupplyLotOut, status_code=201)
def create_lot(data: schemas.SupplyLotCreate, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    if (data.quantity_received or 0) <= 0:
        raise HTTPException(status_code=400, detail="La cantidad recibida debe ser mayor a cero")
    lot = models.SupplyLot(**data.model_dump())
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return _lot_out(lot, db)


@router.put("/lots/{lot_id}", response_model=schemas.SupplyLotOut)
def update_lot(lot_id: int, data: schemas.SupplyLotUpdate, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    lot = db.query(models.SupplyLot).filter(models.SupplyLot.id == lot_id).first()
    if not lot:
        raise HTTPException(404, "Lote no encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(lot, k, v)
    db.commit()
    db.refresh(lot)
    return _lot_out(lot, db)


@router.delete("/lots/{lot_id}", status_code=204)
def delete_lot(lot_id: int, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    lot = db.query(models.SupplyLot).filter(models.SupplyLot.id == lot_id).first()
    if not lot:
        raise HTTPException(404, "Lote no encontrado")
    has_dispatches = db.query(models.SupplyDispatch).filter(
        models.SupplyDispatch.lot_id == lot_id
    ).first()
    if has_dispatches:
        raise HTTPException(400, "No se puede eliminar un lote que ya tiene despachos registrados")
    db.delete(lot)
    db.commit()


# ── Deliveries ────────────────────────────────────────

@router.get("/deliveries", response_model=List[schemas.SupplyDeliveryOut])
def list_deliveries(
    contract_id: Optional[int] = Query(None),
    client_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    qs = db.query(models.SupplyDelivery)
    if contract_id:
        qs = qs.filter(models.SupplyDelivery.contract_id == contract_id)
    if client_id:
        qs = qs.filter(models.SupplyDelivery.client_id == client_id)
    return [_delivery_out(d) for d in qs.order_by(models.SupplyDelivery.delivery_date.desc()).all()]


@router.get("/deliveries/{delivery_id}", response_model=schemas.SupplyDeliveryOut)
def get_delivery(delivery_id: int, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    d = db.query(models.SupplyDelivery).filter(models.SupplyDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(404, "Entrega no encontrada")
    return _delivery_out(d)


@router.post("/deliveries", response_model=schemas.SupplyDeliveryOut, status_code=201)
def create_delivery(
    data: schemas.SupplyDeliveryCreate,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    if not data.lines:
        raise HTTPException(400, "La entrega debe tener al menos un ítem")

    is_direct_sale = not data.contract_id

    # Pre-validate stock for all lines before touching the DB
    for line_in in data.lines:
        _fifo_allocate(db, line_in.item_code, line_in.quantity_dispatched)

    # Create delivery header — check for collision from concurrent requests
    delivery_number = _next_delivery_num(db)
    if db.query(models.SupplyDelivery.id).filter(
        models.SupplyDelivery.delivery_number == delivery_number
    ).first():
        delivery_number = _next_delivery_num(db)
    delivery = models.SupplyDelivery(
        delivery_number=delivery_number,
        delivery_date=data.delivery_date,
        contract_id=data.contract_id,
        client_id=data.client_id,
        client_name=data.client_name,
        dispatch_condition=data.dispatch_condition,
        delivery_method=data.delivery_method,
        notes=data.notes,
    )
    db.add(delivery)
    db.flush()

    inv_items = []
    total = 0.0

    for line_in in data.lines:
        # Resolve printer once per line
        printer = None
        snap = None
        if line_in.printer_id:
            printer = db.query(models.Printer).filter(models.Printer.id == line_in.printer_id).first()
            if printer:
                snap = _printer_snapshot(printer)

        # FIFO allocation: may produce multiple dispatch records per user line
        allocations = _fifo_allocate(db, line_in.item_code, line_in.quantity_dispatched)
        for lot_id, item_name, qty in allocations:
            db.add(models.SupplyDispatch(
                delivery_id=delivery.id,
                lot_id=lot_id,
                quantity_dispatched=qty,
                serial_number=line_in.serial_number,
                exit_price=line_in.exit_price or "0.00",
                printer_id=line_in.printer_id,
                printer_snapshot=snap,
                notes=line_in.notes,
            ))
            if is_direct_sale:
                price = float(line_in.exit_price or "0")
                total += price * qty
                inv_items.append({
                    "description": f"[{line_in.item_code}] {item_name}",
                    "qty": qty,
                    "unit_price": line_in.exit_price or "0.00",
                })

    # Auto-create invoice for direct sales
    if is_direct_sale and inv_items:
        client_name_inv = data.client_name
        if data.client_id and not client_name_inv:
            u = db.query(models.User).filter(models.User.id == data.client_id).first()
            client_name_inv = u.name if u else None

        invoice = models.Invoice(
            invoice_number=_next_invoice_num(db),
            status="Borrador",
            client_id=data.client_id,
            client_name=client_name_inv,
            date=data.delivery_date,
            items=json.dumps(inv_items, ensure_ascii=False),
            subtotal=f"{total:.2f}",
            total=f"{total:.2f}",
            notes=f"Generada desde despacho de suministros {delivery_number}",
        )
        db.add(invoice)
        db.flush()
        delivery.invoice_id = invoice.id

    db.commit()
    db.refresh(delivery)
    return _delivery_out(delivery)


@router.put("/deliveries/{delivery_id}", response_model=schemas.SupplyDeliveryOut)
def update_delivery(
    delivery_id: int,
    data: schemas.SupplyDeliveryUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    d = db.query(models.SupplyDelivery).filter(models.SupplyDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(404, "Entrega no encontrada")
    if data.delivery_date is not None:
        d.delivery_date = data.delivery_date
    if data.notes is not None:
        d.notes = data.notes
    if data.client_name is not None:
        d.client_name = data.client_name
    if data.dispatch_condition is not None:
        d.dispatch_condition = data.dispatch_condition
    if data.delivery_method is not None:
        d.delivery_method = data.delivery_method
    if data.lines:
        for lu in data.lines:
            line = db.query(models.SupplyDispatch).filter(
                models.SupplyDispatch.id == lu.id,
                models.SupplyDispatch.delivery_id == delivery_id,
            ).first()
            if not line:
                continue
            if lu.serial_number is not None:
                line.serial_number = lu.serial_number
            if lu.exit_price is not None:
                line.exit_price = lu.exit_price
            if lu.notes is not None:
                line.notes = lu.notes
            if lu.printer_id is not None:
                printer = db.query(models.Printer).filter(models.Printer.id == lu.printer_id).first()
                if printer:
                    line.printer_id = printer.id
                    line.printer_snapshot = _printer_snapshot(printer)

    if data.add_lines:
        for line_in in data.add_lines:
            snap = None
            if line_in.printer_id:
                p = db.query(models.Printer).filter(models.Printer.id == line_in.printer_id).first()
                if p:
                    snap = _printer_snapshot(p)
            allocations = _fifo_allocate(db, line_in.item_code, line_in.quantity_dispatched)
            for lot_id, item_name, qty in allocations:
                db.add(models.SupplyDispatch(
                    delivery_id=delivery_id,
                    lot_id=lot_id,
                    quantity_dispatched=qty,
                    serial_number=line_in.serial_number,
                    exit_price=line_in.exit_price or "0.00",
                    printer_id=line_in.printer_id,
                    printer_snapshot=snap,
                    notes=line_in.notes,
                ))

    db.commit()
    db.refresh(d)
    return _delivery_out(d)


@router.delete("/deliveries/{delivery_id}", status_code=204)
def delete_delivery(delivery_id: int, db: Session = Depends(get_db), _=Depends(require_supplies_or_above)):
    d = db.query(models.SupplyDelivery).filter(models.SupplyDelivery.id == delivery_id).first()
    if not d:
        raise HTTPException(404, "Entrega no encontrada")
    db.delete(d)
    db.commit()


# ── Stats / Dashboard ─────────────────────────────────
from datetime import date as _date

@router.get("/stats")
def get_supply_stats(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    from sqlalchemy import cast, Date as SADate
    qs = db.query(models.SupplyDelivery)
    if date_from:
        qs = qs.filter(models.SupplyDelivery.delivery_date >= date_from)
    if date_to:
        qs = qs.filter(models.SupplyDelivery.delivery_date <= date_to)
    deliveries = qs.all()

    by_condition: dict = {}
    by_client: dict = {}
    by_method: dict = {}
    by_month: dict = {}

    for d in deliveries:
        cond = d.dispatch_condition or "Sin condición"
        method = d.delivery_method or "Sin método"
        client = d.client_name or (d.contract.client_company or d.contract.client_name if d.contract else "Sin cliente")
        month_key = str(d.delivery_date)[:7]  # YYYY-MM

        cost = sum(
            float(l.lot.unit_cost or 0) * l.quantity_dispatched
            for l in (d.lines or []) if l.lot
        )
        qty = sum(l.quantity_dispatched for l in (d.lines or []))

        # by condition
        if cond not in by_condition:
            by_condition[cond] = {"condition": cond, "count": 0, "items": 0, "cost": 0.0}
        by_condition[cond]["count"] += 1
        by_condition[cond]["items"] += qty
        by_condition[cond]["cost"] += cost

        # by client
        if client not in by_client:
            by_client[client] = {"client": client, "count": 0, "items": 0, "cost": 0.0}
        by_client[client]["count"] += 1
        by_client[client]["items"] += qty
        by_client[client]["cost"] += cost

        # by method
        if method not in by_method:
            by_method[method] = {"method": method, "count": 0}
        by_method[method]["count"] += 1

        # by month
        if month_key not in by_month:
            by_month[month_key] = {"month": month_key, "count": 0, "cost": 0.0}
        by_month[month_key]["count"] += 1
        by_month[month_key]["cost"] += cost

    return {
        "total_deliveries": len(deliveries),
        "total_cost": round(sum(v["cost"] for v in by_condition.values()), 2),
        "by_condition": sorted(by_condition.values(), key=lambda x: x["count"], reverse=True),
        "by_client": sorted(by_client.values(), key=lambda x: x["cost"], reverse=True)[:20],
        "by_method": list(by_method.values()),
        "by_month": sorted(by_month.values(), key=lambda x: x["month"]),
    }


# ── Item catalog (autocomplete) ───────────────────────

@router.get("/items")
def list_item_codes(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Ítems únicos con stock disponible, para autocomplete."""
    qs = db.query(
        models.SupplyLot.item_code,
        models.SupplyLot.item_name,
    ).distinct(models.SupplyLot.item_code)
    if q:
        like = f"%{q}%"
        qs = qs.filter(
            models.SupplyLot.item_code.ilike(like) |
            models.SupplyLot.item_name.ilike(like)
        )
    rows = qs.order_by(models.SupplyLot.item_code).all()
    # Attach available stock per code
    result = []
    for code, name in rows:
        total = db.query(func.coalesce(func.sum(models.SupplyLot.quantity_received), 0)).filter(
            models.SupplyLot.item_code == code
        ).scalar() or 0
        dispatched = db.query(func.coalesce(func.sum(models.SupplyDispatch.quantity_dispatched), 0)).join(
            models.SupplyLot, models.SupplyDispatch.lot_id == models.SupplyLot.id
        ).filter(models.SupplyLot.item_code == code).scalar() or 0
        available = int(total) - int(dispatched)
        result.append({"item_code": code, "item_name": name, "available": available})
    return result
