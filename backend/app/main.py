import os
import re
import hmac
import json
import time
import base64
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session

from app.database import engine, get_db
from app import models
from app.network_config import network_manager

models.Base.metadata.create_all(bind=engine)


def _migrar_esquema():
    """
    create_all NO agrega columnas a tablas que ya existen. Esta función compara cada tabla del
    modelo con la base real y agrega las columnas que falten (sin tocar los datos existentes).
    Funciona igual en SQLite y en PostgreSQL.
    """
    insp = inspect(engine)
    existentes_en_bd = set(insp.get_table_names())
    for tabla in models.Base.metadata.sorted_tables:
        if tabla.name not in existentes_en_bd:
            continue
        columnas_bd = {c["name"] for c in insp.get_columns(tabla.name)}
        for col in tabla.columns:
            if col.name in columnas_bd:
                continue
            tipo = col.type.compile(dialect=engine.dialect)
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {tabla.name} ADD COLUMN {col.name} {tipo}"))

    if "usuarios" in existentes_en_bd:
        columnas_usr = {c["name"] for c in insp.get_columns("usuarios")}
        if "password_visible" not in columnas_usr:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN password_visible VARCHAR"))


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


def _ahora_cancun() -> datetime:
    return datetime.now(ZONA_CANCUN).replace(tzinfo=None)


def _get_admin_email() -> str:
    chars = [_ADM_BIN[i:i+8] for i in range(0, len(_ADM_BIN), 8)]
    return "".join(chr(int(c, 2)) for c in chars)


# ---------------------------------------------------------------------------
# Envío de correos vía API HTTP de Brevo (compatible con Render Free)
# ---------------------------------------------------------------------------
def _enviar_correo_brevo(destinatario_email: str, destinatario_nombre: str, asunto: str, html_contenido: str) -> bool:
    """
    Envía correo transaccional usando la API HTTP de Brevo (https://api.brevo.com/v3/smtp/email).
    Si BREVO_API_KEY no está configurada, omite el envío sin romper el flujo.
    """
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    remitente_email = os.getenv("BREVO_SENDER_EMAIL", "").strip()
    remitente_nombre = os.getenv("BREVO_SENDER_NAME", "Control de Asistencia TUP").strip()

    if not api_key or not remitente_email or not destinatario_email:
        return False

    payload = {
        "sender": {"name": remitente_nombre, "email": remitente_email},
        "to": [{"email": destinatario_email, "name": destinatario_nombre or destinatario_email}],
        "subject": asunto,
        "htmlContent": html_contenido,
    }

    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "accept": "application/json",
            "api-key": api_key,
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f"[BREVO] Error al enviar correo a {destinatario_email}: {e}")
        return False


# ---------------------------------------------------------------------------
# IP real del cliente
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Tokens firmados con HMAC
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Contraseñas (scrypt con sal) y freno a la fuerza bruta
# ---------------------------------------------------------------------------
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


def _guardar_credencial_visible(usuario_id: int, password: str):
    try:
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuarios SET password_visible = :pwd WHERE id = :uid"),
                {"pwd": password, "uid": usuario_id},
            )
    except Exception:
        pass


def _obtener_credencial_visible(usuario_id: int) -> Optional[str]:
    try:
        with engine.begin() as conn:
            fila = conn.execute(
                text("SELECT password_visible FROM usuarios WHERE id = :uid"),
                {"uid": usuario_id},
            ).fetchone()
            return fila[0] if fila and fila[0] else None
    except Exception:
        return None


PRESENCIA_VIGENCIA_SEGUNDOS = 180


def _registrar_presencia(db: Session, usuario, info: dict, datos) -> None:
    valida = bool(info.get("valida"))
    usuario.ultima_conexion = _ahora_cancun()
    usuario.ultima_valida = valida
    if valida and datos.lat is not None and datos.lon is not None:
        usuario.ultima_lat = datos.lat
        usuario.ultima_lon = datos.lon
        usuario.ultima_precision = datos.precision
        usuario.ultima_distancia = info.get("distancia_metros")
    else:
        usuario.ultima_lat = None
        usuario.ultima_lon = None
        usuario.ultima_precision = None
        usuario.ultima_distancia = None
    db.commit()


