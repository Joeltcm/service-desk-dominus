from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import os, time, logging

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tickets.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
engine_kwargs = {"connect_args": {"check_same_thread": False}} if is_sqlite else {}

if not is_sqlite:
    # Retry loop: PostgreSQL may not be ready immediately on container start
    for attempt in range(10):
        try:
            _test_engine = create_engine(DATABASE_URL, pool_pre_ping=True)
            with _test_engine.connect() as c:
                c.execute(text("SELECT 1"))
            _test_engine.dispose()
            break
        except Exception as e:
            logging.warning("DB not ready (attempt %d/10): %s", attempt + 1, e)
            if attempt == 9:
                raise
            time.sleep(3)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
