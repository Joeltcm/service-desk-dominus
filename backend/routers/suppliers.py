from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
import os, uuid
from database import get_db
from auth import get_current_user, require_admin, require_admin_or_ventas, require_staff
import models, schemas, storage

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
    _=Depends(require_staff),  # todo el personal (incluye roles de inventario) puede dar de alta proveedores; editar/eliminar sigue restringido a admin/ventas
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
    if supplier.logo_path:
        storage.delete_file(supplier.logo_path)
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

    # Remove old logo
    if supplier.logo_path:
        storage.delete_file(supplier.logo_path)

    ext = os.path.splitext(file.filename or "logo.jpg")[1] or ".jpg"
    storage_key = f"suppliers/{supplier_id}/logo{ext}"
    storage.save_file(storage_key, content, file.content_type)

    supplier.logo_path = storage_key
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
    import mimetypes
    if not supplier.logo_path.startswith(f"suppliers/{supplier_id}/"):
        raise HTTPException(status_code=403, detail="Acceso denegado")
    if not storage.file_exists(supplier.logo_path):
        raise HTTPException(status_code=404, detail="Sin logo")
    return Response(content=storage.read_file(supplier.logo_path),
                    media_type=mimetypes.guess_type(supplier.logo_path)[0] or "image/jpeg")


@router.delete("/{supplier_id}/logo", response_model=schemas.SupplierOut)
def delete_logo(
    supplier_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_ventas),
):
    supplier = db.query(models.Supplier).filter(models.Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    if supplier.logo_path:
        storage.delete_file(supplier.logo_path)
    supplier.logo_path = None
    db.commit()
    db.refresh(supplier)
    return supplier
