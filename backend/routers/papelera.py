from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
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
    "despacho":   (models.Dispatch, "Pedido",     "dispatch_number"),
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
    elif entity_type == "despacho":
        obj.deleted_by_id = None
        obj.deleted_by_name = None
        # Al restaurar, re-descontar el stock si el pedido está en un estado que lo aplica.
        from routers.despacho import _sync_dispatch_inventory
        _sync_dispatch_inventory(obj, db)
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


def _purge_order_dependents(db: Session, oid: int):
    db.query(models.OrderAttachment).filter(models.OrderAttachment.order_id == oid).delete(synchronize_session=False)
    db.query(models.Dispatch).filter(models.Dispatch.order_id == oid).update({"order_id": None}, synchronize_session=False)
    db.query(models.Quote).filter(models.Quote.order_id == oid).update({"order_id": None}, synchronize_session=False)
    db.query(models.Expense).filter(models.Expense.order_id == oid).update({"order_id": None}, synchronize_session=False)


def _purge_invoice_dependents(db: Session, iid: int):
    db.query(models.InvoiceAttachment).filter(models.InvoiceAttachment.invoice_id == iid).delete(synchronize_session=False)
    db.query(models.InvoicePayment).filter(models.InvoicePayment.invoice_id == iid).delete(synchronize_session=False)
    db.query(models.InvoiceQuoteLink).filter(models.InvoiceQuoteLink.invoice_id == iid).delete(synchronize_session=False)
    db.query(models.Order).filter(models.Order.invoice_id == iid).update({"invoice_id": None}, synchronize_session=False)
    db.query(models.Warranty).filter(models.Warranty.invoice_id == iid).update({"invoice_id": None}, synchronize_session=False)
    db.query(models.Expense).filter(models.Expense.invoice_id == iid).update({"invoice_id": None}, synchronize_session=False)
    db.query(models.SupplyDelivery).filter(models.SupplyDelivery.invoice_id == iid).update({"invoice_id": None}, synchronize_session=False)


def _purge_quote_dependents(db: Session, qid: int):
    db.query(models.InvoiceQuoteLink).filter(models.InvoiceQuoteLink.quote_id == qid).delete(synchronize_session=False)
    db.query(models.Project).filter(models.Project.quote_id == qid).update({"quote_id": None}, synchronize_session=False)
    db.query(models.Order).filter(models.Order.quote_id == qid).update({"quote_id": None}, synchronize_session=False)
    db.query(models.Dispatch).filter(models.Dispatch.quote_id == qid).update({"quote_id": None}, synchronize_session=False)
    db.query(models.Invoice).filter(models.Invoice.quote_id == qid).update({"quote_id": None}, synchronize_session=False)
    db.query(models.Opportunity).filter(models.Opportunity.quote_id == qid).update({"quote_id": None}, synchronize_session=False)


def _purge_expense_dependents(db: Session, eid: int):
    db.query(models.ExpenseAttachment).filter(models.ExpenseAttachment.expense_id == eid).delete(synchronize_session=False)


def _purge_contact_dependents(db: Session, cid: int):
    db.query(models.Ticket).filter(models.Ticket.contact_id == cid).update({"contact_id": None}, synchronize_session=False)


def _purge_contract_dependents(db: Session, cid: int):
    db.query(models.Printer).filter(models.Printer.contract_id == cid).update({"contract_id": None}, synchronize_session=False)
    db.query(models.SupplyDelivery).filter(models.SupplyDelivery.contract_id == cid).update({"contract_id": None}, synchronize_session=False)


def _purge_despacho_dependents(db: Session, did: int):
    db.query(models.DispatchTimeline).filter(models.DispatchTimeline.dispatch_id == did).delete(synchronize_session=False)
    db.query(models.DispatchTask).filter(models.DispatchTask.dispatch_id == did).delete(synchronize_session=False)
    db.query(models.DispatchPart).filter(models.DispatchPart.dispatch_id == did).delete(synchronize_session=False)
    db.query(models.DispatchAttachment).filter(models.DispatchAttachment.dispatch_id == did).delete(synchronize_session=False)
    # Movimientos de inventario ligados al pedido (no son FK; se limpian por prolijidad).
    db.query(models.InventoryTransaction).filter(
        models.InventoryTransaction.source_type.in_(("dispatch", "dispatch_revert")),
        models.InventoryTransaction.source_id == did,
    ).delete(synchronize_session=False)


# entity_type → función de limpieza de dependientes (evita 500 por FK NOT NULL).
# 'empresa' no aparece: ninguna tabla referencia companies.id.
_PURGE = {
    "ticket":     _purge_ticket_dependents,
    "pedido":     _purge_order_dependents,
    "despacho":   _purge_despacho_dependents,
    "factura":    _purge_invoice_dependents,
    "cotizacion": _purge_quote_dependents,
    "gasto":      _purge_expense_dependents,
    "contacto":   _purge_contact_dependents,
    "contrato":   _purge_contract_dependents,
}


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
    purge = _PURGE.get(entity_type)
    if purge:
        purge(db, obj.id)
    try:
        db.delete(obj)
        db.commit()
    except IntegrityError:
        # Red de seguridad: si quedó algún vínculo no contemplado, no reventamos con 500.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"No se puede eliminar: '{display_name}' tiene elementos vinculados.",
        )
    return {"ok": True, "message": f"{display_name} eliminado permanentemente"}