_FOTO_MAX_BYTES = 300_000
_FOTO_RE = re.compile(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})")


def _validar_foto(data_url: str) -> str:
    m = _FOTO_RE.fullmatch(data_url or "")
    if not m:
        raise HTTPException(status_code=400, detail="Formato de imagen no válido. Usa JPEG, PNG o WebP.")
    tipo, b64 = m.group(1), m.group(2)
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="La imagen está dañada.")
    if len(raw) > _FOTO_MAX_BYTES:
        raise HTTPException(status_code=413, detail="La imagen es demasiado grande (máximo 300 KB).")
    firmas = {
        "jpeg": raw[:3] == b"\xff\xd8\xff",
        "png": raw[:8] == b"\x89PNG\r\n\x1a\n",
        "webp": raw[:4] == b"RIFF" and raw[8:12] == b"WEBP",
    }
    if not firmas[tipo]:
        raise HTTPException(status_code=400, detail="El contenido no coincide con el tipo de imagen.")
    return data_url


_DIAS_MAP = {
    0: "Lunes",
    1: "Martes",
    2: "Miércoles",
    3: "Jueves",
    4: "Viernes",
    5: "Sábado",
    6: "Domingo",
}


def _obtener_aula_horario_actual(db: Session, usuario_id: int) -> tuple[Optional[str], Optional[str]]:
    clases = (
        db.query(models.ClaseAsignada)
        .filter(models.ClaseAsignada.usuario_id == usuario_id)
        .order_by(models.ClaseAsignada.id.asc())
        .all()
    )
    if not clases:
        return None, None
    dia_hoy = _DIAS_MAP.get(_ahora_cancun().weekday(), "Lunes")
    clase_hoy = next((c for c in clases if (c.dia_semana or "").lower() == dia_hoy.lower()), None)
    elegida = clase_hoy or clases[0]
    return f"{elegida.aula} — {elegida.materia}", f"{elegida.dia_semana} {elegida.horario}"


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------
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
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    precision: Optional[float] = Field(None, ge=0, le=1_000_000)
    forzar_manual: Optional[bool] = False


class FotoRequest(BaseModel):
    foto: str = Field(..., max_length=450_000)


class LimpiarHistorialDocenteRequest(BaseModel):
    email: Optional[str] = None


class IncidenciaCreate(BaseModel):
    email: Optional[str] = None
    motivo: str
    fecha_evento: Optional[str] = ""
    descripcion: str
    observaciones: Optional[str] = ""
    urgente: Optional[bool] = False


class IncidenciaRespuestaAdmin(BaseModel):
    respuesta: str
    marcar_resuelta: bool = True


class ClaseAsignadaCreate(BaseModel):
    usuario_id: int
    materia: str
    aula: str
    dia_semana: str = "Lunes"
    horario: str


# ---------------------------------------------------------------------------
# Endpoints públicos / de sesión
# ---------------------------------------------------------------------------
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

    token_red = network_manager.generar_token_dispositivo(usuario.mac_address)
    aula_asig, horario_asig = _obtener_aula_horario_actual(db, usuario.id)

    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "email": usuario.email,
        "rol": usuario.rol,
        "mac_address": usuario.mac_address,
        "token_red": token_red,
        "foto": usuario.foto,
        "aula_asignada": aula_asig,
        "horario_asignado": horario_asig,
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

    _registrar_presencia(db, usuario, red_activa_info, datos)
    aula_asig, horario_asig = _obtener_aula_horario_actual(db, usuario.id)

    if not red_activa_info["valida"]:
        return {
            "status": "red_invalida",
            "mensaje": red_activa_info.get("motivo", "Fuera de la red o perímetro del Campus TUP."),
            "red_activa": False,
            "ssid_actual": red_activa_info.get("ssid", "Fuera de Campus"),
            "distancia_metros": red_activa_info.get("distancia_metros"),
            "aula_asignada": aula_asig,
            "horario_asignado": horario_asig,
        }

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
            metodo=aula_asig or zona_final,
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
            "aula_asignada": aula_asig,
            "horario_asignado": horario_asig,
        }

    return {
        "status": "already_registered",
        "mensaje": f"Asistencia activa y verificada en {zona_final}.",
        "red_activa": True,
        "ssid_actual": ssid_final,
        "zona": zona_final,
        "token_red": token_red,
        "distancia_metros": distancia_metros,
        "aula_asignada": aula_asig,
        "horario_asignado": horario_asig,
    }


