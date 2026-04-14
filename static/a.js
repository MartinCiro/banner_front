/**
 * MaskEditor v2.0 - Manipulación de máscaras en Canvas
 * Encapsulado, optimizado con TypedArrays y kernels matriciales.
 * Sin variables globales. API inmutable desde el frontend.
 */
const MaskEditor = (function() {
  'use strict';

  // 🔹 CONSTANTES PRIVADAS EN CLOSURE (Opción A)
  // Son accesibles dentro de esta función, pero invisibles fuera del IIFE.
  const MAX_PX = 900;
  const HISTORY_LIMIT = 30;
  const BRUSH_PRECOMPUTE_SIZES = [10, 20, 30, 40, 50, 75, 100];
  const BRUSH_PRECOMPUTE_OPACITIES = [0.25, 0.5, 0.75, 1.0];

  class MaskEditor {
    // 🔹 CAMPOS PRIVADOS DE INSTANCIA
    #state;
    #canvas;
    #ctx;
    #brushKernel;
    #history;
    #eventHandlers;
    #callbacks;

    constructor(config) {
      if (!config?.originalCanvas || !config?.maskCanvas || !config?.mainCanvas) {
        throw new Error('MaskEditor: Se requieren los 3 canvas en la configuración');
      }

      // Estado interno (mutable solo dentro de la clase)
      this.#state = {
        file: null, processedDataUrl: null, isProcessed: false,
        tool: 'erase', brushSize: 30, brushOpacity: 1.0,
        showMask: false, previewBg: 'transparent', painting: false, W: 0, H: 0
      };

      this.#canvas = {
        original: config.originalCanvas,
        mask: config.maskCanvas,
        main: config.mainCanvas,
        cursor: config.brushCursor || null
      };

      this.#ctx = {
        original: this.#canvas.original.getContext('2d', { willReadFrequently: true }),
        mask: this.#canvas.mask.getContext('2d', { willReadFrequently: true }),
        main: this.#canvas.main.getContext('2d', { willReadFrequently: true })
      };

      this.#history = { stack: [], index: -1 };
      this.#brushKernel = new Map();
      this.#eventHandlers = new Map();
      
      // Callbacks opcionales para UI externa
      this.#callbacks = config.callbacks || {};

      this.#precomputeBrushKernels();
      this.#setupEventListeners();
    }

    // ───────────────────────────────────────────────────────────
    //  MÉTODOS PRIVADOS (#)
    // ───────────────────────────────────────────────────────────

    /** Precomputa kernels de pincel como matrices Uint8ClampedArray */
    #precomputeBrushKernels() {
      for (const size of BRUSH_PRECOMPUTE_SIZES) {
        for (const opacity of BRUSH_PRECOMPUTE_OPACITIES) {
          const key = `${size}_${opacity}`;
          const radius = size / 2;
          const kSize = Math.ceil(radius) * 2 + 1;
          const kernel = new Uint8ClampedArray(kSize * kSize);

          for (let y = 0; y < kSize; y++) {
            for (let x = 0; x < kSize; x++) {
              const dx = x - radius, dy = y - radius;
              const dist = Math.sqrt(dx*dx + dy*dy) / radius;
              let val;
              if (dist <= 0.7) val = Math.round(255 * opacity * (1 - dist * 0.3));
              else if (dist <= 1) val = Math.round(255 * opacity * 0.85 * (1 - (dist - 0.7) / 0.3));
              else val = 0;
              kernel[y * kSize + x] = val;
            }
          }
          this.#brushKernel.set(key, { kernel, size: kSize, radius });
        }
      }
    }

    /** Aplica el pincel usando convolución matricial sobre la máscara */
    #applyBrushMatrix(cx, cy, tool) {
      const { W, H, brushSize, brushOpacity } = this.#state;
      const key = `${brushSize}_${brushOpacity}`;
      const kData = this.#brushKernel.get(key) || this.#brushKernel.get('30_1');
      if (!kData) return;

      const { kernel, size: kSize, radius } = kData;
      const maskImg = this.#ctx.mask.getImageData(0, 0, W, H);
      const data = maskImg.data;
      const target = tool === 'erase' ? 0 : 255;

      const startX = Math.max(0, Math.floor(cx - radius));
      const endX = Math.min(W, Math.ceil(cx + radius));
      const startY = Math.max(0, Math.floor(cy - radius));
      const endY = Math.min(H, Math.ceil(cy + radius));

      // Operación vectorizada sobre píxeles
      for (let y = startY; y < endY; y++) {
        const ky = Math.floor(y - (cy - radius));
        if (ky < 0 || ky >= kSize) continue;
        for (let x = startX; x < endX; x++) {
          const kx = Math.floor(x - (cx - radius));
          if (kx < 0 || kx >= kSize) continue;
          
          const idx = (y * W + x) * 4;
          const kVal = kernel[ky * kSize + kx];
          if (kVal === 0) continue;

          const current = data[idx];
          const delta = target - current;
          const factor = kVal / 255;
          const newVal = Math.round(current + delta * factor);
          data[idx] = newVal; data[idx+1] = newVal; data[idx+2] = newVal;
        }
      }
      this.#ctx.mask.putImageData(maskImg, 0, 0);
      this.#renderComposite();
    }

    /** Renderizado optimizado con composición de canales */
    #renderComposite() {
      const { W, H, isProcessed, previewBg, showMask } = this.#state;
      const mainCtx = this.#ctx.main;
      mainCtx.clearRect(0, 0, W, H);

      if (previewBg !== 'transparent') {
        mainCtx.fillStyle = previewBg;
        mainCtx.fillRect(0, 0, W, H);
      }

      const orig = this.#ctx.original.getImageData(0, 0, W, H).data;
      const mask = this.#ctx.mask.getImageData(0, 0, W, H).data;
      const out = mainCtx.createImageData(W, H);
      const outData = out.data;

      // Loop vectorizado
      for (let i = 0; i < orig.length; i += 4) {
        outData[i]   = orig[i];
        outData[i+1] = orig[i+1];
        outData[i+2] = orig[i+2];
        if (isProcessed) {
          outData[i+3] = (orig[i+3] * mask[i] / 255) | 0; // Alpha compuesto
        } else {
          outData[i+3] = mask[i]; // Máscara controla alpha directamente
        }
      }
      mainCtx.putImageData(out, 0, 0);

      if (showMask) {
        mainCtx.save(); mainCtx.globalAlpha = 0.45;
        mainCtx.drawImage(this.#canvas.mask, 0, 0);
        mainCtx.restore();
      }
    }

    /** Conversión de coordenadas pantalla → canvas */
    #screenToCanvas(clientX, clientY) {
      const rect = this.#canvas.main.getBoundingClientRect();
      const sx = this.#state.W / rect.width;
      const sy = this.#state.H / rect.height;
      return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
    }

    /** Historial: snapshot optimizado con TypedArray */
    #pushHistory() {
      const { W, H } = this.#state;
      if (W === 0) return;

      const originalData = this.#ctx.mask.getImageData(0, 0, W, H);
      // Crear nuevo ImageData en lugar de modificar el existente
      const snapshot = new ImageData(
        new Uint8ClampedArray(originalData.data), // Clonar los datos
        W,
        H
      );

      if (this.#history.index < this.#history.stack.length - 1) {
        this.#history.stack = this.#history.stack.slice(0, this.#history.index + 1);
      }
      this.#history.stack.push(snapshot);
      this.#history.index++;

      if (this.#history.stack.length > HISTORY_LIMIT) {
        this.#history.stack.shift();
      }
    }

    /** Setup de listeners con cleanup automático */
    #setupEventListeners() {
      const handlers = {};
      
      handlers.mouseMove = (e) => {
        if (this.#state.painting) {
          const pos = this.#screenToCanvas(e.clientX, e.clientY);
          this.#applyBrushMatrix(pos.x, pos.y, this.#state.tool);
        }
        this.#updateCursor(e.clientX, e.clientY);
      };

      handlers.mouseEnter = (e) => {
          const pos = this.#screenToCanvas(e.clientX, e.clientY);
          this.#updateCursor(pos.clientX, pos.clientY);  
      };
      

      handlers.mouseDown = (e) => {
        e.preventDefault();
        this.#state.painting = true;
        const pos = this.#screenToCanvas(e.clientX, e.clientY);
        this.#applyBrushMatrix(pos.x, pos.y, this.#state.tool);
      };
      handlers.mouseUp = () => {
        if (this.#state.painting) { this.#state.painting = false; this.#pushHistory(); }
      };
      handlers.touchStart = (e) => {
        e.preventDefault(); this.#state.painting = true;
        const t = e.touches[0]; const pos = this.#screenToCanvas(t.clientX, t.clientY);
        this.#applyBrushMatrix(pos.x, pos.y, this.#state.tool);
      };
      handlers.touchMove = (e) => {
        e.preventDefault();
        if (this.#state.painting) {
          const t = e.touches[0]; const pos = this.#screenToCanvas(t.clientX, t.clientY);
          this.#applyBrushMatrix(pos.x, pos.y, this.#state.tool);
        }
      };
      handlers.touchEnd = () => { this.#state.painting = false; this.#pushHistory(); };
      handlers.keyDown = (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.#undo(); }
        else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.#redo(); }
        else if (e.key.toLowerCase() === 'e') this.#setTool('erase');
        else if (e.key.toLowerCase() === 'a') this.#setTool('add');
      };

      this.#canvas.main.addEventListener('mousemove', handlers.mouseMove);
      this.#canvas.main.addEventListener('mousedown', handlers.mouseDown);
      document.addEventListener('mouseup', handlers.mouseUp);
      this.#canvas.main.addEventListener('touchstart', handlers.touchStart, { passive: false });
      this.#canvas.main.addEventListener('touchmove', handlers.touchMove, { passive: false });
      this.#canvas.main.addEventListener('touchend', handlers.touchEnd);
      this.#canvas.main.addEventListener('mouseenter', handlers.mouseEnter);
      document.addEventListener('keydown', handlers.keyDown);

      this.#eventHandlers.set('cleanup', () => {
        this.#canvas.main.removeEventListener('mousemove', handlers.mouseMove);
        this.#canvas.main.removeEventListener('mousedown', handlers.mouseDown);
        document.removeEventListener('mouseup', handlers.mouseUp);
        this.#canvas.main.removeEventListener('touchstart', handlers.touchStart);
        this.#canvas.main.removeEventListener('touchmove', handlers.touchMove);
        this.#canvas.main.removeEventListener('touchend', handlers.touchEnd);
        document.removeEventListener('keydown', handlers.keyDown);
      });
    }

    #updateCursor(clientX, clientY) {
      if (!this.#canvas.cursor) return;
      const { brushSize, tool } = this.#state;
      const c = this.#canvas.cursor;
      
      // Posición y tamaño
      c.style.left = `${clientX - brushSize/2}px`;
      c.style.top = `${clientY - brushSize/2}px`;
      c.style.width = `${brushSize}px`;
      c.style.height = `${brushSize}px`;
      
      c.classList.toggle('erase', tool === 'erase');
      c.classList.toggle('add', tool === 'add');
      
      if (tool === 'erase') {
        c.style.borderColor = '#ef4444';
        c.style.background = 'rgba(239, 68, 68, 0.15)';
      } else {
        c.style.borderColor = '#00c896';
        c.style.background = 'rgba(0, 200, 150, 0.15)';
      }
    }

    #undo() {
      if (this.#history.index > 0) {
        this.#history.index--;
        const s = this.#history.stack[this.#history.index];
        // Verificar que s sea ImageData válido
        if (s && s.data) {
          this.#ctx.mask.putImageData(s, 0, 0);
          this.#renderComposite();
        }
      }
    }

    #redo() {
      if (this.#history.index < this.#history.stack.length - 1) {
        this.#history.index++;
        const s = this.#history.stack[this.#history.index];
        if (s && s.data) {
          this.#ctx.mask.putImageData(s, 0, 0);
          this.#renderComposite();
        }
      }
    }

    #setTool(tool) {
      if (!['erase', 'add'].includes(tool)) return;
      this.#state.tool = tool;
      // Actualizar UI externa si existe callback
      if (this.#callbacks.onToolChange) this.#callbacks.onToolChange(tool);
    }

    #buildCanvases(img, processed) {
      const { naturalWidth, naturalHeight } = img;
      const scale = Math.min(1, MAX_PX / Math.max(naturalWidth, naturalHeight));
      
      this.#state.W = Math.round(naturalWidth * scale);
      this.#state.H = Math.round(naturalHeight * scale);

      [this.#canvas.original, this.#canvas.mask, this.#canvas.main].forEach(c => {
        c.width = this.#state.W; c.height = this.#state.H;
      });

      this.#ctx.original.clearRect(0, 0, this.#state.W, this.#state.H);
      this.#ctx.original.drawImage(img, 0, 0, this.#state.W, this.#state.H);

      const maskImg = this.#ctx.mask.createImageData(this.#state.W, this.#state.H);
      const data = maskImg.data;

      if (processed) {
        const orig = this.#ctx.original.getImageData(0, 0, this.#state.W, this.#state.H).data;
        for (let i = 0; i < data.length; i += 4) {
          const a = orig[i+3];
          data[i] = data[i+1] = data[i+2] = a;
          data[i+3] = 255;
        }
      } else {
        data.fill(255);
      }
      this.#ctx.mask.putImageData(maskImg, 0, 0);

      this.#history.stack = []; this.#history.index = -1;
      this.#pushHistory();
      this.#renderComposite();
      if (this.#callbacks.onImageReady) this.#callbacks.onImageReady(processed);
    }

    // ───────────────────────────────────────────────────────────
    //  MÉTODOS PÚBLICOS (API CONTROLADA)
    // ───────────────────────────────────────────────────────────

    async loadImage(source, isProcessed = false) {
      const img = await new Promise((resolve, reject) => {
        const i = new Image(); i.onload = () => resolve(i); i.onerror = reject;
        i.src = source instanceof File ? URL.createObjectURL(source) : source;
      });
      this.#buildCanvases(img, isProcessed);
    }

    getMaskDataUrl() {
      const { W, H } = this.#state;
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      const ctx = tmp.getContext('2d');
      const mask = this.#ctx.mask.getImageData(0, 0, W, H).data;
      const out = ctx.createImageData(W, H); const o = out.data;
      for (let i = 0; i < mask.length; i += 4) {
        o[i] = o[i+1] = o[i+2] = mask[i]; o[i+3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return tmp.toDataURL('image/png');
    }

    getCompositeDataUrl() { return this.#canvas.main.toDataURL('image/png'); }
    setBrushSize(v) { 
        const raw = +v;
        // Snap al tamaño precomputado más cercano
        const snapped = BRUSH_PRECOMPUTE_SIZES.reduce((prev, curr) => 
            Math.abs(curr - raw) < Math.abs(prev - raw) ? curr : prev
        );
        this.#state.brushSize = snapped; 
        if(this.#callbacks.onBrushChange) this.#callbacks.onBrushChange(snapped); 
        return snapped; 
    }
    toggleTool() { const n = this.#state.tool === 'erase' ? 'add' : 'erase'; this.#setTool(n); return n; }
    toggleMaskOverlay() { this.#state.showMask = !this.#state.showMask; this.#renderComposite(); return this.#state.showMask; }
    setPreviewBackground(c) { this.#state.previewBg = c; this.#renderComposite(); }
    getState() { return Object.freeze({ ...this.#state }); }

    getFile() { return this.#state.file; }

    /** Establecer archivo */
    setFile(file) { this.#state.file = file; }

    /** Establecer si está procesado */
    setProcessed(processed) { this.#state.isProcessed = processed; }

    /** Obtener dataUrl procesada */
    getProcessedDataUrl() { return this.#state.processedDataUrl; }

    /** Establecer dataUrl procesada */
    setProcessedDataUrl(url) {  this.#state.processedDataUrl = url; }

    /** Método toggleTool para cambiar entre añadir/borrar */
    toggleTool() { 
        const newTool = this.#state.tool === 'erase' ? 'add' : 'erase'; 
        this.#setTool(newTool); 
        return newTool; 
    }

    /** Método getMaskDataUrl ya lo tienes, asegúrate que esté */
    getMaskDataUrl() {
        const { W, H } = this.#state;
        if (W === 0 || H === 0) return '';
        
        const tmp = document.createElement('canvas'); 
        tmp.width = W; 
        tmp.height = H;
        const ctx = tmp.getContext('2d');
        const mask = this.#ctx.mask.getImageData(0, 0, W, H).data;
        const out = ctx.createImageData(W, H); 
        const o = out.data;
        
        for (let i = 0; i < mask.length; i += 4) {
            o[i] = o[i+1] = o[i+2] = mask[i]; 
            o[i+3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        return tmp.toDataURL('image/png');
    }

    /** Método getCompositeDataUrl ya lo tienes, asegúrate que esté */
    getCompositeDataUrl() { 
        if (!this.#canvas.main || this.#state.W === 0) return '';
        return this.#canvas.main.toDataURL('image/png'); 
    }

    /** Reiniciar editor completamente */
    reset() {
        if (this.#state.W > 0 && this.#state.H > 0) {
            // Limpiar máscara (todo blanco = 255)
            const maskImg = this.#ctx.mask.createImageData(this.#state.W, this.#state.H);
            maskImg.data.fill(255);
            this.#ctx.mask.putImageData(maskImg, 0, 0);
            
            // Resetear estado
            this.#state.file = null;
            this.#state.processedDataUrl = null;
            this.#state.isProcessed = false;
            this.#state.painting = false;
            
            // Limpiar historial
            this.#history.stack = [];
            this.#history.index = -1;
            
            // Limpiar canvas
            this.#ctx.original.clearRect(0, 0, this.#state.W, this.#state.H);
            this.#ctx.main.clearRect(0, 0, this.#state.W, this.#state.H);
            
            this.#renderComposite();
        }
    }

    /** Cargar imagen (versión mejorada que guarda el archivo) */
    async loadImage(source, isProcessed = false) {
        const img = await new Promise((resolve, reject) => {
            const i = new Image(); 
            i.onload = () => resolve(i); 
            i.onerror = reject;
            i.src = source instanceof File ? URL.createObjectURL(source) : source;
        });
        
        // Guardar archivo si es File
        if (source instanceof File) {
            this.#state.file = source;
        }
        
        this.#state.isProcessed = isProcessed;
        this.#buildCanvases(img, isProcessed);
        
        return true;
    }
        destroy() { this.#eventHandlers.get('cleanup')?.(); this.#brushKernel.clear(); this.#history.stack = []; }

        /** Deshacer (público) */
    undo() { this.#undo(); }

    /** Rehacer (público) */
    redo() { this.#redo(); }

    /** Obtener referencia al archivo cargado (para FormData) */
    getFile() { return this.#state.file; }

    /** Establecer archivo procesado (para exportación) */
    setProcessedDataUrl(url) { this.#state.processedDataUrl = url; }
  }

  // 🔹 FACTORY & EXPORT
  return {
    create: (config) => new MaskEditor(config),
    CONSTANTS: Object.freeze({ MAX_PX, HISTORY_LIMIT })
  };
})();