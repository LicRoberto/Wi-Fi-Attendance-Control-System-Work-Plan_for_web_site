import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

try:  # SQLAlchemy 1.4+/2.x
    from sqlalchemy.orm import declarative_base
except ImportError:  # pragma: no cover
    from sqlalchemy.ext.declarative import declarative_base


def _url_de_base_de_datos() -> str:
    """
    Prioridad:
      1) DATABASE_URL  -> base externa y PERSISTENTE (PostgreSQL: Neon, Supabase, Render Postgres...).
      2) SQLITE_PATH   -> archivo SQLite en una ruta propia (por ejemplo un disco persistente montado).
      3) ./asistencias.db (SQLite local). En Render gratis el sistema de archivos es TEMPORAL: se borra
         al reiniciar, redesplegar o cuando el servicio se duerme. Sirve para desarrollo, no para producción.
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        # Los proveedores suelen entregar "postgres://" o "postgresql://"; SQLAlchemy necesita el driver.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg2://" + url[len("postgresql://"):]
        return url
    ruta = os.getenv("SQLITE_PATH", "").strip() or "./asistencias.db"
    return f"sqlite:///{ruta}"


SQLALCHEMY_DATABASE_URL = _url_de_base_de_datos()
_ES_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")

if _ES_SQLITE:
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # pool_pre_ping y pool_recycle: los servicios gratuitos suspenden las conexiones inactivas;
    # esto evita errores de "conexión cerrada" en la primera petición después de un rato.
    engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, pool_recycle=300)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
