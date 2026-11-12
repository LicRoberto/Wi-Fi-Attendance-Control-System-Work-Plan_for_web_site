import subprocess
import platform
import hashlib

class NetworkConfigManager:
    def __init__(self):
        # Única Red Institucional Oficial TUP codificada en binario: SSID "TUP"
        self._redes_bin = {
            "010101000101010101010000": {
                "password_bin": "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001",
                "zona": "Campus Principal TUP - Aulas",
                "firma_red_bin": "",  # Se vincula automáticamente desde el campus sin hardcodear IPs
                "activa": True
            }
        }

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
    def _extraer_prefijo_salida(client_host: str) -> str:
        """Extrae el bloque de salida de red (subred /24) del router sin almacenar IPs fijas en código"""
        if not client_host:
            return ""
        ip_limpia = client_host.split(",")[0].strip()
        partes = ip_limpia.split(".")
        if len(partes) == 4:
            return ".".join(partes[:3])  # Subred del enlace institucional
        return ip_limpia

    def generar_token_dispositivo(self, device_id: str) -> str:
        if not device_id:
            return ""
        redes_activas = [ssid_bin for ssid_bin, data in self._redes_bin.items() if data["activa"]]
        prefijo_red = f"{int(redes_activas[0][:16], 2):04X}" if redes_activas else "0000"
        dev_hash = hashlib.sha256(device_id.encode("utf-8", errors="ignore")).hexdigest()[:6].upper()
        return f"TUP-TOK-{prefijo_red}-{dev_hash}"

    def vincular_firma_actual_a_red(self, ssid: str, client_host: str) -> dict:
        """El Admin captura la firma de la red Wi-Fi actual desde el campus con 1 clic"""
        ssid_bin = self._to_binary(ssid)
        if ssid_bin not in self._redes_bin:
            return {"status": "error", "mensaje": "Red no encontrada"}
        
        prefijo = self._extraer_prefijo_salida(client_host)
        self._redes_bin[ssid_bin]["firma_red_bin"] = self._to_binary(prefijo)
        self._redes_bin[ssid_bin]["activa"] = True
        return {
            "status": "success",
            "mensaje": f"Red '{ssid}' vinculada exitosamente al enlace Wi-Fi actual del campus."
        }

    def validar_conexion_dispositivo(self, device_id: str, client_host: str = "", ssid_reportado: str | None = None) -> dict:
        if not device_id:
            return {"valida": False, "motivo": "Dispositivo sin identificador"}

        prefijo_actual = self._extraer_prefijo_salida(client_host)
        prefijo_actual_bin = self._to_binary(prefijo_actual)

        for ssid_bin, data in self._redes_bin.items():
            if not data["activa"]:
                continue

            ssid_decodificado = self._from_binary(ssid_bin)
            firma_guardada = data.get("firma_red_bin", "")

            # 1. Si el sistema local detectó el SSID exacto
            if ssid_reportado and self._to_binary(ssid_reportado) == ssid_bin:
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": data["zona"],
                    "token_red": self.generar_token_dispositivo(device_id)
                }

            # 2. Si la red institucional ya tiene firma vinculada, exigir coincidencia real
            if firma_guardada:
                if prefijo_actual_bin == firma_guardada:
                    return {
                        "valida": True,
                        "ssid": ssid_decodificado,
                        "zona": data["zona"],
                        "token_red": self.generar_token_dispositivo(device_id)
                    }
            else:
                # Si aún no se ha calibrado ninguna firma desde el campus, avisar que falta calibrar
                return {
                    "valida": False,
                    "motivo": "Red TUP pendiente de calibrar desde el panel Admin en el campus."
                }

        return {
            "valida": False,
            "motivo": "El dispositivo no está conectado a la red Wi-Fi institucional del TUP."
        }

    def obtener_redes_decodificadas(self):
        redes = []
        for ssid_bin, data in self._redes_bin.items():
            redes.append({
                "ssid": self._from_binary(ssid_bin),
                "password": self._from_binary(data["password_bin"]),
                "zona": data["zona"],
                "activa": data["activa"],
                "calibrada": bool(data.get("firma_red_bin"))
            })
        return redes

    def agregar_o_actualizar_red(self, ssid: str, password: str, zona: str, client_host: str = "", activa: bool = True):
        ssid_bin = self._to_binary(ssid)
        password_bin = self._to_binary(password)
        prefijo = self._extraer_prefijo_salida(client_host)

        self._redes_bin[ssid_bin] = {
            "password_bin": password_bin,
            "zona": zona,
            "firma_red_bin": self._to_binary(prefijo) if prefijo else "",
            "activa": activa
        }
        return {"status": "success", "mensaje": f"Red '{ssid}' codificada y vinculada correctamente."}

    def eliminar_red(self, ssid: str):
        ssid_bin = self._to_binary(ssid)
        if ssid_bin in self._redes_bin:
            del self._redes_bin[ssid_bin]
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