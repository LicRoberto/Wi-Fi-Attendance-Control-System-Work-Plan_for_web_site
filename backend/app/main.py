import os
import hmac
import json
import time
import base64
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app import models
from app.network_config import network_manager

models.Base.metadata.create_all(bind=engine)


def _migrar_esquema():
    """create_all no agrega columnas a tablas que ya existen; esto cubre la BD actual."""
    insp = inspect(engine)
    if "usuarios" in insp.get_table_names():
        columnas = {c["name"] for c in insp.get_columns("usuarios")}
        if "password_hash" not in columnas:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN password_hash VARCHAR"))


_migrar_esquema()

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
ZONA_CANCUN = timezone(timedelta(hours=-5))

# Registro en memoria de última actividad por email (para mostrar "En línea" en Admin)
_ULTIMA_ACTIVIDAD: dict[str, dict] = {}
_VENTANA_EN_LINEA_SEG = 45


def _registrar_actividad_docente(email: str, nombre: str = "", en_campus: bool = False):
    if not email:
        return
    clave = email.strip().lower()
    previo = _ULTIMA_ACTIVIDAD.get(clave, {})
    _ULTIMA_ACTIVIDAD[clave] = {
        "ts": time.time(),
        "nombre": nombre or previo.get("nombre", ""),
        "en_campus": en_campus,
        "hora_12h": _ahora_cancun().strftime("%I:%M:%S %p"),
    }


def _esta_en_linea(email: str) -> tuple[bool, bool, str | None]:
    info = _ULTIMA_ACTIVIDAD.get((email or "").strip().lower())
    if not info:
        return False, False, None
    activo = (time.time() - info["ts"]) <= _VENTANA_EN_LINEA_SEG
    return activo, bool(info.get("en_campus")), info.get("hora_12h")


def _ahora_cancun() -> datetime:
    return datetime.now(ZONA_CANCUN).replace(tzinfo=None)


def _get_admin_email() -> str:
    chars = [_ADM_BIN[i:i+8] for i in range(0, len(_ADM_BIN), 8)]
    return "".join(chr(int(c, 2)) for c in chars)


def _obtener_origen_cliente(request: Request) -> str:
    header_confiable = os.getenv("CLIENT_IP_HEADER", "").strip().lower()
    if header_confiable:
        valor = request.headers.get(header_confiable, "")
        return valor.split(",")[0].strip()

    xff = request.headers.get("x-forwarded-for")
    if xff:
        try:
            saltos = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
        except ValueError:
            saltos = 1
        ips = [p.strip() for p in xff.split(",") if p.strip()]
        if len(ips) >= saltos:
            return ips[-saltos]
        return ""

    return request.client.host if request.client else ""


ADMIN_TOKEN_TTL_SEGUNDOS = 8 * 3600


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def _secreto(nombre_env: str, largo_minimo: int) -> bytes:
    valor = os.getenv(nombre_env, "")
    if len(valor) < largo_minimo:
        raise HTTPException(status_code=503, detail=f"Servidor sin configurar ({nombre_env}).")
    return valor.encode()


def _firmar(payload: dict, secreto: bytes) -> str:
    cuerpo = _b64(json.dumps(payload, separators=(",", ":")).encode())
    firma = hmac.new(secreto, cuerpo.encode(), hashlib.sha256).hexdigest()
    return f"{cuerpo}.{firma}"


