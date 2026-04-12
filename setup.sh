#!/usr/bin/env bash
# ================================================================
#  BG Remover — Setup para Linux (Ubuntu / Debian / Fedora)
#  Ejecutar: bash setup.sh
# ================================================================

set -e
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}[1/6] Verificando Python 3.10+...${NC}"
python3 --version || { echo "Instala Python 3.10+: sudo apt install python3"; exit 1; }

echo -e "${CYAN}[2/6] Verificando / instalando pip...${NC}"
python3 -m ensurepip --upgrade 2>/dev/null || true
pip3 --version || sudo apt install python3-pip -y

echo -e "${CYAN}[3/6] Creando entorno virtual...${NC}"
python3 -m venv venv
source venv/bin/activate

echo -e "${CYAN}[4/6] Instalando dependencias Python...${NC}"
pip install --upgrade pip
pip install -r requirements.txt

echo -e "${CYAN}[5/6] Descargando modelo u2net (primera vez ~170MB)...${NC}"
python3 -c "from rembg import new_session; new_session('u2net')" && \
  echo -e "${GREEN}Modelo descargado correctamente.${NC}"

echo -e "${CYAN}[6/6] Creando carpetas necesarias...${NC}"
mkdir -p templates static

echo ""
echo -e "${GREEN}✔ Instalación completa.${NC}"
echo -e "  Inicia el servidor con:  ${CYAN}source venv/bin/activate && python main.py${NC}"
echo -e "  Abre en el navegador:    ${CYAN}http://localhost:8000${NC}"
