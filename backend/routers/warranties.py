from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
import models, schemas
from database import get_db
from auth import require_agent_or_admin, get_current_user

router = APIRouter(prefix="/api/warranties", tags=["warranties"])


@router.get("/next-number")
def next_warranty_number(db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    rows = db.query(models.Warranty.cert_number).filter(models.Warranty.cert_number.like("GRT-%")).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    n = (max(nums) + 1) if nums else 1
    return {"number": f"GRT-{n:04d}"}


@router.get("/my", response_model=list[schemas.WarrantyOut])
def list_my_warranties(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Garantías del cliente autenticado, vinculadas a una factura."""
    conditions = []
    if current_user.email:
        conditions.append(
            models.Warranty.invoice_id.in_(
                db.query(models.Invoice.id).filter(
                    func.lower(models.Invoice.client_email) == current_user.email.lower()
                )
            )
        )
    conditions.append(func.lower(models.Warranty.client_name) == current_user.name.lower())
    if current_user.company:
        conditions.append(func.lower(models.Warranty.client_name) == current_user.company.lower())
    return (
        db.query(models.Warranty)
        .filter(or_(*conditions))
        .order_by(models.Warranty.created_at.desc())
        .all()
    )


@router.get("", response_model=list[schemas.WarrantyOut])
def list_warranties(
    invoice_id: int = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    q = db.query(models.Warranty)
    if invoice_id:
        q = q.filter(models.Warranty.invoice_id == invoice_id)
    return q.order_by(models.Warranty.created_at.desc()).all()


@router.get("/{wid}", response_model=schemas.WarrantyOut)
def get_warranty(
    wid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    w = db.query(models.Warranty).filter(models.Warranty.id == wid).first()
    if not w:
        raise HTTPException(status_code=404, detail="Certificado no encontrado")
    return w


@router.post("", response_model=schemas.WarrantyOut, status_code=201)
def create_warranty(
    data: schemas.WarrantyCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    existing = (
        db.query(models.Warranty)
        .filter(models.Warranty.cert_number == data.cert_number)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un certificado con ese número")
    invoice_ref = (data.invoice_ref or "").strip() or None
    # Se acepta una factura interna (invoice_id, con validación) O un número de factura
    # externo como texto libre (invoice_ref, cuando la factura viene de otro sistema).
    if not data.invoice_id and not invoice_ref:
        raise HTTPException(status_code=400, detail="Se requiere una factura vinculada (interna o número de factura externo)")
    if data.invoice_id:
        invoice = db.query(models.Invoice).filter(
            models.Invoice.id == data.invoice_id,
            models.Invoice.deleted_at.is_(None),
        ).first()
        if not invoice:
            raise HTTPException(status_code=404, detail="Factura no encontrada")
        if invoice.status != "Pagada":
            raise HTTPException(
                status_code=400,
                detail=f"La garantía solo aplica a facturas pagadas (estado actual: '{invoice.status}')"
            )
        existing_for_invoice = db.query(models.Warranty).filter(
            models.Warranty.invoice_id == data.invoice_id,
        ).first()
        if existing_for_invoice:
            raise HTTPException(
                status_code=400,
                detail=f"Ya existe la garantía {existing_for_invoice.cert_number} para esta factura"
            )

    w = models.Warranty(
        cert_number=data.cert_number,
        client_name=data.client_name or None,
        client_company=data.client_company or None,
        client_ruc=data.client_ruc or None,
        issue_date=data.issue_date or None,
        warranty_period=data.warranty_period or None,
        warranty_end=data.warranty_end or None,
        technician=data.technician or None,
        notes=data.notes or None,
        invoice_id=data.invoice_id,
        invoice_ref=invoice_ref,
        dispatch_id=data.dispatch_id,
        created_by_id=current_user.id,
    )
    db.add(w)
    db.flush()

    for i, item in enumerate(data.items):
        db.add(models.WarrantyItem(
            warranty_id=w.id,
            type=item.type or None,
            description=item.description or None,
            brand=item.brand or None,
            model=item.model or None,
            serial=item.serial or None,
            sort_order=i,
        ))

    db.commit()
    db.refresh(w)
    return w


@router.put("/{wid}", response_model=schemas.WarrantyOut)
def update_warranty(
    wid: int,
    data: schemas.WarrantyUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    w = db.query(models.Warranty).filter(models.Warranty.id == wid).first()
    if not w:
        raise HTTPException(status_code=404, detail="Certificado no encontrado")

    conflict = (
        db.query(models.Warranty)
        .filter(
            models.Warranty.cert_number == data.cert_number,
            models.Warranty.id != wid,
        )
        .first()
    )
    if conflict:
        raise HTTPException(status_code=400, detail="Ya existe un certificado con ese número")

    invoice_ref = (data.invoice_ref or "").strip() or None
    if not data.invoice_id and not invoice_ref:
        raise HTTPException(status_code=400, detail="Se requiere una factura vinculada (interna o número de factura externo)")
    w.cert_number = data.cert_number
    w.client_name = data.client_name or None
    w.client_company = data.client_company or None
    w.client_ruc = data.client_ruc or None
    w.issue_date = data.issue_date or None
    w.warranty_period = data.warranty_period or None
    w.warranty_end = data.warranty_end or None
    w.technician = data.technician or None
    w.notes = data.notes or None
    w.invoice_id = data.invoice_id
    w.invoice_ref = invoice_ref
    if data.dispatch_id is not None:
        w.dispatch_id = data.dispatch_id

    db.query(models.WarrantyItem).filter(models.WarrantyItem.warranty_id == wid).delete()
    for i, item in enumerate(data.items):
        db.add(models.WarrantyItem(
            warranty_id=wid,
            type=item.type or None,
            description=item.description or None,
            brand=item.brand or None,
            model=item.model or None,
            serial=item.serial or None,
            sort_order=i,
        ))

    db.commit()
    db.refresh(w)
    return w


@router.delete("/{wid}", status_code=204)
def delete_warranty(
    wid: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    w = db.query(models.Warranty).filter(models.Warranty.id == wid).first()
    if not w:
        raise HTTPException(status_code=404, detail="Certificado no encontrado")
    db.delete(w)
    db.commit()
