# 🚀 Guía de Despliegue Local — Inversiones Cordero

Este sistema está diseñado para ejecutarse en un **servidor local propio** (Linux, Windows Server o cualquier VPS), sin depender de Vercel ni ningún servicio en la nube externo.

---

## Arquitectura

```
[Servidor Local]
  ├── node server.js          ← Servidor Next.js + Cron scheduler
  ├── /api/cron/recordatorios ← Endpoint del cron (protegido)
  ├── /api/simulate           ← Endpoint de simulación (testing)
  └── Supabase (cloud)        ← Base de datos y autenticación
```

El cron **corre embebido dentro del mismo proceso Node.js** usando `node-cron`. No necesitas crontabs del sistema operativo ni Vercel.

---

## Requisitos del Servidor

- **Node.js** 18+ (recomendado: 20 LTS)
- **npm** 9+
- Acceso a internet para conectar con Supabase
- Puerto 3000 abierto (o el que configures)

---

## Configuración Inicial

### 1. Clonar / copiar el proyecto al servidor

```bash
# Si usas git
git clone <repositorio> /opt/cobros-system
cd /opt/cobros-system

# O copiar la carpeta directamente
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env.local
nano .env.local   # Editar con los valores reales
```

Variables clave:

```env
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
CRON_SECRET=un_secreto_largo_y_aleatorio
CRON_SCHEDULE=0 8,18 * * *    # 8 AM y 6 PM hora RD, todos los días
PORT=3000
HOSTNAME=0.0.0.0
```

#### Generar un CRON_SECRET seguro:

```bash
# En Linux/Mac
openssl rand -base64 32

# En Windows PowerShell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 4. Construir la aplicación

```bash
npm run build
```

### 5. Iniciar el servidor

```bash
# Modo producción (con cron embebido)
npm start
# equivale a: node server.js

# Modo desarrollo (con hot-reload)
npm run start:dev
# equivale a: node server.js --dev
```

Verás en consola:

```
╔══════════════════════════════════════════════════════╗
║  🚀 Inversiones Cordero — Servidor PRODUCCIÓN       ║
╠══════════════════════════════════════════════════════╣
║  🌐 URL: http://localhost:3000
║  📅 Cron: 0 8,18 * * *
║  🔑 CRON_SECRET: ✅ configurado
╚══════════════════════════════════════════════════════╝

[CRON] 📅 Programado: "0 8,18 * * *" (zona horaria: America/Santo_Domingo)
```

---

## Configuración del Horario (CRON_SCHEDULE)

El formato es el estándar de 5 campos: `minuto hora día-mes mes día-semana`

| Expresión         | Significado                                        |
| ----------------- | -------------------------------------------------- |
| `0 8 * * *`       | Todos los días a las 8:00 AM                       |
| `0 8,18 * * *`    | Todos los días a las 8 AM y 6 PM ← **Recomendado** |
| `0 8,12,18 * * *` | 8 AM, 12 PM y 6 PM                                 |
| `0 */4 * * *`     | Cada 4 horas                                       |
| `0 9 * * 1-5`     | Lunes a Viernes a las 9 AM                         |
| `*/30 * * * *`    | Cada 30 minutos (solo para pruebas)                |

👉 Herramienta visual: https://crontab.guru/

---

## Disparar el Cron Manualmente

**Desde el navegador:** Ve a `/simulador` → "Disparar Cron ahora"

**Desde terminal:**

```bash
npm run cron:test
```

**Con curl:**

```bash
curl http://localhost:3000/api/cron/recordatorios \
  -H "x-cron-secret: TU_CRON_SECRET"
```

---

## Mantener el Servidor Activo (Producción)

### Opción A: PM2 (Recomendado para Linux)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar con PM2
pm2 start server.js --name "cobros-system"

# Auto-reiniciar al iniciar el sistema
pm2 startup
pm2 save

# Comandos útiles
pm2 logs cobros-system     # Ver logs en tiempo real
pm2 restart cobros-system  # Reiniciar
pm2 stop cobros-system     # Parar
pm2 status                 # Estado
```

### Opción B: Windows Service (con node-windows)

```bash
npm install -g node-windows
# Seguir guía de node-windows para registrar como servicio Windows
```

### Opción C: Screen / tmux (Linux, simple)

```bash
# Con screen
screen -S cobros
npm start
# Ctrl+A, D para dejar corriendo

# Con tmux
tmux new -s cobros
npm start
# Ctrl+B, D para dejar corriendo
```

---

## Logs del Cron

Cada vez que el cron dispara, verás en consola:

```
[CRON] ⏰ 22/02/2026, 08:00:00 — Iniciando envío de recordatorios...
[CRON] ✅ Completado — Procesadas: 12 | Enviadas: 8 | Omitidas: 4 | Errores: 0
```

También puedes ver el historial completo en la sección **Registros** del dashboard.

---

## Acceso desde la Red Local

Si `HOSTNAME=0.0.0.0`, el sistema es accesible desde cualquier equipo en la misma red:

```
http://IP_DEL_SERVIDOR:3000
```

Para encontrar la IP del servidor:

```bash
# Linux
ip addr show | grep inet

# Windows
ipconfig
```

---

## Troubleshooting

| Problema                     | Solución                                                            |
| ---------------------------- | ------------------------------------------------------------------- |
| `CRON_SECRET no configurado` | Verificar que `.env.local` tiene `CRON_SECRET=...`                  |
| Cron no envía mensajes       | Revisar que hay plantillas activas y webhook activo en el dashboard |
| `Anti-duplicado activo`      | Normal — el sistema espera el intervalo mínimo entre envíos         |
| Puerto 3000 ocupado          | Cambiar `PORT=3001` en `.env.local`                                 |
| Error de Supabase            | Verificar las claves en `.env.local` y la conexión a internet       |
