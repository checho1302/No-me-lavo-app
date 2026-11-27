# No me lavo app

Aplicación web móvil (PWA) de clima en tiempo real y navegación estilo Waze que muestra tráfico en vivo, radar de lluvia y calcula rutas evitando zonas con precipitación en Bogotá y Colombia.

## Requisitos previos

- **Node.js 22 o superior** (`node -v`)
- Una clave de **Google Maps Platform** con estas APIs habilitadas en Google Cloud Console:
  - **Maps JavaScript API**
  - **Places API (New)**
  - **Routes API**

## 1. Ejecutar en tu computador (modo desarrollo)

```bash
npm install
cp .env.example .env
```

Edita `.env` y coloca tu clave real (sin comillas extra ni el texto de ejemplo):

```env
VITE_GOOGLE_MAPS_API_KEY="TU_API_KEY_DE_GOOGLE_MAPS"
```

Inicia la aplicación (frontend + backend Express con estaciones SAB IDIGER y radar 1399BOG):

```bash
npm run dev
```

Abre `http://localhost:3000`.

## 2. Ejecutar en producción (Render, Railway, Cloud Run o servidor propio)

Configura la variable de entorno `VITE_GOOGLE_MAPS_API_KEY` (y opcionalmente `NODE_ENV=production`) en tu servicio y ejecuta:

```bash
npm run build
NODE_ENV=production npm start
```

El servidor respeta automáticamente `process.env.PORT` (por defecto `3000`).

## 3. Desplegar solo frontend desde GitHub (Vercel, Netlify o GitHub Pages)

La app detecta automáticamente cuando no hay servidor Express detrás y cambia a modo directo en vivo (Open-Meteo, RainViewer, ArcGIS localidades y almacenamiento local).

- **Vercel / Netlify**:
  - Build command: `npm run build`
  - Output directory: `dist`
  - Variable de entorno: `VITE_GOOGLE_MAPS_API_KEY`
- **GitHub Pages** (`https://<usuario>.github.io/<repositorio>/`):
  - Agrega el secret `VITE_GOOGLE_MAPS_API_KEY` en *Settings → Secrets and variables → Actions*.
  - Compila indicando el subpath de tu repositorio:
    ```bash
    VITE_BASE_PATH="/<repositorio>/" npm run build
    ```
  - Asegúrate de autorizar `https://<usuario>.github.io/*` en las restricciones de referente HTTP de tu clave de Google Cloud Console.