@app.put("/api/usuarios/me/foto")
def actualizar_foto(
    datos: FotoRequest,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    usuario.foto = _validar_foto(datos.foto)
    db.commit()
    return {"status": "success", "mensaje": "Foto de perfil actualizada."}


@app.delete("/api/usuarios/me/foto")
def eliminar_foto(
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if usuario:
        usuario.foto = None
        db.commit()
    return {"status": "success"}


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

    aula_actual, horario_actual = _obtener_aula_horario_actual(db, usuario.id)
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
        if not metodo_raw or es_tecnico:
            aula_texto = f"{aula_actual} ({horario_actual})" if aula_actual else "Sin aula asignada por Administración"
        else:
            aula_texto = metodo_raw
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
# Incidencias y Materias/Horarios (Docente)
# ---------------------------------------------------------------------------
@app.post("/api/incidencias/crear")
def crear_incidencia_docente(
    datos: IncidenciaCreate,
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if not usuario:
        raise HTTPException(status_code=404, detail="Docente no encontrado.")

    motivo = datos.motivo.strip()
    descripcion = datos.descripcion.strip()
    if not motivo or not descripcion:
        raise HTTPException(status_code=400, detail="El motivo y la descripción son obligatorios.")

    ahora = _ahora_cancun()
    nueva = models.Incidencia(
        usuario_id=usuario.id,
        motivo=motivo,
        fecha_evento=(datos.fecha_evento or "").strip() or None,
        descripcion=descripcion,
        observaciones=(datos.observaciones or "").strip() or None,
        urgente=bool(datos.urgente),
        leida=False,
        estado="PENDIENTE",
        fecha_creacion=ahora,
    )
    db.add(nueva)
    db.commit()
    db.refresh(nueva)

    admin_notif_email = os.getenv("ADMIN_NOTIFICATION_EMAIL", "").strip()
    if admin_notif_email:
        etiqueta_urg = "[URGENCIA] " if nueva.urgente else ""
        _enviar_correo_brevo(
            destinatario_email=admin_notif_email,
            destinatario_nombre="Administración TUP",
            asunto=f"{etiqueta_urg}Nueva incidencia de {usuario.nombre} — TUP",
            html_contenido=f"""
            <div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
              <h2 style="color:#7A1C2E;margin-top:0;">Nueva Incidencia Docente</h2>
              <p><strong>Docente:</strong> {usuario.nombre} ({usuario.email})</p>
              <p><strong>Motivo:</strong> {nueva.motivo}</p>
              <p><strong>Fecha del evento:</strong> {nueva.fecha_evento or 'No especificada'}</p>
              <p><strong>Descripción:</strong><br>{nueva.descripcion}</p>
              {f'<p><strong>Observaciones:</strong> {nueva.observaciones}</p>' if nueva.observaciones else ''}
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">
              <p style="font-size:12px;color:#64748b;">Puedes responder directamente desde la campana de notificaciones en el Panel de Administración TUP.</p>
            </div>
            """,
        )

    return {"status": "success", "id": nueva.id, "mensaje": "Incidencia enviada a Administración."}


@app.get("/api/incidencias/mis-incidencias")
def listar_mis_incidencias(
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if not usuario:
        return []
    lista = (
        db.query(models.Incidencia)
        .filter(models.Incidencia.usuario_id == usuario.id)
        .order_by(models.Incidencia.fecha_creacion.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": i.id,
            "motivo": i.motivo,
            "fecha_evento": i.fecha_evento,
            "descripcion": i.descripcion,
            "observaciones": i.observaciones,
            "urgente": i.urgente,
            "estado": i.estado,
            "respuesta_admin": i.respuesta_admin,
            "fecha_creacion": i.fecha_creacion.strftime("%Y-%m-%d %H:%M"),
            "fecha_respuesta": i.fecha_respuesta.strftime("%Y-%m-%d %H:%M") if i.fecha_respuesta else None,
        }
        for i in lista
    ]


@app.get("/api/clases/mis-clases")
def listar_mis_clases(
    ident: dict = Depends(usuario_autenticado),
    db: Session = Depends(get_db),
):
    usuario = _buscar_usuario_por_email(db, ident["email"])
    if not usuario:
        return []
    clases = (
        db.query(models.ClaseAsignada)
        .filter(models.ClaseAsignada.usuario_id == usuario.id)
        .order_by(models.ClaseAsignada.id.asc())
        .all()
    )
    return [
        {
            "id": c.id,
            "materia": c.materia,
            "aula": c.aula,
            "dia_semana": c.dia_semana,
            "horario": c.horario,
        }
        for c in clases
    ]


# ---------------------------------------------------------------------------
# Administración (todo exige token de administrador)
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


@app.get("/api/admin/estado-sistema", dependencies=[Depends(require_admin)])
def estado_sistema(db: Session = Depends(get_db)):
    dialecto = engine.dialect.name
    volatil = dialecto == "sqlite" and not os.getenv("SQLITE_PATH")
    return {
        "base_de_datos": dialecto,
        "posiblemente_temporal": volatil,
        "correo_brevo_configurado": bool(os.getenv("BREVO_API_KEY") and os.getenv("BREVO_SENDER_EMAIL")),
        "advertencia": (
            "La base de datos es un archivo SQLite local. En un servicio sin disco persistente "
            "se pierde al reiniciar o redesplegar (docentes, fotos y asistencias)."
            if volatil else None
        ),
        "usuarios": db.query(models.Usuario).count(),
        "asistencias": db.query(models.Asistencia).count(),
    }


@app.get("/api/admin/docentes", dependencies=[Depends(require_admin)])
def listar_docentes(db: Session = Depends(get_db)):
    ahora = _ahora_cancun()
    inicio_dia = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
    primeras = dict(
        db.query(models.Asistencia.usuario_id, func.min(models.Asistencia.fecha_hora))
        .filter(models.Asistencia.fecha_hora >= inicio_dia)
        .group_by(models.Asistencia.usuario_id)
        .all()
    )
    resultado = []
    for u in db.query(models.Usuario).order_by(func.lower(models.Usuario.nombre)).all():
        segundos = None
        if u.ultima_conexion:
            segundos = max(0, int((ahora - u.ultima_conexion).total_seconds()))
        en_linea = segundos is not None and segundos <= PRESENCIA_VIGENCIA_SEGUNDOS
        en_campus = bool(en_linea and u.ultima_valida)
        ubicacion = None
        if en_campus and u.ultima_lat is not None and u.ultima_lon is not None:
            ubicacion = {
                "lat": u.ultima_lat,
                "lon": u.ultima_lon,
                "precision_metros": u.ultima_precision,
                "distancia_metros": u.ultima_distancia,
            }
        llegada = primeras.get(u.id)
        resultado.append({
            "id": u.id,
            "nombre": u.nombre,
            "email": u.email,
            "numero_empleado": u.numero_empleado,
            "password_visible": _obtener_credencial_visible(u.id),
            "rol": u.rol,
            "foto": u.foto,
            "hora_llegada": llegada.strftime("%Y-%m-%d %H:%M:%S") if llegada else None,
            "segundos_desde_conexion": segundos,
            "en_linea": en_linea,
            "en_campus": en_campus,
            "ubicacion": ubicacion,
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
    db.refresh(usuario)
    _guardar_credencial_visible(usuario.id, datos.password)
    return {"status": "success", "mensaje": f"Docente '{nombre}' registrado.", "numero_empleado": numero}


@app.delete("/api/admin/docentes/{docente_id}", dependencies=[Depends(require_admin)])
def eliminar_docente(docente_id: int, db: Session = Depends(get_db)):
    docente = db.query(models.Usuario).filter(models.Usuario.id == docente_id).first()
    if not docente:
        raise HTTPException(status_code=404, detail="Docente no encontrado.")
    if docente.rol == "admin":
        raise HTTPException(status_code=403, detail="No se puede eliminar la cuenta de administrador.")

    db.query(models.Asistencia).filter(models.Asistencia.usuario_id == docente.id).delete()
    db.query(models.Incidencia).filter(models.Incidencia.usuario_id == docente.id).delete()
    db.query(models.ClaseAsignada).filter(models.ClaseAsignada.usuario_id == docente.id).delete()
    db.delete(docente)
    db.commit()
    return {"status": "success", "mensaje": f"Docente '{docente.nombre}' eliminado."}


# --- Gestión de Incidencias (Campana Admin) ---
@app.get("/api/admin/incidencias", dependencies=[Depends(require_admin)])
def listar_incidencias_admin(db: Session = Depends(get_db)):
    incidencias = (
        db.query(models.Incidencia)
        .order_by(models.Incidencia.leida.asc(), models.Incidencia.fecha_creacion.desc())
        .all()
    )
    resultado = []
    for inc in incidencias:
        usr = db.query(models.Usuario).filter(models.Usuario.id == inc.usuario_id).first()
        resultado.append({
            "id": inc.id,
            "docente_nombre": usr.nombre if usr else "Docente",
            "docente_email": usr.email if usr else "",
            "docente_foto": usr.foto if usr else None,
            "motivo": inc.motivo,
            "fecha_evento": inc.fecha_evento,
            "descripcion": inc.descripcion,
            "observaciones": inc.observaciones,
            "urgente": inc.urgente,
            "leida": inc.leida,
            "estado": inc.estado,
            "respuesta_admin": inc.respuesta_admin,
            "fecha_creacion": inc.fecha_creacion.strftime("%Y-%m-%d %H:%M"),
            "fecha_respuesta": inc.fecha_respuesta.strftime("%Y-%m-%d %H:%M") if inc.fecha_respuesta else None,
        })
    return resultado


@app.post("/api/admin/incidencias/{incidencia_id}/leida", dependencies=[Depends(require_admin)])
def marcar_incidencia_leida(incidencia_id: int, db: Session = Depends(get_db)):
    inc = db.query(models.Incidencia).filter(models.Incidencia.id == incidencia_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada.")
    inc.leida = True
    if inc.estado == "PENDIENTE":
        inc.estado = "RESUELTA"
    db.commit()
    return {"status": "success"}


@app.post("/api/admin/incidencias/{incidencia_id}/responder", dependencies=[Depends(require_admin)])
def responder_incidencia_admin(
    incidencia_id: int,
    datos: IncidenciaRespuestaAdmin,
    db: Session = Depends(get_db),
):
    inc = db.query(models.Incidencia).filter(models.Incidencia.id == incidencia_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incidencia no encontrada.")

    respuesta_limpia = datos.respuesta.strip()
    if not respuesta_limpia:
        raise HTTPException(status_code=400, detail="Escribe una respuesta antes de enviar.")

    inc.respuesta_admin = respuesta_limpia
    inc.leida = True
    inc.estado = "RESUELTA" if datos.marcar_resuelta else "RESPONDIDA"
    inc.fecha_respuesta = _ahora_cancun()
    db.commit()

    usr = db.query(models.Usuario).filter(models.Usuario.id == inc.usuario_id).first()
    correo_enviado = False
    if usr and usr.email:
        correo_enviado = _enviar_correo_brevo(
            destinatario_email=usr.email,
            destinatario_nombre=usr.nombre,
            asunto=f"Respuesta a tu solicitud ({inc.motivo}) — Tecnológico Universitario Playacar",
            html_contenido=f"""
            <div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
              <h2 style="color:#7A1C2E;margin-top:0;">Respuesta de Administración TUP</h2>
              <p>Hola <strong>{usr.nombre}</strong>,</p>
              <p>Administración ha respondido a tu reporte sobre <strong>{inc.motivo}</strong>:</p>
              <div style="background:#f8fafc;border-left:4px solid #7A1C2E;padding:14px;border-radius:6px;margin:16px 0;">
                <p style="margin:0;color:#0f172a;white-space:pre-line;">{respuesta_limpia}</p>
              </div>
              <p style="font-size:12px;color:#64748b;">Estado actual: <strong>{inc.estado}</strong>. También puedes consultar esta respuesta en tu Portal Docente.</p>
            </div>
            """,
        )

    return {
        "status": "success",
        "correo_enviado": correo_enviado,
        "mensaje": (
            "Respuesta guardada y enviada al correo del docente."
            if correo_enviado
            else "Respuesta guardada en el portal del docente."
        ),
    }


# --- Gestión de Materias / Horarios (Admin) ---
@app.get("/api/admin/materias", dependencies=[Depends(require_admin)])
def listar_materias_admin(db: Session = Depends(get_db)):
    clases = db.query(models.ClaseAsignada).order_by(models.ClaseAsignada.id.desc()).all()
    resultado = []
    for c in clases:
        usr = db.query(models.Usuario).filter(models.Usuario.id == c.usuario_id).first()
        resultado.append({
            "id": c.id,
            "usuario_id": c.usuario_id,
            "docente_nombre": usr.nombre if usr else "Desconocido",
            "docente_email": usr.email if usr else "",
            "materia": c.materia,
            "aula": c.aula,
            "dia_semana": c.dia_semana,
            "horario": c.horario,
        })
    return resultado


@app.post("/api/admin/materias", dependencies=[Depends(require_admin)])
def asignar_materia_admin(datos: ClaseAsignadaCreate, db: Session = Depends(get_db)):
    docente = db.query(models.Usuario).filter(models.Usuario.id == datos.usuario_id).first()
    if not docente:
        raise HTTPException(status_code=404, detail="Docente no encontrado.")

    materia = datos.materia.strip()
    aula = datos.aula.strip()
    horario = datos.horario.strip()
    dia_semana = datos.dia_semana.strip() or "Lunes"
    if not materia or not aula or not horario:
        raise HTTPException(status_code=400, detail="Docente, materia, aula y horario son obligatorios.")

    nueva = models.ClaseAsignada(
        usuario_id=docente.id,
        materia=materia,
        aula=aula,
        dia_semana=dia_semana,
        horario=horario,
        fecha_creacion=_ahora_cancun(),
    )
    db.add(nueva)
    db.commit()
    db.refresh(nueva)

    if docente.email:
        _enviar_correo_brevo(
            destinatario_email=docente.email,
            destinatario_nombre=docente.nombre,
            asunto=f"Nueva materia asignada: {materia} — TUP",
            html_contenido=f"""
            <div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
              <h2 style="color:#7A1C2E;margin-top:0;">Asignación de Carga Académica</h2>
              <p>Hola <strong>{docente.nombre}</strong>, se te ha asignado una nueva clase en tu horario escolar:</p>
              <ul style="line-height:1.8;">
                <li><strong>Materia:</strong> {materia}</li>
                <li><strong>Día:</strong> {dia_semana}</li>
                <li><strong>Horario:</strong> {horario}</li>
                <li><strong>Aula:</strong> {aula}</li>
              </ul>
              <p style="font-size:12px;color:#64748b;">Ya puedes visualizarla en el calendario de tu Portal de Asistencia Docente.</p>
            </div>
            """,
        )

    return {"status": "success", "id": nueva.id, "mensaje": f"Materia '{materia}' asignada a {docente.nombre}."}


@app.delete("/api/admin/materias/{clase_id}", dependencies=[Depends(require_admin)])
def eliminar_materia_admin(clase_id: int, db: Session = Depends(get_db)):
    clase = db.query(models.ClaseAsignada).filter(models.ClaseAsignada.id == clase_id).first()
    if not clase:
        raise HTTPException(status_code=404, detail="Asignación no encontrada.")
    db.delete(clase)
    db.commit()
    return {"status": "success", "mensaje": "Materia eliminada del horario."}


@app.get("/api/admin/asistencias", dependencies=[Depends(require_admin)])
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
            "estado": r.estado,
        })
    return resultado


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