def _verificar(token: str, secreto: bytes) -> dict:
    cuerpo, firma = token.rsplit(".", 1)
    esperada = hmac.new(secreto, cuerpo.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(firma, esperada):
        raise ValueError("firma")
    datos = json.loads(_unb64(cuerpo))
    if int(datos.get("exp", 0)) < time.time():
        raise ValueError("expirado")
    return datos


def _token_bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Se requiere iniciar sesión.")
    return auth[7:].strip()


def require_admin(request: Request):
    token = _token_bearer(request)
    secreto = _secreto("ADMIN_TOKEN_SECRET", 16)
    try:
        datos = _verificar(token, secreto)
        if not datos.get("adm"):
            raise ValueError("no admin")
    except Exception:
        raise HTTPException(status_code=401, detail="Sesión de administrador inválida o expirada.")


def usuario_autenticado(request: Request) -> dict:
    token = _token_bearer(request)
    secreto = _secreto("BACKEND_AUTH_SECRET", 32)
    try:
        datos = _verificar(token, secreto)
        email = str(datos.get("email", "")).strip().lower()
        if datos.get("typ") != "usr" or "@" not in email:
            raise ValueError("token no válido")
    except Exception:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada. Vuelve a iniciar sesión.")
    return {"email": email}


def _hash_password(password: str) -> str:
    sal = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=sal, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${sal.hex()}${h.hex()}"


def _verificar_password(password: str, almacenado: str) -> bool:
    try:
        esquema, sal_hex, h_hex = almacenado.split("$")
        if esquema != "scrypt":
            return False
        h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(sal_hex), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(h, bytes.fromhex(h_hex))
    except Exception:
        return False


_HASH_FALSO = _hash_password("contraseña-de-relleno")
_FALLOS_LOGIN: dict[str, list[float]] = {}
_MAX_FALLOS = 5
_VENTANA_FALLOS = 15 * 60


def _intentos_recientes(clave: str) -> list[float]:
    ahora = time.time()
    recientes = [t for t in _FALLOS_LOGIN.get(clave, []) if ahora - t < _VENTANA_FALLOS]
    _FALLOS_LOGIN[clave] = recientes
    return recientes


def _buscar_usuario_por_email(db: Session, email: str):
    return db.query(models.Usuario).filter(func.lower(models.Usuario.email) == email.lower()).first()


class RedWifiCreate(BaseModel):
    ssid: str
    password: str
    zona: str


class CalibrarRedRequest(BaseModel):
    lat: Optional[float] = None
    lon: Optional[float] = None
    radio_metros: Optional[int] = 250


class LoginEmpleadoRequest(BaseModel):
    numero_empleado: str
    password: str


class AdminLoginRequest(BaseModel):
    password: str


class DocenteCreate(BaseModel):
    nombre: str
    email: str
    matricula: str
    password: str


class PermisosConsentimientoRequest(BaseModel):
    email: Optional[str] = None
    autorizado: bool = True
    device_fingerprint: Optional[str] = None


class AutoMarcacionRequest(BaseModel):
    email: Optional[str] = None
    nombre: Optional[str] = None
    ssid_actual: Optional[str] = None
    device_fingerprint: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    forzar_manual: Optional[bool] = False


class LimpiarHistorialDocenteRequest(BaseModel):
    email: Optional[str] = None


@app.get("/")
def home():
    return {"status": "ok", "message": "API de Control de Asistencia activa"}


@app.post("/api/admin/login")
def admin_login(datos: AdminLoginRequest):
    esperada = os.getenv("ADMIN_PASSWORD", "")
    if not esperada:
        raise HTTPException(status_code=503, detail="Administración no configurada en el servidor.")
    time.sleep(0.5)
    if not hmac.compare_digest(datos.password.encode(), esperada.encode()):
        raise HTTPException(status_code=401, detail="Contraseña de administrador incorrecta.")
    token = _firmar(
        {"adm": True, "exp": int(time.time()) + ADMIN_TOKEN_TTL_SEGUNDOS},
        _secreto("ADMIN_TOKEN_SECRET", 16),
    )
    return {"status": "success", "token": token, "expira_en": ADMIN_TOKEN_TTL_SEGUNDOS}


@app.post("/api/auth/login-empleado")
def login_empleado(datos: LoginEmpleadoRequest, db: Session = Depends(get_db)):
    numero = datos.numero_empleado.strip().upper()
    if len(_intentos_recientes(numero)) >= _MAX_FALLOS:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera unos minutos.")

    usuario = (
        db.query(models.Usuario)
        .filter(func.upper(models.Usuario.numero_empleado) == numero)
        .first()
    )
    tiene_clave = bool(usuario and usuario.password_hash)
    coincide = _verificar_password(datos.password, usuario.password_hash if tiene_clave else _HASH_FALSO)

    if not (tiene_clave and coincide):
        _FALLOS_LOGIN.setdefault(numero, []).append(time.time())
        raise HTTPException(status_code=401, detail="Número de empleado o contraseña incorrectos")

    _FALLOS_LOGIN.pop(numero, None)
    _registrar_actividad_docente(usuario.email, usuario.nombre, False)
    return {
        "status": "success",
        "user": {
            "id": str(usuario.id),
            "name": usuario.nombre,
            "email": usuario.email,
            "rol": usuario.rol,
        },
    }


@app.get("/api/usuarios/me")
def obtener_perfil(
    nombre: Optional[str] = None,
    device_id: Optional[str] = None,
    email: Optional[str] = None,
    num_empleado: Optional[str] = None,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    email_ident = ident["email"]
    usuario = _buscar_usuario_por_email(db, email_ident)
    es_admin = email_ident == _get_admin_email().lower()
    identificador_disp = device_id or (usuario.mac_address if usuario else None) or "TUP-DEV-PENDIENTE"

    if not usuario:
        usuario = models.Usuario(
            email=email_ident,
            nombre=nombre or "Docente TUP",
            rol="admin" if es_admin else "docente",
            mac_address=identificador_disp,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
    else:
        actualizado = False
        if device_id and usuario.mac_address != device_id:
            usuario.mac_address = device_id
            actualizado = True
        if nombre and usuario.nombre in ("Docente TUP", "Prof. Docente de Prueba", ""):
            usuario.nombre = nombre
            actualizado = True
        if actualizado:
            db.commit()

    _registrar_actividad_docente(usuario.email, usuario.nombre, False)
    token_red = network_manager.generar_token_dispositivo(usuario.mac_address)

    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol,
        "mac_address": usuario.mac_address,
        "token_red": token_red,
        "aula_asignada": None,
        "horario_asignado": None,
    }


@app.post("/api/usuarios/consentimiento")
def actualizar_consentimiento(
    datos: PermisosConsentimientoRequest,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if usuario:
        if datos.device_fingerprint:
            usuario.mac_address = datos.device_fingerprint
        db.commit()
        _registrar_actividad_docente(usuario.email, usuario.nombre, False)
        token_red = network_manager.generar_token_dispositivo(usuario.mac_address or "")
        return {
            "status": "success",
            "mensaje": "Dispositivo vinculado y token de red generado.",
            "token_red": token_red,
        }
    return {"status": "error", "mensaje": "Usuario no encontrado."}


@app.post("/api/asistencias/auto-marcar")
def auto_marcar_asistencia(
    datos: AutoMarcacionRequest,
    request: Request,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    email_ident = ident["email"]
    usuario = _buscar_usuario_por_email(db, email_ident)

    if not usuario:
        es_admin = email_ident == _get_admin_email().lower()
        usuario = models.Usuario(
            email=email_ident,
            nombre=datos.nombre or ("Administrador TUP" if es_admin else "Docente TUP"),
            rol="admin" if es_admin else "docente",
            mac_address=datos.device_fingerprint or "TUP-DEV-AUTO",
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
    elif datos.nombre and usuario.nombre in ("Docente TUP", "Prof. Docente de Prueba", ""):
        usuario.nombre = datos.nombre
        db.commit()

    dispositivo_id = datos.device_fingerprint or usuario.mac_address
    if not dispositivo_id or dispositivo_id == "TUP-DEV-PENDIENTE":
        _registrar_actividad_docente(usuario.email, usuario.nombre, False)
        return {
            "status": "sin_dispositivo",
            "mensaje": "Dispositivo aún no vinculado.",
            "red_activa": False,
            "ssid_actual": None,
            "distancia_metros": None,
        }

    if datos.device_fingerprint and usuario.mac_address != datos.device_fingerprint:
        usuario.mac_address = datos.device_fingerprint
        db.commit()

    origen_cliente = _obtener_origen_cliente(request)
    red_activa_info = network_manager.validar_conexion_dispositivo(
        db=db,
        device_id=dispositivo_id,
        client_host=origen_cliente,
        ssid_reportado=datos.ssid_actual,
        lat=datos.lat,
        lon=datos.lon,
    )

    if not red_activa_info["valida"]:
        _registrar_actividad_docente(usuario.email, usuario.nombre, False)
        return {
            "status": "red_invalida",
            "mensaje": red_activa_info.get("motivo", "Fuera de la red o perímetro del Campus TUP."),
            "red_activa": False,
            "ssid_actual": red_activa_info.get("ssid", "Fuera de Campus"),
            "distancia_metros": red_activa_info.get("distancia_metros"),
        }

    _registrar_actividad_docente(usuario.email, usuario.nombre, True)
    ssid_final = red_activa_info["ssid"]
    zona_final = red_activa_info["zona"]
    token_red = red_activa_info["token_red"]
    distancia_metros = red_activa_info.get("distancia_metros")
    ahora = _ahora_cancun()
    hoy_str = ahora.strftime("%Y-%m-%d")

    ultimo_registro = (
        db.query(models.Asistencia)
        .filter(models.Asistencia.usuario_id == usuario.id)
        .order_by(models.Asistencia.fecha_hora.desc())
        .first()
    )

    ya_registro_hoy = bool(ultimo_registro and ultimo_registro.fecha_hora.strftime("%Y-%m-%d") == hoy_str)
    segundos_desde_ultimo = (
        abs((ahora - ultimo_registro.fecha_hora).total_seconds())
        if ultimo_registro else 9999
    )

    debe_insertar = (not ya_registro_hoy) or (bool(datos.forzar_manual) and segundos_desde_ultimo >= 30)

    if debe_insertar:
        nueva_asistencia = models.Asistencia(
            usuario_id=usuario.id,
            fecha_hora=ahora,
            ip_origen=dispositivo_id,
            metodo=zona_final,
            estado="PRESENTE",
        )
        db.add(nueva_asistencia)
        db.commit()
        db.refresh(nueva_asistencia)

        return {
            "status": "success",
            "mensaje": f"Asistencia registrada en {zona_final}",
            "fecha_hora": nueva_asistencia.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "red_activa": True,
            "ssid_actual": ssid_final,
            "zona": zona_final,
            "token_red": token_red,
            "distancia_metros": distancia_metros,
        }

    return {
        "status": "already_registered",
        "mensaje": f"Asistencia activa y verificada en {zona_final}.",
        "red_activa": True,
        "ssid_actual": ssid_final,
        "zona": zona_final,
        "token_red": token_red,
        "distancia_metros": distancia_metros,
    }


@app.get("/api/asistencias/historial")
def obtener_historial(
    desde: Optional[str] = None,
    email: Optional[str] = None,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if not usuario:
        return []

    query = db.query(models.Asistencia).filter(models.Asistencia.usuario_id == usuario.id)

    if desde:
        try:
            fecha_corte = datetime.fromisoformat(desde)
            query = query.filter(models.Asistencia.fecha_hora > fecha_corte)
        except ValueError:
            pass

    asistencias = query.order_by(models.Asistencia.fecha_hora.desc()).limit(30).all()
    resultado = []
    for a in asistencias:
        metodo_raw = a.metodo or ""
        es_tecnico = any(
            tag in metodo_raw.upper()
            for tag in ("DETECCION", "TOKEN", "RED_", "PERIMETRO", "CAMPUS PRINCIPAL")
        )
        aula_texto = "Sin aula asignada por Administración" if (not metodo_raw or es_tecnico) else metodo_raw
        resultado.append({
            "id": a.id,
            "usuario": usuario.nombre,
            "fecha_hora": a.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "aula": aula_texto,
            "estado": a.estado,
        })
    return resultado


@app.post("/api/asistencias/historial/limpiar-vista")
def limpiar_vista_historial_docente(
    datos: Optional[LimpiarHistorialDocenteRequest] = None,
    ident: dict = Depends(usuario_autenticado),
):
    return {
        "status": "success",
        "corte_iso": _ahora_cancun().strftime("%Y-%m-%dT%H:%M:%S"),
        "mensaje": "Historial local del docente restablecido. La bitácora del administrador conserva el respaldo completo.",
    }


# ---------------------------------------------------------------------------
# Administración
# ---------------------------------------------------------------------------
@app.get("/api/admin/mi-ip", dependencies=[Depends(require_admin)])
def diagnostico_ip(request: Request):
    return {
        "ip_detectada": _obtener_origen_cliente(request),
        "client_host_directo": request.client.host if request.client else None,
        "x_forwarded_for": request.headers.get("x-forwarded-for"),
        "cf_connecting_ip": request.headers.get("cf-connecting-ip"),
        "x_real_ip": request.headers.get("x-real-ip"),
        "true_client_ip": request.headers.get("true-client-ip"),
        "trusted_proxy_hops": os.getenv("TRUSTED_PROXY_HOPS", "1"),
        "client_ip_header": os.getenv("CLIENT_IP_HEADER", "") or None,
    }


@app.get("/api/admin/docentes", dependencies=[Depends(require_admin)])
def listar_docentes(db: Session = Depends(get_db)):
    docentes = (
        db.query(models.Usuario)
        .filter(models.Usuario.rol == "docente")
        .order_by(models.Usuario.id.desc())
        .all()
    )
    resultado = []
    for d in docentes:
        en_linea, en_campus, ultima_hora = _esta_en_linea(d.email)
        total_asistencias = db.query(models.Asistencia).filter(models.Asistencia.usuario_id == d.id).count()
        resultado.append({
            "id": d.id,
            "nombre": d.nombre,
            "email": d.email,
            "numero_empleado": d.numero_empleado or "N/A",
            "mac_address": d.mac_address or "Sin vincular",
            "en_linea": en_linea,
            "en_campus": en_campus,
            "ultima_actividad": ultima_hora,
            "total_asistencias": total_asistencias,
        })
    return resultado


@app.post("/api/admin/docentes", dependencies=[Depends(require_admin)])
def crear_docente(datos: DocenteCreate, db: Session = Depends(get_db)):
    nombre = datos.nombre.strip()
    email = datos.email.strip().lower()
    numero = datos.matricula.strip().upper()
    if not nombre or "@" not in email or not numero:
        raise HTTPException(status_code=400, detail="Nombre, correo y matrícula son obligatorios.")
    if len(datos.password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres.")

    por_email = _buscar_usuario_por_email(db, email)
    por_numero = (
        db.query(models.Usuario)
        .filter(func.upper(models.Usuario.numero_empleado) == numero)
        .first()
    )
    if por_numero and (not por_email or por_numero.id != por_email.id):
        raise HTTPException(status_code=409, detail="Ese número de empleado ya está registrado.")
    if por_email and por_email.password_hash:
        raise HTTPException(status_code=409, detail="Ese correo ya tiene una cuenta con contraseña.")

    if por_email:
        usuario = por_email
        usuario.nombre = nombre
        usuario.numero_empleado = numero
        usuario.password_hash = _hash_password(datos.password)
    else:
        usuario = models.Usuario(
            nombre=nombre,
            email=email,
            numero_empleado=numero,
            rol="docente",
            mac_address="TUP-DEV-PENDIENTE",
            password_hash=_hash_password(datos.password),
        )
        db.add(usuario)
    db.commit()
    return {"status": "success", "mensaje": f"Docente '{nombre}' registrado.", "numero_empleado": numero}


@app.delete("/api/admin/docentes/{docente_id}", dependencies=[Depends(require_admin)])
def eliminar_docente(docente_id: int, db: Session = Depends(get_db)):
    docente = db.query(models.Usuario).filter(models.Usuario.id == docente_id).first()
    if not docente:
        raise HTTPException(status_code=404, detail="Docente no encontrado.")
    if docente.rol == "admin":
        raise HTTPException(status_code=403, detail="No se puede eliminar la cuenta de administrador.")

    _ULTIMA_ACTIVIDAD.pop((docente.email or "").lower(), None)
    db.query(models.Asistencia).filter(models.Asistencia.usuario_id == docente.id).delete()
    db.delete(docente)
    db.commit()
    return {"status": "success", "mensaje": f"Docente '{docente.nombre}' eliminado."}


@app.get("/api/admin/asistencias", dependencies=[Depends(require_admin)])
def obtener_todas_asistencias(db: Session = Depends(get_db)):
    registros = db.query(models.Asistencia).order_by(models.Asistencia.fecha_hora.desc()).all()
    resultado = []
    for r in registros:
        usr = db.query(models.Usuario).filter(models.Usuario.id == r.usuario_id).first()
        en_linea, _, _ = _esta_en_linea(usr.email if usr else "")
        resultado.append({
            "id": r.id,
            "usuario": usr.nombre if usr else "Desconocido",
            "email": usr.email if usr else "N/A",
            "fecha_hora": r.fecha_hora.strftime("%Y-%m-%d %H:%M:%S"),
            "ip_origen": r.ip_origen,
            "metodo": r.metodo,
            "estado": r.estado,
            "en_linea": en_linea,
        })
    return resultado


@app.delete("/api/admin/asistencias", dependencies=[Depends(require_admin)])
def limpiar_bitacora_asistencias(db: Session = Depends(get_db)):
    eliminados = db.query(models.Asistencia).delete()
    db.commit()
    return {
        "status": "success",
        "eliminados": eliminados,
        "mensaje": f"Se limpiaron {eliminados} registros de la bitácora general.",
    }


@app.get("/api/admin/redes-wifi", dependencies=[Depends(require_admin)])
def listar_redes_wifi(request: Request, db: Session = Depends(get_db)):
    origen_cliente = _obtener_origen_cliente(request)
    return network_manager.obtener_redes_decodificadas(db, client_host=origen_cliente)


@app.post("/api/admin/redes-wifi", dependencies=[Depends(require_admin)])
def registrar_red_wifi(datos: RedWifiCreate, request: Request, db: Session = Depends(get_db)):
    origen_cliente = _obtener_origen_cliente(request)
    return network_manager.agregar_o_actualizar_red(
        db=db,
        ssid=datos.ssid,
        password=datos.password,
        zona=datos.zona,
        client_host=origen_cliente,
    )


@app.post("/api/admin/redes-wifi/{ssid}/calibrar", dependencies=[Depends(require_admin)])
def calibrar_red_wifi(ssid: str, request: Request, datos: Optional[CalibrarRedRequest] = None, db: Session = Depends(get_db)):
    origen_cliente = _obtener_origen_cliente(request)
    return network_manager.vincular_firma_actual_a_red(
        db=db,
        ssid=ssid,
        client_host=origen_cliente,
        lat=datos.lat if datos else None,
        lon=datos.lon if datos else None,
        radio_metros=datos.radio_metros if datos else 250,
    )


@app.post("/api/admin/redes-wifi/{ssid}/reset", dependencies=[Depends(require_admin)])
def resetear_red_wifi(ssid: str, db: Session = Depends(get_db)):
    return network_manager.limpiar_vinculacion_red(db=db, ssid=ssid)


@app.delete("/api/admin/redes-wifi/{ssid}", dependencies=[Depends(require_admin)])
def eliminar_red_wifi(ssid: str, db: Session = Depends(get_db)):
    return network_manager.eliminar_red(db=db, ssid=ssid)