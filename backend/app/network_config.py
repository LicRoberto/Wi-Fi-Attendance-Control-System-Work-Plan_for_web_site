class NetworkConfigManager:
    def __init__(self):
        # Única Red Institucional: SSID: "TUP" | Password: "tecplayacar2019"
        self._redes_bin = {
            "010101000101010101010000": {
                "password_bin": "011101000110010101100011011100000110110001100001011110010110000101100011011000010111001000110010001100000011000100111001",
                "zona": "Campus Principal TUP - Aulas",
                "activa": True
            }
        }

    @staticmethod
    def _to_binary(text: str) -> str:
        return "".join(format(ord(c), '08b') for c in text)

    @staticmethod
    def _from_binary(binary_str: str) -> str:
        chars = [binary_str[i:i+8] for i in range(0, len(binary_str), 8)]
        return "".join(chr(int(c, 2)) for c in chars)

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

    def es_red_valida(self, ssid: str) -> bool:
        ssid_bin = self._to_binary(ssid)
        return ssid_bin in self._redes_bin and self._redes_bin[ssid_bin]["activa"]

network_manager = NetworkConfigManager()