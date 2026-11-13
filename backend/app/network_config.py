import subprocess
import platform
import hashlib
from sqlalchemy.orm import Session
from app import models

class NetworkConfigManager:
    # Red Institucional Oficial TUP codificada en binario: SSID "TUP"
    DEFAULT_SSID_BIN = "010101000101010101010000"
    DEFAULT_PASS_BIN = "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001"
    DEFAULT_ZONA = "Campus Principal TUP - Aulas"

    @staticmethod
    def _to_binary(text: str) -> str:
        return "".join(format(ord(c) & 0xFF, '08b') for c in text)

    @staticmethod
    def _from_binary(binary_str: str) -> str:
        if not binary_str:
            return ""
        chars = [binary_str[i:i+8] for i in range(0, len(binary_str), 8)]
        return "".join(chr(int(c, 2)) for c in chars)

    @staticmethod
    def _extraer_firma_enlace(client_host: str) -> str:
        """Extrae el bloque del proveedor/enlace del campus (/16) sin hardcodear IPs"""
        if not client_host:
            return ""
        ip_limpia = client_host.split(",")[0].strip()
        partes = ip_limpia.split(".")
        if len(partes) == 4:
            return ".".join(partes[:2])  # Cubre todos los routers/APs del campus TUP
        return ip_limpia

    def asegurar_red_base(self, db: Session):
        red_tup = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == self.DEFAULT_SSID_BIN
        ).first()
        if not red_tup:
            red_tup = models.RedInstitucional(
                ssid_bin=self.DEFAULT_SSID_BIN,
                password_bin=self.DEFAULT_PASS_BIN,
                zona=self.DEFAULT_ZONA,
                firma_red_bin="",
                activa=True
            )
            db.add(red_tup)
            db.commit()

    def generar_token_dispositivo(self, device_id: str, ssid_bin: str = "") -> str:
        if not device_id:
            return ""
        ref = ssid_bin or self.DEFAULT_SSID_BIN
        prefijo_red = f"{int(ref[:16], 2):04X}"
        dev_hash = hashlib.sha256(device_id.encode("utf-8", errors="ignore")).hexdigest()[:6].upper()
        return f"TUP-TOK-{prefijo_red}-{dev_hash}"

    def vincular_firma_actual_a_red(self, db: Session, ssid: str, client_host: str) -> dict:
        self.asegurar_red_base(db)
        ssid_bin = self._to_binary(ssid)
        red = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == ssid_bin
        ).first()

        if not red:
            return {"status": "error", "mensaje": f"Red '{ssid}' no encontrada"}

        firma = self._extraer_firma_enlace(client_host)
        red.firma_red_bin = self._to_binary(firma) if firma else ""
        red.activa = True
        db.commit()

        return {
            "status": "success",
            "mensaje": f"Red '{ssid}' codificada y vinculada exitosamente al enlace Wi-Fi actual."
        }

    def validar_conexion_dispositivo(self, db: Session, device_id: str, client_host: str = "", ssid_reportado: str | None = None) -> dict:
        self.asegurar_red_base(db)
        if not device_id:
            return {"valida": False, "motivo": "Dispositivo sin identificador"}

        firma_actual = self._extraer_firma_enlace(client_host)
        firma_actual_bin = self._to_binary(firma_actual)

        redes_activas = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.activa == True
        ).all()

        for red in redes_activas:
            ssid_decodificado = self._from_binary(red.ssid_bin)

            # 1. Coincidencia directa por SSID del sistema
            if ssid_reportado and self._to_binary(ssid_reportado) == red.ssid_bin:
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

            # 2. Si aún no tiene firma vinculada, auto-calibrar con el primer enlace válido
            if not red.firma_red_bin and firma_actual_bin:
                red.firma_red_bin = firma_actual_bin
                db.commit()
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

            # 3. Validar contra la firma binaria almacenada en base de datos
            if red.firma_red_bin and firma_actual_bin == red.firma_red_bin:
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

        return {
            "valida": False,
            "ssid": "Red Externa / Datos Móviles",
            "motivo": "Tu dispositivo está conectado a otra red fuera del campus TUP."
        }

    def obtener_redes_decodificadas(self, db: Session):
        self.asegurar_red_base(db)
        redes = db.query(models.RedInstitucional).all()
        return [
            {
                "ssid": self._from_binary(r.ssid_bin),
                "password": self._from_binary(r.password_bin),
                "zona": r.zona,
                "activa": r.activa,
                "calibrada": bool(r.firma_red_bin)
            }
            for r in redes
        ]

    def agregar_o_actualizar_red(self, db: Session, ssid: str, password: str, zona: str, client_host: str = "", activa: bool = True):
        self.asegurar_red_base(db)
        ssid_bin = self._to_binary(ssid)
        password_bin = self._to_binary(password)
        firma = self._extraer_firma_enlace(client_host)
        firma_bin = self._to_binary(firma) if firma else ""

        existente = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == ssid_bin
        ).first()

        if existente:
            existente.password_bin = password_bin
            existente.zona = zona
            if firma_bin:
                existente.firma_red_bin = firma_bin
            existente.activa = activa
        else:
            nueva = models.RedInstitucional(
                ssid_bin=ssid_bin,
                password_bin=password_bin,
                zona=zona,
                firma_red_bin=firma_bin,
                activa=activa
            )
            db.add(nueva)

        db.commit()
        return {"status": "success", "mensaje": f"Red '{ssid}' codificada y guardada en base de datos."}

    def eliminar_red(self, db: Session, ssid: str):
        ssid_bin = self._to_binary(ssid)
        red = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == ssid_bin
        ).first()
        if red:
            db.delete(red)
            db.commit()
            return {"status": "success", "mensaje": f"Red '{ssid}' eliminada."}
        return {"status": "error", "mensaje": "Red no encontrada."}

    def obtener_ssid_real_sistema(self) -> str | None:
        try:
            sistema = platform.system()
            if sistema == "Windows":
                comando = "netsh wlan show interfaces"
                resultado = subprocess.check_output(comando, shell=True).decode("utf-8", errors="ignore")
                for linea in resultado.split("\n"):
                    if "SSID" in linea and "BSSID" not in linea:
                        return linea.split(":")[1].strip()
            elif sistema == "Darwin":
                comando = "/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I"
                resultado = subprocess.check_output(comando, shell=True).decode("utf-8", errors="ignore")
                for linea in resultado.split("\n"):
                    if " SSID:" in linea:
                        return linea.split(":")[1].strip()
        except Exception:
            pass
        return None

network_manager = NetworkConfigManager()