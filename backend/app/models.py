from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    numero_empleado = Column(String, unique=True, index=True, nullable=True)
    rol = Column(String, default="docente")
    mac_address = Column(String, nullable=True)

    asistencias = relationship("Asistencia", back_populates="usuario")

class Asistencia(Base):
    __tablename__ = "asistencias"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    fecha_hora = Column(DateTime, default=datetime.utcnow)
    ip_origen = Column(String, nullable=True)
    metodo = Column(String, default="WIFI_SSO")
    estado = Column(String, default="PRESENTE")

    usuario = relationship("Usuario", back_populates="asistencias")

class RedInstitucional(Base):
    __tablename__ = "redes_institucionales"

    id = Column(Integer, primary_key=True, index=True)
    ssid_bin = Column(String, unique=True, index=True, nullable=False)
    password_bin = Column(String, nullable=False)
    zona = Column(String, nullable=False)
    firma_red_bin = Column(String, default="")
    activa = Column(Boolean, default=True)