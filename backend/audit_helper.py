"""
Utility for writing audit log entries.
Usage:
    from audit_helper import log_action
    log_action(db, user, "delete", "ticket", ticket.id, ticket.title)
"""
import json
from typing import Optional
from sqlalchemy.orm import Session
import models


def log_action(
    db: Session,
    user,                   # models.User or None
    action: str,            # create | update | delete | restore | login
    entity_type: str,       # ticket | factura | cotizacion | gasto | contacto | empresa | pedido | usuario
    entity_id: Optional[int] = None,
    entity_name: Optional[str] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
):
    entry = models.AuditLog(
        user_id=user.id if user else None,
        user_name=user.name if user else "Sistema",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        details=json.dumps(details, ensure_ascii=False) if details else None,
        ip_address=ip_address,
    )
    db.add(entry)
    # caller is responsible for db.commit()
