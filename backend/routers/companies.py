from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, timezone
from database import get_db
from auth import get_current_user, require_agent_or_admin
from audit_helper import log_action
import models, schemas

router = APIRouter(prefix="/api/companies", tags=["companies"])


@router.get("", response_model=List[schemas.CompanyOut])
def list_companies(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(models.Company).filter(models.Company.deleted_at.is_(None))
    if q:
        query = query.filter(models.Company.name.ilike(f"%{q}%"))
    return query.order_by(models.Company.created_at.desc()).all()


@router.post("", response_model=schemas.CompanyOut, status_code=201)
def create_company(
    data: schemas.CompanyCreate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    existing = db.query(models.Company).filter(models.Company.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe una empresa con ese nombre")
    company = models.Company(**data.model_dump())
    db.add(company)
    db.commit()
    db.refresh(company)
    # Clients aren't linked to companies by FK, only by matching User.company name,
    # so a category set here must be pushed onto every user with that company string.
    if company.client_category_id:
        db.query(models.User).filter(
            models.User.company == company.name,
            models.User.role == models.UserRole.client,
        ).update({"client_category_id": company.client_category_id})
        db.commit()
    return company


@router.put("/{company_id}", response_model=schemas.CompanyOut)
def update_company(
    company_id: int,
    data: schemas.CompanyUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)
    if 'client_category_id' in data.model_fields_set:
        db.query(models.User).filter(
            models.User.company == company.name,
            models.User.role == models.UserRole.client,
        ).update({"client_category_id": company.client_category_id})
        db.commit()
    return company


@router.delete("/{company_id}")
def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    company = db.query(models.Company).filter(
        models.Company.id == company_id,
        models.Company.deleted_at.is_(None),
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    company.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "empresa", company.id, company.name or f"#{company.id}")
    db.commit()
    return {"ok": True}
