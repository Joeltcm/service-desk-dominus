from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import get_db
import models
import os
import bcrypt as _bcrypt_lib

SECRET_KEY = os.getenv("SECRET_KEY", "fallback-secret-key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _bcrypt_lib.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return _bcrypt_lib.hashpw(password.encode("utf-8"), _bcrypt_lib.gensalt()).decode("utf-8")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def require_superadmin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role != models.UserRole.superadmin:
        raise HTTPException(status_code=403, detail="Se requiere rol de superadministrador")
    return current_user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role not in [models.UserRole.superadmin, models.UserRole.admin]:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")
    return current_user


def require_agent_or_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role not in [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.supervisor, models.UserRole.agent]:
        raise HTTPException(status_code=403, detail="Se requiere rol de agente o administrador")
    return current_user


def require_admin_or_ventas(current_user: models.User = Depends(get_current_user)) -> models.User:
    if current_user.role not in [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.ventas]:
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador o ventas")
    return current_user


def require_supplies_or_above(current_user: models.User = Depends(get_current_user)) -> models.User:
    """admin + agent + supplies — for suministros, inventario and printer reads."""
    if current_user.role not in [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.agent, models.UserRole.supplies]:
        raise HTTPException(status_code=403, detail="Se requiere rol de suministros, agente o administrador")
    return current_user


def require_admin_or_supplies(current_user: models.User = Depends(get_current_user)) -> models.User:
    """admin/superadmin + supplies (Responsable de Inventario) — para aprobar despachos de partes."""
    if current_user.role not in [models.UserRole.superadmin, models.UserRole.admin, models.UserRole.supplies]:
        raise HTTPException(status_code=403, detail="Se requiere administrador o responsable de inventario")
    return current_user


def require_staff(current_user: models.User = Depends(get_current_user)) -> models.User:
    """admin + agent + ventas + superadmin — everyone except clients."""
    if current_user.role == models.UserRole.client:
        raise HTTPException(status_code=403, detail="Acceso no permitido")
    return current_user
