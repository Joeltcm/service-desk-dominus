from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
import os, uuid
from database import get_db
from auth import get_current_user, require_admin, require_admin_or_ventas, require_staff
import models, schemas

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


@router.get("", response_model=List[schemas.SupplierOut])
def list_suppliers(
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_staff),
):
    query = db.query(models.Supplier)
    if q:
        query = query.filter(or_(
            models.Supplier.name.ilike(f"%{q}%"),
            models.Supplier.contact_name.ilike(f"%{q}%"),
            models.Supplier.email.ilike(f"%{q}%"),
            models.Supplier.phone.ilike(f"%{q}%"),
        ))
    if category:
        query = query.filter(models.Supplier.category == category)
    return query.order_by(models.Supplier.created_at.desc()).all()


@router.post("", response_model=schemas.SupplierOut)
def create_supplier(
    data: schemas.SupplierCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = models.Supplier(**data.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/{supplier_id}", response_model=schemas.SupplierOut)
def update_supplier(
    supplier_id: int,
    data: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(supplier, field, value)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    if supplier.logo_path and os.path.exists(supplier.logo_path):
        os.remove(supplier.logo_path)
    db.delete(supplier)
    db.commit()
    return {"ok": True}


@router.post("/{supplier_id}/logo", response_model=schemas.SupplierOut)
async def upload_logo(
    supplier_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Solo se permiten imágenes (JPEG, PNG, WEBP, GIF)")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen no puede superar 5MB")

    logo_dir = os.path.join(UPLOAD_DIR, "suppliers", str(supplier_id))
    os.makedirs(logo_dir, exist_ok=True)

    # Remove old logo
    if supplier.logo_path and os.path.exists(supplier.logo_path):
        os.remove(supplier.logo_path)

    ext = os.path.splitext(file.filename or "logo.jpg")[1] or ".jpg"
    stored = os.path.join(logo_dir, f"logo{ext}")
    with open(stored, "wb") as f:
        f.write(content)

    supplier.logo_path = stored
    db.commit()
    db.refresh(supplier)
    return supplier


@router.get("/{supplier_id}/logo")
def get_logo(
    supplier_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier or not supplier.logo_path:
        raise HTTPException(status_code=404, detail="Sin logo")
    expected_dir = os.path.normpath(os.path.join(UPLOAD_DIR, "suppliers", str(supplier_id)))
    actual_path = os.path.normpath(supplier.logo_path)
    if not actual_path.startswith(expected_dir):
        raise HTTPException(status_code=403, detail="Acceso denegado")
    if not os.path.exists(actual_path):
        raise HTTPException(status_code=404, detail="Sin logo")
    return FileResponse(actual_path)


@router.delete("/{supplier_id}/logo", response_model=schemas.SupplierOut)
def delete_logo(
    supplier_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    if supplier.logo_path and os.path.exists(supplier.logo_path):
        os.remove(supplier.logo_path)
    supplier.logo_path = None
    db.commit()
    db.refresh(supplier)
    return supplier
