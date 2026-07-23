from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import models, schemas
from database import get_db
from auth import get_current_user, require_agent_or_admin

router = APIRouter(prefix="/api/canned-responses", tags=["canned-responses"])


@router.get("", response_model=List[schemas.CannedResponseOut])
def list_canned(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    q = db.query(models.CannedResponse).filter(models.CannedResponse.is_active == True)
    if search:
        q = q.filter(
            models.CannedResponse.title.ilike(f"%{search}%") |
            models.CannedResponse.content.ilike(f"%{search}%")
        )
    if category:
        q = q.filter(models.CannedResponse.category == category)
    return q.order_by(models.CannedResponse.category, models.CannedResponse.title).all()


@router.post("", response_model=schemas.CannedResponseOut)
def create_canned(
    data: schemas.CannedResponseCreate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    obj = models.CannedResponse(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{canned_id}", response_model=schemas.CannedResponseOut)
def update_canned(
    canned_id: int,
    data: schemas.CannedResponseUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    obj = db.query(models.CannedResponse).filter(models.CannedResponse.id == canned_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="No encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{canned_id}")
def delete_canned(
    canned_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    obj = db.query(models.CannedResponse).filter(models.CannedResponse.id == canned_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="No encontrado")
    db.delete(obj)
    db.commit()
    return {"ok": True}
