import math
import hashlib
from sqlalchemy.orm import Session
from app import models

class NetworkConfigManager:
    DEFAULT_SSID_BIN = "010101000101010101010000"  # "TUP"
    DEFAULT_PASS_BIN = "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001"
    DEFAULT_ZONA = "Campus Principal TUP - Playacar"
    DEFAULT_RADIO_METROS = 120

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
        ip_limpia = client_host.split(",")[0].strip().lower()
        if ":" in ip_limpia:
            bloques = [b for b in ip_limpia.split(":") if b]
            return ":".join(bloques[:3])
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
        ips_existentes, geo_existente, radio_existente = self._parsear_firmas_guardadas(
            self._from_binary(red.firma_red_bin)
        )

        if firma_nueva and firma_nueva not in ips_existentes:
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

        geo_msg = f" + Geocerca ({geo_final}, radio {radio_final}m)" if geo_final else " (Sin coordenadas GPS)"
        return {
            "status": "success",
            "mensaje": f"Calibrado en '{ssid}': IP '{firma_nueva}'{geo_msg}.",
            "enlaces_vinculados": ips_existentes,
            "firma_detectada": firma_nueva,
            "radio_metros": radio_final
        }

    def limpiar_vinculacion_red(self, db: Session, ssid: str) -> dict:
        redes = db.query(models.RedInstitucional).all()
        for r in redes:
            if self._from_binary(r.ssid_bin) == ssid or ssid == "ALL":
                r.firma_red_bin = ""
        db.commit()
        return {"status": "success", "mensaje": f"Calibración de '{ssid}' limpiada."}

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

        alguna_calibrada = False
        distancia_reportada = None

        for red in redes_activas:
            ssid_decodificado = self._from_binary(red.ssid_bin)
            firma_guardada_txt = self._from_binary(red.firma_red_bin)
            ips_guardadas, geo_guardada, radio_metros = self._parsear_firmas_guardadas(firma_guardada_txt)

            if not ips_guardadas and not geo_guardada:
                continue

            alguna_calibrada = True
            ip_coincide = bool(firma_actual and firma_actual in ips_guardadas)
            en_rango_gps = False

            if geo_guardada and lat is not None and lon is not None:
                g_lat, g_lon = map(float, geo_guardada.split(","))
                distancia = int(self._distancia_metros(lat, lon, g_lat, g_lon))
                distancia_reportada = distancia
                en_rango_gps = distancia <= radio_metros

            # Caso 1: IP institucional + dentro del rango (o sin GPS calibrado aún)
            if ip_coincide and (en_rango_gps or not geo_guardada):
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "firma_actual": firma_actual,
                    "distancia_metros": distancia_reportada,
                    "radio_metros": radio_metros,
                    "metodo_validacion": "RED_Y_PERIMETRO_TUP",
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

            # Caso 2: Físicamente dentro del radio institucional configurado en Admin
            if geo_guardada and en_rango_gps:
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": red.zona,
                    "firma_actual": firma_actual,
                    "distancia_metros": distancia_reportada,
                    "radio_metros": radio_metros,
                    "metodo_validacion": f"PERIMETRO_TUP_{distancia_reportada}M",
                    "token_red": self.generar_token_dispositivo(device_id, red.ssid_bin)
                }

        if not alguna_calibrada:
            return {
                "valida": False,
                "ssid": "Sin calibrar",
                "firma_actual": firma_actual,
                "motivo": "El Administrador aún no ha calibrado el perímetro/red del campus."
            }

        detalle_dist = f" a {distancia_reportada}m del campus" if distancia_reportada is not None else " (GPS no autorizado)"
        return {
            "valida": False,
            "ssid": "Fuera de Campus",
            "firma_actual": firma_actual,
            "distancia_metros": distancia_reportada,
            "motivo": f"Fuera de rango institucional{detalle_dist} (IP: {firma_actual})."
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
                "password": self._from_binary(r.password_bin),
                "zona": r.zona,
                "activa": r.activa,
                "calibrada": bool(ips or geo),
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