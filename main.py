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
        print(f"❌ Error en remove-bg: {str(e)}")
        print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/apply-mask")
async def apply_mask(request: Request):
    """
    Recibe:
      - original: imagen procesada por rembg (RGBA con alpha de rembg)
      - mask:     canvas-mask exportado (RGBA donde R=G=B=valor_mascara, A=255)
    """
    try:
        print("\n" + "="*50)
        print("🎨 Iniciando /apply-mask")
        print("="*50)
        
        body = await request.json()
        print(f"✓ Body recibido. Keys: {list(body.keys())}")
        
        # Verificar que los datos existen
        if "original" not in body:
            raise ValueError("Falta campo 'original'")
        if "mask" not in body:
            raise ValueError("Falta campo 'mask'")
        
        original_b64 = body["original"].split(",")[1]
        mask_b64 = body["mask"].split(",")[1]
        
        print(f"✓ Base64 extraído. Original length: {len(original_b64)}, Mask length: {len(mask_b64)}")
        
        # Decodificar imágenes
        print("📥 Decodificando imagen original...")
        original_bytes = b64decode(original_b64)
        original = Image.open(BytesIO(original_bytes)).convert("RGBA")
        print(f"  ✓ Original: {original.size} {original.mode}")
        
        print("📥 Decodificando máscara...")
        mask_bytes = b64decode(mask_b64)
        mask_img = Image.open(BytesIO(mask_bytes)).convert("RGBA")
        print(f"  ✓ Máscara: {mask_img.size} {mask_img.mode}")
        
        # Verificar dimensiones
        if original.size != mask_img.size:
            print(f"⚠️ Dimensiones diferentes! Original: {original.size}, Mask: {mask_img.size}")
            print("  → Redimensionando máscara...")
            mask_img = mask_img.resize(original.size, Image.Resampling.LANCZOS)
            print(f"  ✓ Máscara redimensionada a {mask_img.size}")
        
        # Convertir a arrays numpy
        print("🔄 Convirtiendo a arrays numpy...")
        mask_arr = np_array(mask_img)
        orig_arr = np_array(original)
        
        print(f"  ✓ Mask array shape: {mask_arr.shape}, dtype: {mask_arr.dtype}")
        print(f"  ✓ Original array shape: {orig_arr.shape}, dtype: {orig_arr.dtype}")
        
        # Extraer canal R de la máscara
        mask_r = mask_arr[:, :, 0].astype(float32)
        print(f"  ✓ Máscara R - min: {mask_r.min():.1f}, max: {mask_r.max():.1f}, mean: {mask_r.mean():.2f}")
        
        # Alpha original de rembg
        orig_alpha = orig_arr[:, :, 3].astype(float32)
        print(f"  ✓ Alpha original - min: {orig_alpha.min():.1f}, max: {orig_alpha.max():.1f}, mean: {orig_alpha.mean():.2f}")
        
        # Alpha final = combinación de ambos
        print("🔧 Calculando alpha final...")
        final_alpha = clip((orig_alpha * mask_r) / 255.0, 0, 255).astype(uint8)
        print(f"  ✓ Alpha final - min: {final_alpha.min()}, max: {final_alpha.max()}, mean: {final_alpha.mean():.2f}")
        
        # Reconstruir imagen
        print("🖼️ Reconstruyendo imagen final...")
        result_arr = orig_arr.copy()
        result_arr[:, :, 3] = final_alpha
        result = Image.fromarray(result_arr, mode="RGBA")
        
        # Guardar resultado
        print("💾 Codificando resultado...")
        buf = BytesIO()
        result.save(buf, format="PNG")
        buf.seek(0)
        b64 = b64encode(buf.read()).decode("utf-8")
        
        print("✅ ¡Máscara aplicada exitosamente!")
        print("="*50 + "\n")
        
        return JSONResponse({"success": True, "image": f"data:image/png;base64,{b64}"})
        
    except Exception as e:
        print("\n" + "!"*50)
        print(f"❌ ERROR EN /apply-mask: {str(e)}")
        print("!"*50)
        print("Traceback completo:")
        print_exc()
        print("!"*50 + "\n")
        
        return JSONResponse({
            "success": False, 
            "error": str(e),
            "type": type(e).__name__
        }, status_code=500)


if __name__ == "__main__":
    print("🚀 Iniciando servidor BG Remover...")
    print("📍 http://localhost:8000")
    run("main:app", host="0.0.0.0", port=8000, reload=True)