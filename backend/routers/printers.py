from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime
import csv, io, re
import models, schemas
from database import get_db
from auth import require_agent_or_admin, require_supplies_or_above
from routers.inventory import _log_inventory_txn

router = APIRouter(prefix="/api/printers", tags=["printers"])


def _sync_inventory_item(printer: models.Printer, db: Session):
    """Las impresoras en alquiler son activo de la empresa: deben verse en el
    inventario (bodega impresoras_mps). Las de cliente no llevan ítem de inventario."""
    if printer.ownership_type == "alquiler":
        if printer.inventory_item_id:
            item = db.query(models.InventoryItem).filter(models.InventoryItem.id == printer.inventory_item_id).first()
            if item:
                item.is_active = True
                item.warehouse = "impresoras_mps"
                return
        code = f"PRN-{printer.serial_number or printer.id}"
        existing = db.query(models.InventoryItem).filter(models.InventoryItem.code == code).first()
        if existing:
            item = existing
            item.is_active = True
            item.warehouse = "impresoras_mps"
        else:
            item = models.InventoryItem(
                code=code,
                name=f"{printer.brand or ''} {printer.model or ''}".strip() or f"Impresora #{printer.id}",
                quantity="1",
                warehouse="impresoras_mps",
                category="Impresora MPS",
            )
            db.add(item)
            db.flush()
            _log_inventory_txn(db, item.code, 1, source_type="printer_alquiler", source_id=printer.id, notes="Alta de impresora en alquiler")
        printer.inventory_item_id = item.id
    elif printer.inventory_item_id:
        # Dejo de ser alquiler: desactivo el item de inventario en vez de borrarlo.
        item = db.query(models.InventoryItem).filter(models.InventoryItem.id == printer.inventory_item_id).first()
        if item:
            item.is_active = False


