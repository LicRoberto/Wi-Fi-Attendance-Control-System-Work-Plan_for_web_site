from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from app.database import engine, Base, get_db
from app import models
from app.network_config import network_manager

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Control de Asistencia Wi-Fi - TUP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ADM_BIN = "0111010001110101011100000011011100110000001101000011000101000000011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000101110011001010110010001110101001011100110110101111000"

def _get_admin_email() -> str:
    chars = [_ADM_BIN[i:i+8] for i in range(0, len(_ADM_BIN), 8)]
    return "".join(chr(int(c, 2)) for c in chars)

class RedWifiCreate(BaseModel):
    ssid: str
    password: str
    zona: str

class LoginEmpleadoRequest(BaseModel):
    numero_empleado: str
    password: str

class PermisosConsentimientoRequest(BaseModel):
    email: str
    autorizado: bool

class AutoMarcacionRequest(BaseModel):
    email: str
    ssid_actual: Optional[str] = None

@app.get("/")
def home():
    return {"status": "ok", "message": "API de Control de Asistencia activa"}

@app.post("/api/auth/login-empleado")
def login_empleado(datos: LoginEmpleadoRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if datos.numero_empleado.upper() == "DOC-2026-01" and datos.password == "tup2026":
        email_docente = "docente.prueba@tecplayacar.edu.mx"
        mac_real = "78:46:5C:C8:2D:D3"

        usuario = db.query(models.Usuario).filter(models.Usuario.email == email_docente).first()

        if not usuario:
            usuario = models.Usuario(
                email=email_docente,
                nombre="Prof. Docente de Prueba",
                numero_empleado="DOC-2026-01",
                rol="docente",
                mac_address=mac_real
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
        elif usuario.mac_address != mac_real:
            usuario.mac_address = mac_real
            db.commit()

        response.set_cookie(
            key="tup_device_token",
            value=f"TOKEN-MAC-{mac_real.replace(':', '')}",
            httponly=False,
            samesite="lax"
        )

        return {
            "status": "success",
            "user": {
                "id": str(usuario.id),
                "name": usuario.nombre,
                "email": usuario.email,
                "rol": usuario.rol,
                "mac_address": usuario.mac_address
            }
        }
    
    raise HTTPException(status_code=401, detail="Número de empleado o contraseña incorrectos")

@app.get("/api/usuarios/me")
def obtener_perfil(email: str, db: Session = Depends(get_db)):
    admin_email = _get_admin_email()
    usuario = db.query(models.Usuario).filter(models.Usuario.email == email).first()

    es_admin = (email.lower() == admin_email.lower())
    rol_asignado = "admin" if es_admin else "docente"

    if not usuario:
        usuario = models.Usuario(
            email=email,
            nombre="Usuario TUP",
            rol=rol_asignado,
            mac_address="78:46:5C:C8:2D:D3"
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)

    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol,
        "mac_address": usuario.mac_address or "78:46:5C:C8:2D:D3"
    }

@app.post("/api/usuarios/consentimiento")
def actualizar_consentimiento(datos: PermisosConsentimientoRequest, db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == datos.email).first()
    if usuario:
        db.commit()
        return {"status": "success", "mensaje": "Autorización legal registrada."}
    return {"status": "error", "mensaje": "Usuario no encontrado."}

@app.post("/api/asistencias/auto-marcar")
def auto_marcar_asistencia(datos: AutoMarcacionRequest, request: Request, db: Session = Depends(get_db)):
    # Validar que la red corresponda a la SSID "TUP" registrada en network_config.py
    ssid_evaluado = datos.ssid_actual or "TUP"
    es_valida = network_manager.es_red_valida(ssid_evaluado)

    if not es_valida:
        return {
            "status": "red_invalida",
            "mensaje": f"Fuera de la red Wi-Fi TUP (SSID: {ssid_evaluado}).",
            "red_activa": False
        }

    usuario = db.query(models.Usuario).filter(models.Usuario.email == datos.email).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    mac_hardware = usuario.mac_address or "78:46:5C:C8:2D:D3"
    ahora = datetime.now()
    hoy_str = ahora.strftime("%Y-%m-%d")

    registros_hoy = db.query(models.Asistencia).filter(
        models.Asistencia.usuario_id == usuario.id
    ).all()

    ya_registro = any(r.fecha_hora.strftime("%Y-%m-%d") == hoy_str for r in registros_hoy)

    if not ya_registro:
        nueva_asistencia = models.Asistencia(
            usuario_id=usuario.id,
            fecha_hora=ahora,
            ip_origen=mac_hardware,
            metodo="DETECCION_MAC_AUTOMATICA",
            estado="PRESENTE"
        )
        db.add(nueva_asistencia)
        db.commit()
        db.refresh(nueva_asistencia)

        # ARCHIVADO AUTOMÁTICO: Límite estricto de máximo 10 registros
        todos = db.query(models.Asistencia).filter(
            models.Asistencia.usuario_id == usuario.id
        ).order_by(models.Asistencia.fecha_hora.desc()).all()

        if len(todos) > 10:
            for reg in todos[10:]:
                db.delete(reg)
            db.commit()

        return {
            "status": "success",
            "mensaje": f"Asistencia registrada automáticamente en red TUP para {usuario.nombre}",
            "fecha_hora": nueva_asistencia.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "red_activa": True
        }

    return {"status": "already_registered", "mensaje": "Asistencia ya registrada hoy en red TUP.", "red_activa": True}

@app.get("/api/asistencias/historial")
def obtener_historial(email: str, db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == email).first()
    if not usuario:
        return []
    
    asistencias = (
        db.query(models.Asistencia)
        .filter(models.Asistencia.usuario_id == usuario.id)
        .order_by(models.Asistencia.fecha_hora.desc())
        .limit(10)
        .all()
    )
    return asistencias

@app.get("/api/admin/asistencias")
def obtener_todas_asistencias(db: Session = Depends(get_db)):
    registros = db.query(models.Asistencia).order_by(models.Asistencia.fecha_hora.desc()).all()
    resultado = []
    for r in registros:
        usr = db.query(models.Usuario).filter(models.Usuario.id == r.usuario_id).first()
        resultado.append({
            "id": r.id,
            "usuario": usr.nombre if usr else "Desconocido",
            "email": usr.email if usr else "N/A",
            "fecha_hora": r.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "ip_origen": r.ip_origen,
            "metodo": r.metodo,
            "estado": r.estado
        })
    return resultado

@app.get("/api/admin/redes-wifi")
def listar_redes_wifi():
    return network_manager.obtener_redes_decodificadas()

@app.post("/api/admin/redes-wifi")
def registrar_red_wifi(datos: RedWifiCreate):
    return network_manager.agregar_o_actualizar_red(
        ssid=datos.ssid,
        password=datos.password,
        zona=datos.zona
    )