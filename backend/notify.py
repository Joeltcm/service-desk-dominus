"""Notificaciones de la app: crea el registro in-app y (best-effort) manda push."""
import os
import models


def create_notification(db, user_id, title, body="", url="/", kind=None, push=True):
    n = models.Notification(user_id=user_id, title=title, body=(body or None), url=url, kind=kind, read=False)
    db.add(n)
    db.flush()
    if push:
        try:
            from push_helper import notify_user
            notify_user(db, user_id, title, body or title, url)
        except Exception:
            pass
    return n


def notify_users(db, user_ids, title, body="", url="/", kind=None, exclude_user_id=None):
    for uid in set(user_ids):
        if exclude_user_id and uid == exclude_user_id:
            continue
        create_notification(db, uid, title, body, url, kind)


def notify_roles(db, roles, title, body="", url="/", kind=None, exclude_user_id=None):
    users = (
        db.query(models.User.id)
        .filter(models.User.role.in_(roles), models.User.is_active == True)
        .all()
    )
    notify_users(db, [u[0] for u in users], title, body, url, kind, exclude_user_id=exclude_user_id)


def notify_admins(db, title, body="", url="/", kind=None, exclude_user_id=None, include_agents=False):
    """Aviso (campana + push) a superadmin/admin/supervisor. Solo en it_support.
    include_agents=True suma también a los agentes (usado en tickets nuevos).
    No hace commit: el llamador debe confirmar."""
    if os.getenv("PRODUCT_VERTICAL", "mps") != "it_support":
        return
    roles = [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.supervisor]
    if include_agents:
        roles.append(models.UserRole.agent)
    notify_roles(db, roles, title, body, url, kind, exclude_user_id=exclude_user_id)