@router.get("", response_model=list[schemas.PrinterOut])
def list_printers(
    contract_id: Optional[int] = Query(default=None),
    ownership_type: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    q = db.query(models.Printer)
    if contract_id:
        q = q.filter(models.Printer.contract_id == contract_id)
    if ownership_type:
        q = q.filter(models.Printer.ownership_type == ownership_type)
    return q.order_by(models.Printer.created_at.desc()).all()


@router.get("/{printer_id}", response_model=schemas.PrinterOut)
def get_printer(
    printer_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    printer = db.query(models.Printer).filter(models.Printer.id == printer_id).first()
    if not printer:
        raise HTTPException(status_code=404, detail="Impresora no encontrada")
    return printer


@router.post("", response_model=schemas.PrinterOut, status_code=201)
def create_printer(
    data: schemas.PrinterCreate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    printer = models.Printer(**data.model_dump())
    db.add(printer)
    db.flush()
    _sync_inventory_item(printer, db)
    db.commit()
    db.refresh(printer)
    return printer


@router.put("/{printer_id}", response_model=schemas.PrinterOut)
def update_printer(
    printer_id: int,
    data: schemas.PrinterUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    printer = db.query(models.Printer).filter(models.Printer.id == printer_id).first()
    if not printer:
        raise HTTPException(status_code=404, detail="Impresora no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(printer, field, value)
    _sync_inventory_item(printer, db)
    db.commit()
    db.refresh(printer)
    return printer


@router.delete("/{printer_id}")
def delete_printer(
    printer_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    printer = db.query(models.Printer).filter(models.Printer.id == printer_id).first()
    if not printer:
        raise HTTPException(status_code=404, detail="Impresora no encontrada")
    if printer.inventory_item_id:
        item = db.query(models.InventoryItem).filter(models.InventoryItem.id == printer.inventory_item_id).first()
        if item:
            item.is_active = False
    db.delete(printer)
    db.commit()
    return {"ok": True}


@router.get("/{printer_id}/meter-readings", response_model=list[schemas.MeterReadingOut])
def list_meter_readings(
    printer_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_supplies_or_above),
):
    return (
        db.query(models.MeterReading)
        .filter(models.MeterReading.printer_id == printer_id)
        .order_by(models.MeterReading.reading_date.desc())
        .all()
    )


@router.post("/{printer_id}/meter-readings", response_model=schemas.MeterReadingOut, status_code=201)
def create_meter_reading(
    printer_id: int,
    data: schemas.MeterReadingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    printer = db.query(models.Printer).filter(models.Printer.id == printer_id).first()
    if not printer:
        raise HTTPException(status_code=404, detail="Impresora no encontrada")
    reading = models.MeterReading(
        printer_id=printer_id,
        created_by_id=current_user.id,
        **data.model_dump(),
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)
    return reading


# ---------------------------------------------------------------------------
# Importación masiva de flota desde CSV
# ---------------------------------------------------------------------------
# Columnas esperadas (delimitador ';'):
#  0 Cliente | 1 Cliente-Ubicación | 2 Numero de Serie | 3 Modelo | 4 Ubicación
#  5 Dirección IP | 6 ID de Activo | 7 Contacto(s) | 8 N. de Contrato
#  9 Tipo | 10 Inicio de Garantia

def _parse_warranty_date(raw):
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):  # día primero; cubre 01/08/2025 y 09/01/24
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _add_one_year(d):
    if not d:
        return None
    try:
        return d.replace(year=d.year + 1)
    except ValueError:  # 29 de febrero
        return d.replace(year=d.year + 1, day=28)


def _map_ownership(raw):
    return "alquiler" if (raw or "").strip().lower().startswith("alquiler") else "cliente"


def _norm_contract(s):
    """Normaliza el número de contrato ignorando los ceros de relleno, para que
    'CONT-001' (del archivo) empareje con 'CONT-0001' (del sistema)."""
    s = (s or "").strip().upper()
    if not s:
        return None
    m = re.match(r"^([A-Z]*)[-\s]*0*(\d+)$", s)
    if m:
        return (m.group(1), int(m.group(2)))
    return s


@router.post("/import")
async def import_printers(
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    default_brand: str = Query("Lexmark"),
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    """Importa impresoras desde un CSV. Con dry_run=true solo devuelve la vista
    previa (nada se escribe). Empareja por N. de Contrato contra los contratos
    existentes, deduplica por número de serie (actualiza si ya existe), calcula
    la garantía fin = inicio + 1 año y marca 'Baja' las que están 'Retirada'."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    if not rows:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    # Salta la fila de encabezado si la primera celda parece cabecera
    if rows and "cliente" in (rows[0][0] or "").strip().lower():
        rows = rows[1:]

    contracts = {}
    for c in db.query(models.Contract).filter(models.Contract.contract_number.isnot(None)).all():
        key = _norm_contract(c.contract_number)
        if key is not None and key not in contracts:
            contracts[key] = c

    existing = {
        p.serial_number: p
        for p in db.query(models.Printer).filter(models.Printer.serial_number.isnot(None)).all()
    }

    counts = {"create": 0, "update": 0, "skip_no_contract": 0,
              "skip_no_serial": 0, "duplicate_in_file": 0, "retired": 0, "inventory_items": 0}
    preview = []
    seen = set()

    for i, r in enumerate(rows, start=2):
        if not any((cell or "").strip() for cell in r):
            continue
        r = r + [""] * (11 - len(r))  # tolera filas cortas
        serial = (r[2] or "").strip()
        contract_number = (r[8] or "").strip()
        model = (r[3] or "").strip()
        location = (r[4] or "").strip()
        ip = (r[5] or "").strip() or None
        asset_id = (r[6] or "").strip() or None
        contact = (r[7] or "").strip() or None
        ownership = _map_ownership(r[9])
        wstart = _parse_warranty_date(r[10])
        wend = _add_one_year(wstart)
        status = "Baja" if location.lower() == "retirada" else "Activa"

        info = {
            "line": i, "serial": serial, "model": model,
            "contract_number": contract_number, "ownership": ownership,
            "warranty_start": wstart.isoformat() if wstart else None,
            "warranty_end": wend.isoformat() if wend else None,
            "status": status, "location": location,
        }

        if not serial:
            info["action"] = "skip"; info["reason"] = "sin número de serie"
            counts["skip_no_serial"] += 1
            preview.append(info); continue

        contract = contracts.get(_norm_contract(contract_number))
        if not contract:
            info["action"] = "skip"
            info["reason"] = f"contrato '{contract_number}' no existe" if contract_number else "sin contrato"
            counts["skip_no_contract"] += 1
            preview.append(info); continue

        if serial in seen:
            info["action"] = "skip"; info["reason"] = "serie duplicada en el archivo"
            counts["duplicate_in_file"] += 1
            preview.append(info); continue
        seen.add(serial)

        is_update = serial in existing
        info["action"] = "update" if is_update else "create"
        info["client"] = contract.client_name or contract.client_company
        if status == "Baja":
            counts["retired"] += 1

        if not dry_run:
            fields = dict(
                brand=default_brand, model=model or None, serial_number=serial,
                ownership_type=ownership, contract_id=contract.id,
                warranty_start_date=wstart, warranty_end_date=wend,
                asset_id=asset_id, ip_address=ip, contact_name=contact,
                location=location or None, status=status,
            )
            if is_update:
                printer = existing[serial]
                for k, v in fields.items():
                    setattr(printer, k, v)
            else:
                printer = models.Printer(**fields)
                db.add(printer)
                existing[serial] = printer
            db.flush()
            before = printer.inventory_item_id
            _sync_inventory_item(printer, db)
            if printer.inventory_item_id and printer.inventory_item_id != before:
                counts["inventory_items"] += 1

        counts["update" if is_update else "create"] += 1
        preview.append(info)

    if not dry_run:
        db.commit()

    return {"dry_run": dry_run, "counts": counts, "total_rows": len(preview), "preview": preview}
