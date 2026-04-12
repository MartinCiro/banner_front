from fastapi import FastAPI, UploadFile, File, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse
from rembg import remove, new_session
from PIL import Image
import io
import base64
import uvicorn

app = FastAPI(title="BG Remover")
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Carga el modelo una sola vez al iniciar (más rápido en requests siguientes)
session = new_session("u2net")


@app.get("/")
async def editor(request: Request):
    return templates.TemplateResponse("editor.html", {"request": request})


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    try:
        img_bytes = await file.read()

        # Elimina el fondo con rembg
        result_bytes = remove(img_bytes, session=session)

        # Convierte a base64 para enviar al canvas JS
        b64 = base64.b64encode(result_bytes).decode("utf-8")

        return JSONResponse({
            "success": True,
            "image": f"data:image/png;base64,{b64}"
        })

    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/apply-mask")
async def apply_mask(request: Request):
    """
    Recibe la imagen original + la máscara editada manualmente desde el canvas.
    Combina ambas y devuelve el PNG final.
    """
    try:
        body = await request.json()
        original_b64 = body["original"].split(",")[1]
        mask_b64 = body["mask"].split(",")[1]

        original = Image.open(io.BytesIO(base64.b64decode(original_b64))).convert("RGBA")
        mask = Image.open(io.BytesIO(base64.b64decode(mask_b64))).convert("L")

        # Aplica la máscara editada sobre la imagen original
        result = original.copy()
        result.putalpha(mask)

        buf = io.BytesIO()
        result.save(buf, format="PNG")
        buf.seek(0)

        b64 = base64.b64encode(buf.read()).decode("utf-8")
        return JSONResponse({
            "success": True,
            "image": f"data:image/png;base64,{b64}"
        })

    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
