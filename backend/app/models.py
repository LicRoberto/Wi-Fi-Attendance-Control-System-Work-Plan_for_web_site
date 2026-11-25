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
    password_hash = Column(String, nullable=True)
    password_visible = Column(String, nullable=True)

    foto = Column(Text, nullable=True)

    ultima_conexion = Column(DateTime, nullable=True)
    ultima_valida = Column(Boolean, nullable=True)
    ultima_lat = Column(Float, nullable=True)
    ultima_lon = Column(Float, nullable=True)
    ultima_precision = Column(Float, nullable=True)
    ultima_distancia = Column(Float, nullable=True)

    asistencias = relationship("Asistencia", back_populates="usuario")
    incidencias = relationship("Incidencia", back_populates="usuario")
    clases = relationship("ClaseAsignada", back_populates="usuario")


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


class Incidencia(Base):
    __tablename__ = "incidencias"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    motivo = Column(String, nullable=False)
    fecha_evento = Column(String, nullable=True)
    descripcion = Column(Text, nullable=False)
    observaciones = Column(Text, nullable=True)
    urgente = Column(Boolean, default=False)
    leida = Column(Boolean, default=False)
    estado = Column(String, default="PENDIENTE")  # PENDIENTE | RESPONDIDA | RESUELTA
    respuesta_admin = Column(Text, nullable=True)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)
    fecha_respuesta = Column(DateTime, nullable=True)

    usuario = relationship("Usuario", back_populates="incidencias")


class ClaseAsignada(Base):
    __tablename__ = "clases_asignadas"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    materia = Column(String, nullable=False)
    aula = Column(String, nullable=False)
    dia_semana = Column(String, default="Lunes")  # Lunes, Martes, Miércoles, Jueves, Viernes, Sábado
    horario = Column(String, nullable=False)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)

    usuario = relationship("Usuario", back_populates="clases")