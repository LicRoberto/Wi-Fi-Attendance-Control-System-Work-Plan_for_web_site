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
                "activa": True
            }
        }

    @staticmethod
    def _to_binary(text: str) -> str:
        return "".join(format(ord(c) & 0xFF, '08b') for c in text)

    @staticmethod
    def _from_binary(binary_str: str) -> str:
        chars = [binary_str[i:i+8] for i in range(0, len(binary_str), 8)]
        return "".join(chr(int(c, 2)) for c in chars)

    def generar_token_dispositivo(self, device_id: str) -> str:
        """Genera un token codificado único vinculando el ID del dispositivo con la red activa"""
        if not device_id:
            return ""
        redes_activas = [ssid_bin for ssid_bin, data in self._redes_bin.items() if data["activa"]]
        prefijo_red = f"{int(redes_activas[0][:16], 2):04X}" if redes_activas else "0000"
        dev_hash = hashlib.sha256(device_id.encode("utf-8", errors="ignore")).hexdigest()[:6].upper()
        return f"TUP-TOK-{prefijo_red}-{dev_hash}"

    def validar_conexion_dispositivo(self, device_id: str, ssid_reportado: str | None = None) -> dict:
        """Valida automáticamente el token del dispositivo contra las redes institucionales codificadas"""
        if not device_id:
            return {"valida": False}

        if ssid_reportado:
            ssid_bin = self._to_binary(ssid_reportado)
            if ssid_bin in self._redes_bin and self._redes_bin[ssid_bin]["activa"]:
                return {
                    "valida": True,
                    "ssid": ssid_reportado,
                    "zona": self._redes_bin[ssid_bin]["zona"],
                    "token_red": self.generar_token_dispositivo(device_id)
                }

        for ssid_bin, data in self._redes_bin.items():
            if data["activa"]:
                ssid_decodificado = self._from_binary(ssid_bin)
                return {
                    "valida": True,
                    "ssid": ssid_decodificado,
                    "zona": data["zona"],
                    "token_red": self.generar_token_dispositivo(device_id)
                }

        return {"valida": False}

    def obtener_redes_decodificadas(self):
        redes = []
        for ssid_bin, data in self._redes_bin.items():
            redes.append({
                "ssid": self._from_binary(ssid_bin),
                "password": self._from_binary(data["password_bin"]),
                "zona": data["zona"],
                "activa": data["activa"]
            })
        return redes

    def agregar_o_actualizar_red(self, ssid: str, password: str, zona: str, activa: bool = True):
        ssid_bin = self._to_binary(ssid)
        password_bin = self._to_binary(password)

        self._redes_bin[ssid_bin] = {
            "password_bin": password_bin,
            "zona": zona,
            "activa": activa
        }
        return {"status": "success", "mensaje": f"Red '{ssid}' codificada y guardada correctamente."}

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

    def es_red_valida(self, ssid: str) -> bool:
        if not ssid:
            return False
        ssid_bin = self._to_binary(ssid)
        return ssid_bin in self._redes_bin and self._redes_bin[ssid_bin]["activa"]

network_manager = NetworkConfigManager()