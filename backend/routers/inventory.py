from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, date, timedelta
import csv, io
import models, schemas
from database import get_db
from auth import require_staff, require_agent_or_admin, require_supplies_or_above


def _parse_date(s: Optional[str]) -> Optional[date]:
    """Parsea 'YYYY-MM-DD' a date; devuelve None si viene vacío o inválido."""
    if not s:
        return None
    try:
        return datetime.strptime(s.strip()[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None

# Mapea etiquetas/claves de bodega del CSV a la clave interna del enum.
_WAREHOUSE_ALIASES = {
    "principal": "principal", "bodega principal": "principal",
    "partes": "partes", "bodega de partes": "partes",
    "suministros_mps": "suministros_mps", "suministros mps": "suministros_mps",
    "impresoras_mps": "impresoras_mps", "bodega de impresoras mps": "impresoras_mps",
    "herramientas_microsoldadura": "herramientas_microsoldadura",
    "herramientas microsoldadura": "herramientas_microsoldadura",
}

_CONDITION_ALIASES = {
    "nuevo": "nuevo", "funcional": "funcional",
    "dañado": "dañado", "danado": "dañado", "dañada": "dañado",
    "incompleto": "incompleto", "incompleta": "incompleto",
}

_STATUS_ALIASES = {
    "ingresado": "ingresado", "ingresada": "ingresado",
    "revisado": "revisado", "revisada": "revisado",
    "por_devolver": "por_devolver", "por devolver": "por_devolver",
}


def _fmt_num(v) -> Optional[str]:
    """Formatea un número como string compacto (sin ceros de más) o None si no aplica."""
    try:
        if v is None or v == "":
            return None
        return f"{float(v):.4f}".rstrip("0").rstrip(".") or "0"
    except (ValueError, TypeError):
        return None


def _log_inventory_txn(db: Session, item_code: str, qty_delta: float, source_type: str = "manual", source_id: int = None, notes: str = None, supplier_id: int = None, unit_cost=None):
    delta_str = f"{qty_delta:.4f}".rstrip("0").rstrip(".")
    db.add(models.InventoryTransaction(
        item_code=item_code,
        qty_delta=delta_str,
        source_type=source_type,
        source_id=source_id,
        notes=notes,
        supplier_id=supplier_id,
        unit_cost=_fmt_num(unit_cost),
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
    supplier_id: Optional[int] = Query(default=None),
    date_from: Optional[str] = Query(default=None),  # YYYY-MM-DD (inclusive)
    date_to: Optional[str] = Query(default=None),    # YYYY-MM-DD (inclusive)
    limit: int = Query(default=200, le=2000),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    q = db.query(models.InventoryTransaction)
    if item_code:
        q = q.filter(models.InventoryTransaction.item_code == item_code)
    if source_type:
        q = q.filter(models.InventoryTransaction.source_type == source_type)
    if supplier_id:
        q = q.filter(models.InventoryTransaction.supplier_id == supplier_id)
    _df = _parse_date(date_from)
    _dt = _parse_date(date_to)
    if _df:
        q = q.filter(models.InventoryTransaction.created_at >= _df)
    if _dt:
        q = q.filter(models.InventoryTransaction.created_at < _dt + timedelta(days=1))
    txns = q.order_by(models.InventoryTransaction.created_at.desc()).limit(limit).all()

    # Item names + costo (para valorizar y como fallback de unit_cost)
    codes = list({t.item_code for t in txns})
    items_by_code = {}
    item_cost_by_code = {}
    if codes:
        for it in db.query(models.InventoryItem.code, models.InventoryItem.name, models.InventoryItem.cost_price).filter(models.InventoryItem.code.in_(codes)).all():
            items_by_code[it.code] = it.name
            item_cost_by_code[it.code] = it.cost_price

    # Nombres de proveedor (para recepciones)
    sup_ids = list({t.supplier_id for t in txns if t.supplier_id})
    suppliers_by_id = {}
    if sup_ids:
        for s in db.query(models.Supplier.id, models.Supplier.name).filter(models.Supplier.id.in_(sup_ids)).all():
            suppliers_by_id[s.id] = s.name

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
            "supplier_id": t.supplier_id,
            "supplier_name": suppliers_by_id.get(t.supplier_id) if t.supplier_id else None,
            "unit_cost": t.unit_cost if t.unit_cost not in (None, "") else item_cost_by_code.get(t.item_code),
        })
    return results


_SOURCE_LABEL_ES = {
    "manual": "Ajuste manual",
    "dispatch": "Salida por pedido",
    "dispatch_revert": "Reposición de pedido",
    "ticket_part": "Salida por ticket",
    "ticket_part_return": "Devolución de parte (ticket)",
    "invoice": "Factura",
    "order": "Pedido",
    "consumo_interno": "Salida manual",
    "recepcion": "Recepción de proveedor",
    "ajuste": "Ajuste de inventario",
    "inventario_inicial": "Inventario inicial",
    "baja": "Baja de inventario",
}


def _brand_logo_tag(db: Session) -> str:
    """<img> del logo de branding configurado (company_logo_b64 en BD); fallback al logo estático."""
    try:
        from routers.settings import _get_setting
        import base64 as _b64
        b64 = _get_setting(db, "company_logo_b64")
        if b64:
            data = _b64.b64decode(b64)
            mime = "image/png"
            if data[:2] == b"\xff\xd8":
                mime = "image/jpeg"
            elif len(data) > 11 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
                mime = "image/webp"
            return f'<img src="data:{mime};base64,{b64}" width="52" height="52" alt="Logo" style="border-radius:6px;display:block;object-fit:contain" />'
    except Exception:
        pass
    try:
        from routers.settings import _logo_b64_tag
        return _logo_b64_tag() or ""
    except Exception:
        return ""


def _report_rows(db: Session, date_from, date_to, direction, supplier_id, category):
    """Devuelve los movimientos valorizados (con costo unitario y valor) según los filtros."""
    df = _parse_date(date_from)
    dt = _parse_date(date_to)
    q = db.query(models.InventoryTransaction)
    if supplier_id:
        q = q.filter(models.InventoryTransaction.supplier_id == supplier_id)
    if df:
        q = q.filter(models.InventoryTransaction.created_at >= df)
    if dt:
        q = q.filter(models.InventoryTransaction.created_at < dt + timedelta(days=1))
    txns = q.order_by(models.InventoryTransaction.created_at.desc()).limit(5000).all()

    codes = list({t.item_code for t in txns})
    name_by, cost_by, cat_by = {}, {}, {}
    if codes:
        for it in db.query(models.InventoryItem.code, models.InventoryItem.name, models.InventoryItem.cost_price, models.InventoryItem.category).filter(models.InventoryItem.code.in_(codes)).all():
            name_by[it.code] = it.name
            cost_by[it.code] = it.cost_price
            cat_by[it.code] = it.category
    sup_ids = list({t.supplier_id for t in txns if t.supplier_id})
    sup_by = {}
    if sup_ids:
        for s in db.query(models.Supplier.id, models.Supplier.name).filter(models.Supplier.id.in_(sup_ids)).all():
            sup_by[s.id] = s.name

    rows = []
    for t in txns:
        try:
            qty = float(t.qty_delta or 0)
        except (ValueError, TypeError):
            qty = 0.0
        if direction == "entradas" and qty <= 0:
            continue
        if direction == "salidas" and qty >= 0:
            continue
        if category and (cat_by.get(t.item_code) or "") != category:
            continue
        try:
            cost = float(t.unit_cost) if t.unit_cost not in (None, "") else float(cost_by.get(t.item_code) or 0)
        except (ValueError, TypeError):
            cost = 0.0
        rows.append({
            "created_at": t.created_at,
            "item_code": t.item_code,
            "item_name": name_by.get(t.item_code) or t.item_code,
            "source_type": t.source_type,
            "label": _SOURCE_LABEL_ES.get(t.source_type, t.source_type),
            "supplier_name": sup_by.get(t.supplier_id) if t.supplier_id else None,
            "qty": qty,
            "cost": cost,
            "value": abs(qty) * cost,
            "notes": t.notes,
        })
    return rows


@router.get("/reports/movements/pdf")
def report_movements_pdf(
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    direction: str = Query(default="all"),   # entradas | salidas | all
    supplier_id: Optional[int] = Query(default=None),
    category: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    """Reporte PDF de entradas/salidas valorizado, con los mismos filtros de la pantalla."""
    from html import escape
    rows = _report_rows(db, date_from, date_to, direction, supplier_id, category)

    def money(v):
        return f"${v:,.2f}"

    from datetime import timezone
    _BOGOTA = timezone(timedelta(hours=-5))

    def fmt_dt(d):
        if not d:
            return ""
        try:
            if d.tzinfo is not None:
                d = d.astimezone(_BOGOTA)  # UTC-5 (Bogotá)
        except Exception:
            pass
        return d.strftime("%d/%m/%Y %H:%M")

    generated_at = datetime.now(timezone.utc).astimezone(_BOGOTA).strftime("%d/%m/%Y %H:%M")

    ent = [r for r in rows if r["qty"] > 0]
    sal = [r for r in rows if r["qty"] < 0]
    ent_qty = sum(r["qty"] for r in ent)
    ent_val = sum(r["value"] for r in ent)
    sal_qty = sum(-r["qty"] for r in sal)
    sal_val = sum(r["value"] for r in sal)

    # Agrupado de entradas por proveedor
    by_sup = {}
    for r in ent:
        k = r["supplier_name"] or "Sin proveedor"
        g = by_sup.setdefault(k, {"qty": 0.0, "val": 0.0})
        g["qty"] += r["qty"]
        g["val"] += r["value"]

    supplier_name = None
    if supplier_id:
        s = db.query(models.Supplier.name).filter(models.Supplier.id == supplier_id).first()
        supplier_name = s[0] if s else None

    dir_label = {"entradas": "Solo entradas", "salidas": "Solo salidas"}.get(direction, "Entradas y salidas")
    rango = f"{date_from or '—'} a {date_to or '—'}"

    logo = _brand_logo_tag(db)
    try:
        from routers.settings import _html_to_pdf, _wrap_html
    except Exception:
        _html_to_pdf = None

    th = "border:1px solid #d1d5db;padding:5px 7px;background:#f3f4f6;font-size:8.5pt;text-align:left"
    tdc = "border:1px solid #e5e7eb;padding:4px 7px;font-size:8.5pt"
    tdr = tdc + ";text-align:right"

    detail = "".join(
        f"<tr>"
        f"<td style=\"{tdc}\">{fmt_dt(r['created_at'])}</td>"
        f"<td style=\"{tdc}\"><b>{escape(r['item_code'])}</b><br><span style='color:#6b7280'>{escape(r['item_name'] or '')}</span></td>"
        f"<td style=\"{tdc}\">{escape(r['label'])}</td>"
        f"<td style=\"{tdc}\">{escape(r['supplier_name'] or '—')}</td>"
        f"<td style=\"{tdr};color:{'#047857' if r['qty']>0 else '#dc2626'}\">{'+' if r['qty']>0 else ''}{r['qty']:g}</td>"
        f"<td style=\"{tdr}\">{money(r['cost'])}</td>"
        f"<td style=\"{tdr}\">{money(r['value'])}</td>"
        f"</tr>"
        for r in rows
    ) or f"<tr><td colspan='7' style='{tdc};text-align:center;color:#9ca3af'>Sin movimientos en el rango seleccionado</td></tr>"

    sup_rows = "".join(
        f"<tr><td style=\"{tdc}\">{escape(k)}</td><td style=\"{tdr}\">{g['qty']:g}</td><td style=\"{tdr}\">{money(g['val'])}</td></tr>"
        for k, g in sorted(by_sup.items(), key=lambda kv: -kv[1]['val'])
    )

    body = f"""
    <div style="font-family:Arial,sans-serif;color:#111">
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
        <tr>
          <td style="width:60px;vertical-align:middle">{logo}</td>
          <td style="vertical-align:middle">
            <div style="font-size:15pt;font-weight:bold">Reporte de movimientos de inventario</div>
            <div style="font-size:9pt;color:#6b7280">Rango: {escape(rango)} · {dir_label}{(' · Proveedor: ' + escape(supplier_name)) if supplier_name else ''}{(' · Categoría: ' + escape(category)) if category else ''}</div>
            <div style="font-size:8pt;color:#9ca3af">Generado: {generated_at}</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <tr>
          <th style="{th}">Concepto</th><th style="{th};text-align:right">Cantidad</th><th style="{th};text-align:right">Valor</th>
        </tr>
        <tr><td style="{tdc};color:#047857"><b>Entradas</b></td><td style="{tdr}">{ent_qty:g}</td><td style="{tdr}"><b>{money(ent_val)}</b></td></tr>
        <tr><td style="{tdc};color:#dc2626"><b>Salidas</b></td><td style="{tdr}">{sal_qty:g}</td><td style="{tdr}"><b>{money(sal_val)}</b></td></tr>
        <tr><td style="{tdc}"><b>Neto (entradas − salidas)</b></td><td style="{tdr}">{(ent_qty - sal_qty):g}</td><td style="{tdr}"><b>{money(ent_val - sal_val)}</b></td></tr>
      </table>

      {('<div style="font-size:10pt;font-weight:bold;margin:8px 0 4px">Entradas por proveedor</div>'
        '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">'
        f'<tr><th style="{th}">Proveedor</th><th style="{th};text-align:right">Cantidad</th><th style="{th};text-align:right">Valor</th></tr>'
        f'{sup_rows}</table>') if by_sup else ''}

      <div style="font-size:10pt;font-weight:bold;margin:8px 0 4px">Detalle ({len(rows)} movimiento(s))</div>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <th style="{th}">Fecha</th><th style="{th}">Artículo</th><th style="{th}">Tipo</th>
          <th style="{th}">Proveedor</th><th style="{th};text-align:right">Cant.</th>
          <th style="{th};text-align:right">Costo u.</th><th style="{th};text-align:right">Valor</th>
        </tr>
        {detail}
      </table>
    </div>
    """

    if not _html_to_pdf:
        raise HTTPException(status_code=500, detail="Motor de PDF no disponible")
    pdf = _html_to_pdf(_wrap_html(body))
    if not pdf:
        raise HTTPException(status_code=500, detail="No se pudo generar el PDF")
    fname = f"reporte-movimientos-{(date_from or 'inicio')}_{(date_to or 'hoy')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


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
    txns = (
        db.query(models.InventoryTransaction)
        .filter(models.InventoryTransaction.item_code == item.code)
        .order_by(models.InventoryTransaction.created_at.desc())
        .limit(limit)
        .all()
    )
    for t in txns:
        t.supplier_name = t.supplier.name if t.supplier else None
    return txns


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
    # Registrar el stock inicial como movimiento para trazabilidad.
    try:
        qty0 = float(item.quantity or 0)
        if qty0 > 0:
            _log_inventory_txn(db, item.code, qty0, source_type="inventario_inicial", notes="Stock inicial al crear el artículo", unit_cost=item.cost_price)
            db.commit()
    except (ValueError, TypeError):
        pass
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
        cond_raw = (r.get("condicion") or r.get("condición") or "").strip().lower()
        condition = _CONDITION_ALIASES.get(cond_raw, "nuevo") if cond_raw else "nuevo"
        if cond_raw and cond_raw not in _CONDITION_ALIASES:
            errors.append({"row": i, "message": f"Condición '{cond_raw}' inválida (se usó 'nuevo')"})
        st_raw = (r.get("estado") or r.get("item_status") or "").strip().lower()
        item_status = _STATUS_ALIASES.get(st_raw, "ingresado") if st_raw else "ingresado"
        if st_raw and st_raw not in _STATUS_ALIASES:
            errors.append({"row": i, "message": f"Estado '{st_raw}' inválido (se usó 'ingresado')"})
        fields = {
            "name": name,
            "description": r.get("descripcion") or r.get("descripción") or None,
            "unit": r.get("unidad") or "unidad",
            "unit_price": r.get("precio_venta") or r.get("precio") or "0.00",
            "cost_price": r.get("costo") or "0.00",
            "quantity": r.get("stock") or r.get("cantidad") or "0",
            "category": r.get("categoria") or r.get("categoría") or None,
            "warehouse": warehouse,
            "condition": condition,
            "item_status": item_status,
            "location": r.get("ubicacion") or r.get("ubicación") or None,
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

    # La cantidad NO se edita aquí: solo cambia por Recepción, Salida o Ajuste (trazable
    # y justificado). Se ignora cualquier 'quantity' enviado desde el formulario de edición.
    updates = data.model_dump(exclude_unset=True)
    updates.pop("quantity", None)
    for field, value in updates.items():
        setattr(item, field, value)

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
    justif = str(data.get("justificacion") or "").strip()
    if motivo.lower() == "otro" and not justif:
        raise HTTPException(status_code=400, detail="La justificación es obligatoria cuando el motivo es 'Otro'")
    note = f"{motivo} · {justif}" if justif else motivo
    item.quantity = str(round(current - qty, 4))
    _log_inventory_txn(db, item.code, -qty, source_type="consumo_interno", notes=note[:300], unit_cost=item.cost_price)
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/receive", response_model=schemas.InventoryItemOut)
def receive_inventory_item(
    item_id: int,
    data: schemas.InventoryReceive,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Recibe stock de un proveedor: suma al stock, recalcula el costo como promedio
    ponderado y deja el movimiento documentado (con proveedor, cantidad y costo)."""
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    if data.qty <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
    if data.cost < 0:
        raise HTTPException(status_code=400, detail="El costo no puede ser negativo")
    supplier = db.query(models.Supplier).filter(models.Supplier.id == data.supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")

    try:
        current_qty = float(item.quantity or 0)
    except (ValueError, TypeError):
        current_qty = 0.0
    try:
        current_cost = float(item.cost_price or 0)
    except (ValueError, TypeError):
        current_cost = 0.0

    new_qty = current_qty + data.qty
    # Promedio ponderado por cantidad. Si no había stock, el costo pasa a ser el recibido.
    if new_qty > 0:
        avg_cost = (current_qty * current_cost + data.qty * data.cost) / new_qty
    else:
        avg_cost = data.cost

    item.quantity = str(round(new_qty, 4))
    item.cost_price = f"{avg_cost:.2f}"

    # Si tenía cantidad pendiente por recibir (parte especial), la reducimos con lo recibido.
    try:
        pending = float(item.pending_qty or 0)
    except (ValueError, TypeError):
        pending = 0.0
    part_arrived = pending > 0
    if pending > 0:
        remaining = max(0.0, pending - data.qty)
        if remaining > 0:
            item.pending_qty = f"{remaining:.4f}".rstrip("0").rstrip(".") or None
        else:
            item.pending_qty = None
            item.pending_eta = None  # ya llegó todo lo pendiente

    note = f"Recibido de {supplier.name} · costo unit. ${data.cost:.2f}"
    if data.notes and data.notes.strip():
        note += f" · {data.notes.strip()}"
    _log_inventory_txn(db, item.code, data.qty, source_type="recepcion",
                       supplier_id=data.supplier_id, notes=note[:300], unit_cost=data.cost)
    db.commit()
    db.refresh(item)

    # Aviso al técnico que solicitó la parte especial: ya llegó.
    if part_arrived:
        try:
            from notify import create_notification
            reqs = db.query(models.PartRequest).filter(
                models.PartRequest.item_code == item.code,
                models.PartRequest.is_special == True,
                models.PartRequest.status == "aprobado",
            ).all()
            seen = set()
            for pr in reqs:
                if pr.requested_by_id and pr.requested_by_id not in seen:
                    seen.add(pr.requested_by_id)
                    create_notification(
                        db, pr.requested_by_id,
                        "Parte recibida 📦",
                        f"Ya llegó la parte que solicitaste: {item.name} · Ticket #{pr.ticket_id}",
                        url=f"/tickets/{pr.ticket_id}", kind="part_received",
                    )
            db.commit()
        except Exception:
            db.rollback()
    return item


@router.patch("/{item_id}/pending", response_model=schemas.InventoryItemOut)
def update_pending_eta(
    item_id: int,
    data: schemas.InventoryPendingUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Actualiza la fecha estimada de llegada (ETA) y/o el proveedor de una parte pendiente por recibir."""
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    updates = data.model_dump(exclude_unset=True)
    if "expected_date" in updates:
        item.pending_eta = updates["expected_date"]
    if "supplier_id" in updates:
        item.supplier_id = updates["supplier_id"]
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/adjust", response_model=schemas.InventoryItemOut)
def adjust_inventory_item(
    item_id: int,
    data: schemas.InventoryAdjust,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Ajuste de inventario (corrección de conteo, merma, error): fija la cantidad real y
    registra el movimiento (+/-) con una justificación obligatoria."""
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    justif = (data.justification or "").strip()
    if not justif:
        raise HTTPException(status_code=400, detail="La justificación del ajuste es obligatoria")
    if data.new_qty < 0:
        raise HTTPException(status_code=400, detail="La cantidad no puede ser negativa")
    try:
        current = float(item.quantity or 0)
    except (ValueError, TypeError):
        current = 0.0
    delta = round(data.new_qty - current, 4)
    if abs(delta) < 1e-9:
        raise HTTPException(status_code=400, detail="La cantidad no cambió respecto al stock actual")
    item.quantity = f"{data.new_qty:.4f}".rstrip("0").rstrip(".") or "0"
    note = f"Ajuste: {current:g} → {data.new_qty:g} · {justif}"
    _log_inventory_txn(db, item.code, delta, source_type="ajuste", notes=note[:300], unit_cost=item.cost_price)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_inventory_item(
    item_id: int,
    data: schemas.InventoryDelete,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    """Baja de un artículo. Requiere justificación obligatoria. Si aún tiene stock,
    registra la salida de lo restante para conservar la trazabilidad. Nunca hace hard-delete:
    el artículo se desactiva para preservar el historial y el motivo de la baja."""
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    justif = (data.justification or "").strip()
    if not justif:
        raise HTTPException(status_code=400, detail="La justificación de la baja es obligatoria")
    try:
        current = float(item.quantity or 0)
    except (ValueError, TypeError):
        current = 0.0
    if current > 0:
        # Registra el egreso del stock restante para que la baja quede trazada
        _log_inventory_txn(db, item.code, -current, source_type="baja",
                           notes=f"Baja de inventario (stock {current:g} retirado) · {justif}"[:300], unit_cost=item.cost_price)
        item.quantity = "0"
    else:
        # Sin stock: igual deja el registro de baja con su motivo
        _log_inventory_txn(db, item.code, 0, source_type="baja",
                           notes=f"Baja de inventario · {justif}"[:300])
    item.is_active = False
    db.commit()
    return {"ok": True, "message": "Artículo dado de baja"}
