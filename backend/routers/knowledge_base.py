from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timezone
from database import get_db
import models, schemas
from auth import get_current_user, require_agent_or_admin
from audit_helper import log_action

router = APIRouter(prefix="/api/kb", tags=["knowledge_base"])


# ── Categories ────────────────────────────────────────
@router.get("/categories", response_model=List[schemas.KBCategoryOut])
def list_categories(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(models.KBCategory).filter(
        models.KBCategory.is_active == True
    ).order_by(models.KBCategory.order).all()


@router.post("/categories", response_model=schemas.KBCategoryOut)
def create_category(data: schemas.KBCategoryCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = models.KBCategory(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/categories/{cat_id}", response_model=schemas.KBCategoryOut)
def update_category(cat_id: int, data: schemas.KBCategoryCreate, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = db.query(models.KBCategory).filter(models.KBCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    for k, v in data.model_dump().items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db), _=Depends(require_agent_or_admin)):
    cat = db.query(models.KBCategory).filter(models.KBCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    cat.is_active = False
    db.commit()
    return {"ok": True}


def _audience_allowed(article: models.KBArticle, user: models.User) -> bool:
    """Return True if the user's role can see this article's audience."""
    role = user.role
    audience = getattr(article, 'audience', 'all') or 'all'
    if audience == 'all':
        return True
    # superadmin y admin ven todo (audiencia 'agents' o 'admin').
    if role in (models.UserRole.superadmin, models.UserRole.admin):
        return True
    if audience == 'agents':
        return role in (models.UserRole.supervisor, models.UserRole.agent, models.UserRole.ventas, models.UserRole.supplies)
    # audience == 'admin' → solo admin/superadmin (ya cubiertos arriba)
    return False


def _audience_filter(q, user: models.User):
    """Apply audience visibility filter to a KBArticle query."""
    role = user.role
    if role == models.UserRole.client:
        q = q.filter(models.KBArticle.audience == 'all')
    elif role in (models.UserRole.agent, models.UserRole.supervisor, models.UserRole.ventas, models.UserRole.supplies):
        q = q.filter(models.KBArticle.audience.in_(['all', 'agents']))
    # superadmin y admin ven todo
    return q


# ── Articles ──────────────────────────────────────────
@router.get("/articles", response_model=List[schemas.KBArticleOut])
def list_articles(
    category_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    published_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.KBArticle).filter(models.KBArticle.deleted_at.is_(None))
    if published_only or current_user.role == models.UserRole.client:
        q = q.filter(models.KBArticle.is_published == True)
    q = _audience_filter(q, current_user)
    if category_id:
        q = q.filter(models.KBArticle.category_id == category_id)
    if search:
        q = q.filter(or_(
            models.KBArticle.title.ilike(f"%{search}%"),
            models.KBArticle.content.ilike(f"%{search}%"),
            models.KBArticle.tags.ilike(f"%{search}%"),
        ))
    return q.order_by(models.KBArticle.created_at.desc()).all()


@router.post("/articles", response_model=schemas.KBArticleOut)
def create_article(
    data: schemas.KBArticleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    if data.audience == 'admin' and current_user.role != models.UserRole.admin:
        raise HTTPException(status_code=403, detail="Solo los administradores pueden crear artículos exclusivos para administradores")
    article = models.KBArticle(**data.model_dump(), created_by_id=current_user.id)
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


@router.get("/articles/{article_id}", response_model=schemas.KBArticleOut)
def get_article(article_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    article = db.query(models.KBArticle).filter(models.KBArticle.id == article_id, models.KBArticle.deleted_at.is_(None)).first()
    if not article:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    if not _audience_allowed(article, current_user):
        raise HTTPException(status_code=403, detail="No tienes acceso a este artículo")
    article.views += 1
    db.commit()
    db.refresh(article)
    return article


@router.put("/articles/{article_id}", response_model=schemas.KBArticleOut)
def update_article(
    article_id: int,
    data: schemas.KBArticleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_agent_or_admin),
):
    article = db.query(models.KBArticle).filter(models.KBArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    if data.audience == 'admin' and current_user.role != models.UserRole.admin:
        raise HTTPException(status_code=403, detail="Solo los administradores pueden asignar audiencia exclusiva de administradores")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(article, k, v)
    db.commit()
    db.refresh(article)
    return article


@router.delete("/articles/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(require_agent_or_admin)):
    article = db.query(models.KBArticle).filter(models.KBArticle.id == article_id, models.KBArticle.deleted_at.is_(None)).first()
    if not article:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    article.deleted_at = datetime.now(timezone.utc)
    log_action(db, current_user, "delete", "articulo_kb", article.id, article.title)
    db.commit()
    return {"ok": True}
