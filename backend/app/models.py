from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, Text, ForeignKey
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
    # Hash scrypt de la contraseña (solo para login por número de empleado). Nunca texto plano.
    password_hash = Column(String, nullable=True)

    # Foto de perfil como data URL (JPEG/PNG/WebP, ya redimensionada por el navegador, máx. ~300 KB).
    foto = Column(Text, nullable=True)

    # Última presencia conocida. Se SOBRESCRIBE en cada verificación: no hay historial de ubicación.
    # Las coordenadas solo se guardan mientras la red del campus fue verificada por IP.
    ultima_conexion = Column(DateTime, nullable=True)
    ultima_valida = Column(Boolean, nullable=True)
    ultima_lat = Column(Float, nullable=True)
    ultima_lon = Column(Float, nullable=True)
    ultima_precision = Column(Float, nullable=True)
    ultima_distancia = Column(Float, nullable=True)

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
