from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timezone
from database import get_db
from auth import require_agent_or_admin, get_current_user
from audit_helper import log_action
import models

router = APIRouter(prefix="/api/papelera", tags=["papelera"])

# entity_type → (model_class, display_name, name_field)
ENTITIES = {
    "ticket":     (models.Ticket,  "Ticket",      "title"),
    "factura":    (models.Invoice, "Factura",     "invoice_number"),
    "cotizacion": (models.Quote,   "Cotización",  "title"),
    "gasto":      (models.Expense, "Gasto",       "concept"),
    "contacto":   (models.Contact, "Contacto",    "name"),
    "empresa":    (models.Company, "Empresa",     "name"),
    "pedido":     (models.Order,   "Pedido",      "title"),
    "contrato":   (models.Contract, "Contrato",   "contract_number"),
}


def _entity_name(obj, name_field: str) -> str:
    val = getattr(obj, name_field, None)
    return str(val) if val else f"#{obj.id}"


@router.get("")
def list_deleted(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    results = []
    for entity_type, (model_cls, display_name, name_field) in ENTITIES.items():
        rows = (
            db.query(model_cls)
            .filter(model_cls.deleted_at.isnot(None))
            .order_by(model_cls.deleted_at.desc())
            .all()
        )
        for row in rows:
            results.append({
                "entity_type":   entity_type,
                "display_name":  display_name,
                "id":            row.id,
                "name":          _entity_name(row, name_field),
                "deleted_at":    row.deleted_at.isoformat() if row.deleted_at else None,
            })

    results.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
    return results


@router.post("/{entity_type}/{item_id}/restore")
def restore_item(
    entity_type: str,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if entity_type not in ENTITIES:
        raise HTTPException(status_code=404, detail="Tipo de entidad no válido")
    model_cls, display_name, name_field = ENTITIES[entity_type]

    obj = db.query(model_cls).filter(
        model_cls.id == item_id,
        model_cls.deleted_at.isnot(None),
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Elemento no encontrado en la papelera")

    obj.deleted_at = None
    if entity_type == "ticket":
        from routers.tickets import _resume_sla_from_trash
        _resume_sla_from_trash(obj, db)
    log_action(db, current_user, "restore", entity_type, obj.id, _entity_name(obj, name_field))
    db.commit()
    return {"ok": True, "message": f"{display_name} restaurado"}


def _purge_ticket_dependents(db: Session, ticket_id: int):
    """Elimina/desvincula todo lo que referencia al ticket antes de borrarlo de forma
    permanente, evitando violaciones de llave foránea (FK NOT NULL)."""
    # Hijos que se eliminan junto con el ticket.
    db.query(models.TicketTimeline).filter(models.TicketTimeline.ticket_id == ticket_id).delete(synchronize_session=False)
    db.query(models.TicketAttachment).filter(models.TicketAttachment.ticket_id == ticket_id).delete(synchronize_session=False)
    db.query(models.TicketVisit).filter(models.TicketVisit.ticket_id == ticket_id).delete(synchronize_session=False)
    db.query(models.PartRequest).filter(models.PartRequest.ticket_id == ticket_id).delete(synchronize_session=False)
    # Documentos independientes: solo se desvinculan (no se borran).
    db.query(models.Order).filter(models.Order.ticket_id == ticket_id).update({"ticket_id": None}, synchronize_session=False)
    db.query(models.Quote).filter(models.Quote.ticket_id == ticket_id).update({"ticket_id": None}, synchronize_session=False)
    db.query(models.Invoice).filter(models.Invoice.ticket_id == ticket_id).update({"ticket_id": None}, synchronize_session=False)
    # Sub-tickets: se desvinculan del padre.
    db.query(models.Ticket).filter(models.Ticket.parent_id == ticket_id).update({"parent_id": None}, synchronize_session=False)


@router.delete("/{entity_type}/{item_id}")
def permanent_delete(
    entity_type: str,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if entity_type not in ENTITIES:
        raise HTTPException(status_code=404, detail="Tipo de entidad no válido")
    model_cls, display_name, name_field = ENTITIES[entity_type]

    obj = db.query(model_cls).filter(
        model_cls.id == item_id,
        model_cls.deleted_at.isnot(None),
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Elemento no encontrado en la papelera")

    name = _entity_name(obj, name_field)
    log_action(db, current_user, "permanent_delete", entity_type, obj.id, name)
    if entity_type == "ticket":
        _purge_ticket_dependents(db, obj.id)
    db.delete(obj)
    db.commit()
    return {"ok": True, "message": f"{display_name} eliminado permanentemente"}
