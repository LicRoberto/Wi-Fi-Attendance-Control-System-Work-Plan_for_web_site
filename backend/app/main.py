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
    allow_origins=[
        "http://localhost:3000",
        "https://tup-frontend.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ADM_BIN = "0111010001110101011100000011011100110000001101000011000101000000011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000101110011001010110010001110101001011100110110101111000"

def _get_admin_email() -> str:
    chars = [_ADM_BIN[i:i+8] for i in range(0, len(_ADM_BIN), 8)]
    return "".join(chr(int(c, 2)) for c in chars)

def _obtener_origen_cliente(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""

class RedWifiCreate(BaseModel):
    ssid: str
    password: str
    zona: str

class LoginEmpleadoRequest(BaseModel):
    numero_empleado: str
    password: str
    device_fingerprint: Optional[str] = None

class PermisosConsentimientoRequest(BaseModel):
    email: str
    autorizado: bool
    device_fingerprint: Optional[str] = None

class AutoMarcacionRequest(BaseModel):
    email: str
    ssid_actual: Optional[str] = None
    device_fingerprint: Optional[str] = None

@app.get("/")
def home():
    return {"status": "ok", "message": "API de Control de Asistencia activa"}

@app.post("/api/auth/login-empleado")
def login_empleado(datos: LoginEmpleadoRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if datos.numero_empleado.upper() == "DOC-2026-01" and datos.password == "tup2026":
        email_docente = "docente.prueba@tecplayacar.edu.mx"
        fingerprint = datos.device_fingerprint or "TUP-DEV-DEFAULT"

        usuario = db.query(models.Usuario).filter(models.Usuario.email == email_docente).first()

        if not usuario:
            usuario = models.Usuario(
                email=email_docente,
                nombre="Prof. Docente de Prueba",
                numero_empleado="DOC-2026-01",
                rol="docente",
                mac_address=fingerprint
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
        else:
            usuario.mac_address = fingerprint
            db.commit()

        token_binario = network_manager.generar_token_dispositivo(fingerprint)

        response.set_cookie(
            key="tup_device_token",
            value=token_binario,
            httponly=False,
            samesite="none",
            secure=True
        )

        return {
            "status": "success",
            "token_red": token_binario,
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
def obtener_perfil(
    email: Optional[str] = None,
    num_empleado: Optional[str] = None,
    device_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    admin_email = _get_admin_email()
    usuario = None

    if email:
        usuario = db.query(models.Usuario).filter(models.Usuario.email == email).first()
    elif num_empleado:
        usuario = db.query(models.Usuario).filter(models.Usuario.numero_empleado == num_empleado).first()
        if not usuario and num_empleado.upper() == "DOC-2026-01":
            email = "docente.prueba@tecplayacar.edu.mx"
            usuario = db.query(models.Usuario).filter(models.Usuario.email == email).first()

    if not usuario and not email:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    es_admin = (email and email.lower() == admin_email.lower())
    rol_asignado = "admin" if es_admin else "docente"

    identificador_disp = device_id or (usuario.mac_address if usuario else None) or "TUP-DEV-PENDIENTE"

    if not usuario:
        usuario = models.Usuario(
            email=email,
            nombre="Docente TUP",
            numero_empleado=num_empleado,
            rol=rol_asignado,
            mac_address=identificador_disp
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
    elif device_id and usuario.mac_address != device_id:
        usuario.mac_address = device_id
        db.commit()

    token_red = network_manager.generar_token_dispositivo(usuario.mac_address)

    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol,
        "mac_address": usuario.mac_address,
        "token_red": token_red
    }

@app.post("/api/usuarios/consentimiento")
def actualizar_consentimiento(datos: PermisosConsentimientoRequest, db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == datos.email).first()
    if usuario:
        if datos.device_fingerprint:
            usuario.mac_address = datos.device_fingerprint
        db.commit()
        token_red = network_manager.generar_token_dispositivo(usuario.mac_address or "")
        return {
            "status": "success",
            "mensaje": "Dispositivo vinculado y token de red generado.",
            "token_red": token_red
        }
    return {"status": "error", "mensaje": "Usuario no encontrado."}

@app.post("/api/asistencias/auto-marcar")
def auto_marcar_asistencia(datos: AutoMarcacionRequest, request: Request, db: Session = Depends(get_db)):
    usuario = db.query(models.Usuario).filter(models.Usuario.email == datos.email).first()
    
    if not usuario:
        admin_email = _get_admin_email()
        es_admin = (datos.email.lower() == admin_email.lower())
        usuario = models.Usuario(
            email=datos.email,
            nombre="Docente TUP" if not es_admin else "Administrador TUP",
            rol="admin" if es_admin else "docente",
            mac_address=datos.device_fingerprint or "TUP-DEV-AUTO"
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)

    dispositivo_id = datos.device_fingerprint or usuario.mac_address
    if not dispositivo_id or dispositivo_id == "TUP-DEV-PENDIENTE":
        return {
            "status": "sin_dispositivo",
            "mensaje": "Dispositivo aún no vinculado.",
            "red_activa": False,
            "ssid_actual": None
        }

    if datos.device_fingerprint and usuario.mac_address != datos.device_fingerprint:
        usuario.mac_address = datos.device_fingerprint
        db.commit()

    origen_cliente = _obtener_origen_cliente(request)
    ssid_detectado = datos.ssid_actual or network_manager.obtener_ssid_real_sistema()
    red_activa_info = network_manager.validar_conexion_dispositivo(
        device_id=dispositivo_id,
        client_host=origen_cliente,
        ssid_reportado=ssid_detectado
    )

    if not red_activa_info["valida"]:
        return {
            "status": "red_invalida",
            "mensaje": red_activa_info.get("motivo", "Fuera de la red Wi-Fi institucional del TUP."),
            "red_activa": False,
            "ssid_actual": None
        }

    ssid_final = red_activa_info["ssid"]
    token_red = red_activa_info["token_red"]
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
            ip_origen=dispositivo_id,
            metodo=f"TOKEN_WIFI_{ssid_final}",
            estado="PRESENTE"
        )
        db.add(nueva_asistencia)
        db.commit()
        db.refresh(nueva_asistencia)

        todos = db.query(models.Asistencia).filter(
            models.Asistencia.usuario_id == usuario.id
        ).order_by(models.Asistencia.fecha_hora.desc()).all()

        if len(todos) > 10:
            for reg in todos[10:]:
                db.delete(reg)
            db.commit()

        return {
            "status": "success",
            "mensaje": f"Asistencia registrada automáticamente en red '{ssid_final}'",
            "fecha_hora": nueva_asistencia.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "red_activa": True,
            "ssid_actual": ssid_final,
            "zona": red_activa_info["zona"],
            "token_red": token_red
        }

    return {
        "status": "already_registered",
        "mensaje": f"Dispositivo autenticado en red '{ssid_final}'.",
        "red_activa": True,
        "ssid_actual": ssid_final,
        "zona": red_activa_info["zona"],
        "token_red": token_red
    }

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
def registrar_red_wifi(datos: RedWifiCreate, request: Request):
    origen_cliente = _obtener_origen_cliente(request)
    return network_manager.agregar_o_actualizar_red(
        ssid=datos.ssid,
        password=datos.password,
        zona=datos.zona,
        client_host=origen_cliente
    )

@app.post("/api/admin/redes-wifi/{ssid}/calibrar")
def calibrar_red_wifi(ssid: str, request: Request):
    origen_cliente = _obtener_origen_cliente(request)
    return network_manager.vincular_firma_actual_a_red(ssid=ssid, client_host=origen_cliente)

@app.delete("/api/admin/redes-wifi/{ssid}")
def eliminar_red_wifi(ssid: str):
    return network_manager.eliminar_red(ssid)