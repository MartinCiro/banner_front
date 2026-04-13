from fastapi import FastAPI, UploadFile, File, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from rembg import remove, new_session
from PIL import Image
from io import BytesIO
from base64 import b64encode, b64decode
from numpy import array as np_array, float32, clip, uint8
from uvicorn import run
from traceback import print_exc

app = FastAPI(title="BG Remover")
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

session = new_session("u2net")


@app.get("/")
async def editor(request: Request):
    return templates.TemplateResponse("editor.html", {"request": request})


@app.post("/remove-bg")
async def remove_bg(file: UploadFile = File(...)):
    try:
        img_bytes = await file.read()
        
        result_bytes = remove(img_bytes, session=session)
        
        b64 = b64encode(result_bytes).decode("utf-8")
        return JSONResponse({"success": True, "image": f"data:image/png;base64,{b64}"})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/apply-mask")
async def apply_mask(request: Request):
    """
    Recibe:
      - original: imagen procesada por rembg (RGBA con alpha de rembg)
      - mask:     canvas-mask exportado (RGBA donde R=G=B=valor_mascara, A=255)
    """
    try:        
        body = await request.json()
        
        # Verificar que los datos existen
        if "original" not in body:
            raise ValueError("Falta campo 'original'")
        if "mask" not in body:
            raise ValueError("Falta campo 'mask'")
        
        original_b64 = body["original"].split(",")[1]
        mask_b64 = body["mask"].split(",")[1]
        
        original_bytes = b64decode(original_b64)
        original = Image.open(BytesIO(original_bytes)).convert("RGBA")
        
        mask_bytes = b64decode(mask_b64)
        mask_img = Image.open(BytesIO(mask_bytes)).convert("RGBA")
        
        # Verificar dimensiones
        if original.size != mask_img.size:
            mask_img = mask_img.resize(original.size, Image.Resampling.LANCZOS)
        
        # Convertir a arrays numpy
        mask_arr = np_array(mask_img)
        orig_arr = np_array(original)
        
        # Extraer canal R de la máscara
        mask_r = mask_arr[:, :, 0].astype(float32)
        
        # Alpha original de rembg
        orig_alpha = orig_arr[:, :, 3].astype(float32)
        
        # Alpha final = combinación de ambos
        final_alpha = clip((orig_alpha * mask_r) / 255.0, 0, 255).astype(uint8)
        
        # Reconstruir imagen
        result_arr = orig_arr.copy()
        result_arr[:, :, 3] = final_alpha
        result = Image.fromarray(result_arr, mode="RGBA")
        
        # Guardar resultado
        buf = BytesIO()
        result.save(buf, format="PNG")
        buf.seek(0)
        b64 = b64encode(buf.read()).decode("utf-8")
        
        return JSONResponse({"success": True, "image": f"data:image/png;base64,{b64}"})
        
    except Exception as e:
        print_exc()
        
        return JSONResponse({
            "success": False, 
            "error": str(e),
            "type": type(e).__name__
        }, status_code=500)


if __name__ == "__main__":
    run("main:app", host="0.0.0.0", port=8000, reload=True)