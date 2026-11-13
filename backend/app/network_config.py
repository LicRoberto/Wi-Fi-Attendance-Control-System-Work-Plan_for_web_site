import math
import hashlib
from sqlalchemy.orm import Session
from app import models

class NetworkConfigManager:
    # Red Institucional Oficial TUP codificada en binario: SSID "TUP"
    DEFAULT_SSID_BIN = "010101000101010101010000"
    DEFAULT_PASS_BIN = "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001"
    DEFAULT_ZONA = "Campus Principal TUP - Playacar"

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
        if not client_host:
            return ""
        ip_limpia = client_host.split(",")[0].strip()
        partes = ip_limpia.split(".")
        if len(partes) == 4:
            return ".".join(partes[:2])
        return ip_limpia

    @staticmethod
    def _distancia_metros(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        r = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

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

    def vincular_firma_actual_a_red(
        self, db: Session, ssid: str, client_host: str, lat: float | None = None, lon: float | None = None
    ) -> dict:
        self.asegurar_red_base(db)
        ssid_bin = self._to_binary(ssid)
        red = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == ssid_bin
        ).first()

        if not red:
            return {"status": "error", "mensaje": f"Red '{ssid}' no encontrada"}

        firma = self._extraer_firma_enlace(client_host)
        if lat is not None and lon is not None:
            firma = f"{firma}|GEO:{lat:.5f},{lon:.5f}"

        red.firma_red_bin = self._to_binary(firma) if firma else ""
        red.activa = True
        db.commit()

        geo_msg = " + Perímetro GPS del campus" if (lat is not None and lon is not None) else ""
        return {
            "status": "success",
            "mensaje": f"Red '{ssid}' vinculada exitosamente al enlace Wi-Fi actual{geo_msg}."
        }

    def validar_conexion_dispositivo(
        self,
        db: Session,
        device_id: str,
        client_host: str = "",
        ssid_reportado: str | None = None,
        lat: float | None = None,
        lon: float | None = None,
    ) -> dict:
        self.asegurar_red_base(db)
        if not device_id:
            return {"valida": False, "motivo": "Dispositivo sin identificador"}

        firma_actual = self._extraer_firma_enlace(client_host)
        redes_activas = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.activa == True
        ).all()

        for red in redes_activas:
            ssid_decodificado = self._from_binary(red.ssid_bin)
            firma_guardada_txt = self._from_binary(red.firma_red_bin)

            # Si aún no está calibrada, se vincula automáticamente la primera vez
            if not firma_guardada_txt and firma_actual:
                nueva_firma = f"{firma_actual}|GEO:{lat:.5f},{lon:.5f}" if (lat and lon) else firma_actual
                red.firma_red_bin = self._to_binary(nueva_firma)
                db.commit()
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

            partes_firma = firma_guardada_txt.split("|GEO:")
            ip_guardada = partes_firma[0]
            geo_guardada = partes_firma[1] if len(partes_firma) > 1 else None

            # 1. Validación por Enlace de Red Wi-Fi del Campus
            if ip_guardada and firma_actual == ip_guardada:
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

            # 2. Validación por Perímetro Campus TUP (radio 250m) si cambió la IP del ISP
            if geo_guardada and lat is not None and lon is not None:
                g_lat, g_lon = map(float, geo_guardada.split(","))
                if self._distancia_metros(lat, lon, g_lat, g_lon) <= 250:
                    return {
                        "valida": True,
                        "ssid": ssid_decodificado,
                        "zona": red.zona,
                        "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                    }

        return {
            "valida": False,
            "ssid": "Red Externa",
            "motivo": "Tu dispositivo no está conectado a la red Wi-Fi del campus TUP."
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

    def agregar_o_actualizar_red(
        self, db: Session, ssid: str, password: str, zona: str, client_host: str = "", activa: bool = True
    ):
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
        return {"status": "success", "mensaje": f"Red '{ssid}' codificada y guardada."}

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

network_manager = NetworkConfigManager()