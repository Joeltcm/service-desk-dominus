from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
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
