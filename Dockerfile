FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema necesarias para rembg y Pillow
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copiar archivos de dependencias
COPY requirements.txt .

# Instalar dependencias de Python
RUN pip install --no-cache-dir -r requirements.txt

# Descargar el modelo u2net durante el build
RUN python -c "from rembg import new_session; new_session('u2net')"

# Copiar el resto de la aplicación
COPY main.py .
COPY templates ./templates
COPY static ./static

# Crear directorio para archivos estáticos si no existe
RUN mkdir -p static

# Exponer el puerto de la aplicación
EXPOSE 8000

# Comando para ejecutar la aplicación
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]