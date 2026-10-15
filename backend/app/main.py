from fastapi import FastAPI

app = FastAPI(title="Control de Asistencia Wi-Fi - TUP API")

@app.get("/")
def home():
    return {"status": "ok", "message": "API de Control de Asistencia activa"}
