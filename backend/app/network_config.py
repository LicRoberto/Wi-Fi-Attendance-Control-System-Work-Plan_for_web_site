import math
import hashlib
import ipaddress
from sqlalchemy.orm import Session
from app import models


class NetworkConfigManager:
    DEFAULT_SSID_BIN = "010101000101010101010000"  # "TUP"
    DEFAULT_PASS_BIN = "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001"
    DEFAULT_ZONA = "Campus Principal TUP - Playacar"
    # Pre-calibración institucional real del Campus TUP (IP pública + coordenadas de referencia)
    DEFAULT_FIRMA_INICIAL = "189.235.103.80|GEO:20.612850,-87.084620|RAD:250"
    DEFAULT_RADIO_METROS = 250

    # ------------------------------------------------------------------
    # Utilidades
    # ------------------------------------------------------------------
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
        """
        Normaliza la IP pública del cliente a una "firma" comparable.
        - IPv4: la IP exacta.
        - IPv6: los primeros 3 bloques (/48), ya expandida (maneja '::' correctamente).
        - Cualquier cosa que no sea una IP válida -> "" (nunca valida).
        """
        if not client_host:
            return ""
        candidato = client_host.split(",")[0].strip()
        try:
            ip = ipaddress.ip_address(candidato)
        except ValueError:
            return ""
        if isinstance(ip, ipaddress.IPv6Address):
            if ip.ipv4_mapped:
                return str(ip.ipv4_mapped)
            bloques = ip.exploded.split(":")
            return ":".join(bloques[:3])
        return str(ip)

    @staticmethod
    def _distancia_metros(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        r = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # ------------------------------------------------------------------
    # Red base
    # ------------------------------------------------------------------
    def asegurar_red_base(self, db: Session):
        red_tup = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == self.DEFAULT_SSID_BIN
        ).first()
        if not red_tup:
            red_tup = models.RedInstitucional(
                ssid_bin=self.DEFAULT_SSID_BIN,
                password_bin=self.DEFAULT_PASS_BIN,
                zona=self.DEFAULT_ZONA,
                firma_red_bin=self._to_binary(self.DEFAULT_FIRMA_INICIAL),
                activa=True
            )
            db.add(red_tup)
            db.commit()
        elif not red_tup.firma_red_bin:
            red_tup.firma_red_bin = self._to_binary(self.DEFAULT_FIRMA_INICIAL)
            red_tup.activa = True
            db.commit()

    def generar_token_dispositivo(self, device_id: str, ssid_bin: str = "") -> str:
        if not device_id:
            return ""
        ref = ssid_bin or self.DEFAULT_SSID_BIN
        prefijo_red = f"{int(ref[:16], 2):04X}"
        dev_hash = hashlib.sha256(device_id.encode("utf-8", errors="ignore")).hexdigest()[:6].upper()
        return f"TUP-TOK-{prefijo_red}-{dev_hash}"

    def _parsear_firmas_guardadas(self, firma_txt: str) -> tuple[list[str], str | None, int]:
        if not firma_txt:
            return [], None, self.DEFAULT_RADIO_METROS
        radio = self.DEFAULT_RADIO_METROS
        texto_base = firma_txt
        if "|RAD:" in texto_base:
            texto_base, rad_str = texto_base.split("|RAD:", 1)
            try:
                radio = int(rad_str.strip())
            except ValueError:
                radio = self.DEFAULT_RADIO_METROS

        partes = texto_base.split("|GEO:")
        ips = [ip.strip() for ip in partes[0].split(";") if ip.strip()]
        geo = partes[1].strip() if len(partes) > 1 and partes[1].strip() else None
        return ips, geo, radio

    # ------------------------------------------------------------------
    # Administración (el acceso a estos métodos lo protege main.py)
    # ------------------------------------------------------------------
    def vincular_firma_actual_a_red(
        self,
        db: Session,
        ssid: str,
        client_host: str,
        lat: float | None = None,
        lon: float | None = None,
        radio_metros: int | None = None,
    ) -> dict:
        self.asegurar_red_base(db)
        ssid_bin = self._to_binary(ssid)
        red = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.ssid_bin == ssid_bin
        ).first()

        if not red:
            return {"status": "error", "mensaje": f"Red '{ssid}' no encontrada"}

        firma_nueva = self._extraer_firma_enlace(client_host)
        if not firma_nueva:
            return {
                "status": "error",
                "mensaje": "No se pudo determinar una IP pública válida para vincular."
            }

        ips_existentes, geo_existente, radio_existente = self._parsear_firmas_guardadas(
            self._from_binary(red.firma_red_bin)
        )

        if firma_nueva not in ips_existentes:
            ips_existentes.append(firma_nueva)

        geo_final = f"{lat:.6f},{lon:.6f}" if (lat is not None and lon is not None) else geo_existente
        radio_final = radio_metros if (radio_metros and radio_metros >= 20) else radio_existente

        serializado = ";".join(ips_existentes)
        if geo_final:
            serializado = f"{serializado}|GEO:{geo_final}"
        serializado = f"{serializado}|RAD:{radio_final}"

        red.firma_red_bin = self._to_binary(serializado)
        red.activa = True
        db.commit()

        return {
            "status": "success",
            "mensaje": f"Calibrado en '{ssid}': IP pública '{firma_nueva}' vinculada.",
            "enlaces_vinculados": ips_existentes,
            "firma_detectada": firma_nueva,
            "radio_metros": radio_final
        }

    def limpiar_vinculacion_red(self, db: Session, ssid: str) -> dict:
        """
        Quita TODAS las IPs vinculadas. A propósito queda sin ninguna IP:
        nadie valida hasta volver a vincular desde el campus (falla cerrada).
        """
        redes = db.query(models.RedInstitucional).all()
        for r in redes:
            if self._from_binary(r.ssid_bin) == ssid or ssid == "ALL":
                r.firma_red_bin = self._to_binary(
                    f"|GEO:20.612850,-87.084620|RAD:{self.DEFAULT_RADIO_METROS}"
                )
        db.commit()
        return {
            "status": "success",
            "mensaje": f"Enlaces IP de '{ssid}' reiniciados. Vincula la red desde el campus para reactivar la validación."
        }

    # ------------------------------------------------------------------
    # Validación (EL punto de decisión)
    # ------------------------------------------------------------------
    def validar_conexion_dispositivo(
        self,
        db: Session,
        device_id: str,
        client_host: str = "",
        ssid_reportado: str | None = None,
        lat: float | None = None,
        lon: float | None = None,
    ) -> dict:
        """
        Regla: la asistencia solo es válida si la IP pública con la que el servidor ve
        al cliente coincide con una IP vinculada a una red institucional activa.

        - El GPS (lat/lon) lo envía el cliente y es falsificable: se usa SOLO como dato
          informativo (distancia), NUNCA concede validez.
        - ssid_reportado se ignora: un navegador no puede leer el SSID y el valor es falsificable.
        """
        self.asegurar_red_base(db)
        if not device_id:
            return {"valida": False, "motivo": "Dispositivo sin identificador"}

        firma_actual = self._extraer_firma_enlace(client_host)
        redes_activas = db.query(models.RedInstitucional).filter(
            models.RedInstitucional.activa == True  # noqa: E712
        ).all()

        distancia_reportada = None

        for red in redes_activas:
            ips_guardadas, geo_guardada, radio_metros = self._parsear_firmas_guardadas(
                self._from_binary(red.firma_red_bin)
            )

            if geo_guardada and lat is not None and lon is not None:
                try:
                    g_lat, g_lon = map(float, geo_guardada.split(","))
                    distancia_reportada = int(self._distancia_metros(lat, lon, g_lat, g_lon))
                except ValueError:
                    pass

            if firma_actual and firma_actual in ips_guardadas:
                return {
                    "valida": True,
                    "ssid": self._from_binary(red.ssid_bin),
                    "zona": red.zona,
                    "firma_actual": firma_actual,
                    "distancia_metros": distancia_reportada,
                    "radio_metros": radio_metros,
                    "metodo_validacion": "RED_INSTITUCIONAL_TUP",
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

        return {
            "valida": False,
            "ssid": "Fuera de Campus",
            "firma_actual": firma_actual,
            "distancia_metros": distancia_reportada,
            "motivo": "No estás conectado a la red Wi-Fi del campus TUP."
        }

    def obtener_redes_decodificadas(self, db: Session, client_host: str = ""):
        self.asegurar_red_base(db)
        firma_actual = self._extraer_firma_enlace(client_host)
        redes = db.query(models.RedInstitucional).all()
        resultado = []
        for r in redes:
            ips, geo, radio = self._parsear_firmas_guardadas(self._from_binary(r.firma_red_bin))
            resultado.append({
                "ssid": self._from_binary(r.ssid_bin),
                # La contraseña del Wi-Fi ya NO se devuelve por la API.
                "zona": r.zona,
                "activa": r.activa,
                "calibrada": bool(ips),
                "enlaces_vinculados": ips,
                "tiene_geo": bool(geo),
                "coordenadas_campus": geo,
                "radio_metros": radio,
                "firma_actual_cliente": firma_actual,
                "coincide_actual": firma_actual in ips if firma_actual else False
            })
        return resultado

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
        return {"status": "success", "mensaje": f"Red '{ssid}' guardada."}

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
