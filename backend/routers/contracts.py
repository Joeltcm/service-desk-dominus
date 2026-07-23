from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models, schemas
from database import get_db
from auth import require_agent_or_admin, require_supplies_or_above, require_admin
from audit_helper import log_action

router = APIRouter(prefix="/api/contracts", tags=["contracts"])


@router.get("/next-number")
def next_contract_number(db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    rows = db.query(models.Contract.contract_number).filter(models.Contract.contract_number.like("CONT-%")).all()
    nums = [int(r[0].split("-")[-1]) for r in rows if r[0] and r[0].split("-")[-1].isdigit()]
    n = (max(nums) + 1) if nums else 1
    return {"number": f"CONT-{n:04d}"}


@router.get("", response_model=list[schemas.ContractOut])
def list_contracts(
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    return (
        db.query(models.Contract)
        .filter(models.Contract.deleted_at.is_(None))
        .order_by(models.Contract.created_at.desc())
        .all()
    )


@router.get("/{contract_id}", response_model=schemas.ContractOut)
def get_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_agent_or_admin),
):
    contract = db.query(models.Contract).filter(
        models.Contract.id == contract_id,
        models.Contract.deleted_at.is_(None),
    ).first()
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    return contract


@router.post("", response_model=schemas.ContractOut, status_code=201)
def create_contract(
    data: schemas.ContractCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    contract = models.Contract(**data.model_dump())
    db.add(contract)
    db.flush()
    log_action(db, current_user, "create", "contrato", contract.id, contract.contract_number or f"#{contract.id}")
    db.commit()
    db.refresh(contract)
    return contract


@router.put("/{contract_id}", response_model=schemas.ContractOut)
def update_contract(
    contract_id: int,
    data: schemas.ContractUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    contract = db.query(models.Contract).filter(
        models.Contract.id == contract_id,
        models.Contract.deleted_at.is_(None),
    ).first()
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(contract, field, value)
    log_action(db, current_user, "update", "contrato", contract.id, contract.contract_number or f"#{contract.id}")
    db.commit()
    db.refresh(contract)
    return contract


@router.delete("/{contract_id}")
def delete_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    contract = db.query(models.Contract).filter(
        models.Contract.id == contract_id,
        models.Contract.deleted_at.is_(None),
    ).first()
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    from datetime import datetime, timezone
    contract.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "contrato", contract.id, contract.contract_number or f"#{contract.id}")
    db.commit()
    return {"ok": True}
