# Agente de impresión de boletos

Este programa se instala en la PC de la sucursal donde está conectada la
impresora de boletos. Se queda corriendo en segundo plano: pide al sistema
los boletos pendientes de imprimir y los manda a la impresora.

No guarda ningún dato de clientes ni tiene acceso a la base de datos del
sistema. Solo sabe pedir "¿hay algo para imprimir?" y confirmar "esto se
imprimió" o "esto falló", usando una clave (token) que pertenece solo a esa
PC.

---

## 1. Antes de instalar

Necesitas dos cosas que te da un administrador del sistema:

1. **La dirección del servidor** (algo como `http://192.168.1.50:3000`).
2. **Un token de estación.** Se crea en el sistema, en `Estaciones → Crear
   estación`. El token se muestra **una sola vez**: si se pierde, hay que
   pedir uno nuevo (regenerarlo invalida el anterior).

También necesitas saber **cómo está conectada la impresora**:

- **Por red** (tiene su propio cable de red y una dirección IP): no hace
  falta nada más en esta PC, el sistema ya sabe la IP.
- **Por USB** (conectada directamente a esta PC con un cable USB): la
  impresora debe estar **instalada en Windows primero**, y con la MISMA
  cuenta de usuario que va a correr el agente (ver el aviso sobre NSSM más
  abajo — es el motivo más común de que esto falle). Ve a
  `Configuración → Bluetooth y dispositivos → Impresoras y escáneres` y
  confirma que aparece en la lista. Si Windows no la reconoce como
  impresora (solo como "dispositivo USB desconocido"), hay que instalar el
  driver que trae la impresora antes de seguir.

  Para copiar el nombre exacto sin transcribirlo a ojo (mayúsculas y
  espacios importan), abre PowerShell y ejecuta:

  ```powershell
  Get-Printer | Select-Object Name
  ```

  Copia tal cual el valor de `Name` de la impresora correcta: es lo que
  hay que escribir en el sistema al crear la estación.

Node.js 20 o superior debe estar instalado en la PC
(https://nodejs.org — descarga la versión "LTS").

## 2. Instalación

1. Copia la carpeta `print-agent` a la PC de la sucursal (por ejemplo a
   `C:\agente-impresion`).
2. Abre una terminal (`cmd` o PowerShell) dentro de esa carpeta y ejecuta:

   ```
   npm install
   npm run build
   ```

3. Copia el archivo `env.example` y renómbralo a `.env`. Ábrelo con el
   Bloc de notas y completa:

   ```env
   API_URL=http://192.168.1.50:3000
   ESTACION_TOKEN=el-token-que-copiaste-al-crear-la-estacion
   ```

   No toques las demás líneas salvo que alguien del soporte técnico te lo
   pida.

4. Pruébalo primero a mano:

   ```
   npm start
   ```

   Debe aparecer algo así:

   ```
   Estación "Caja 1" · sucursal "Santiago"
   Impresora: red 192.168.1.60:9100 · 48 columnas · cp850
   ```

   Desde el sistema, encola un boleto de prueba (botón "Imprimir página de
   prueba" en `Estaciones`) y confirma que sale de la impresora física. Si
   sale con acentos y eñes correctos, quedó bien configurado.

   Para detenerlo, `Ctrl+C`.

## 3. Que arranque solo con la PC (recomendado)

Para que no haya que abrir una terminal cada vez que se prende la PC de la
sucursal, instálalo como servicio de Windows con **NSSM**
(https://nssm.cc/download):

1. Descarga NSSM y descomprime `nssm.exe` en una carpeta, por ejemplo
   `C:\nssm`.
2. Abre una terminal **como administrador** y ejecuta:

   ```
   C:\nssm\nssm.exe install AgenteImpresionBoletos
   ```

3. Se abre una ventana con varias pestañas. Completa:
   - **Pestaña "Application":**
     - **Path:** la ruta a `node.exe` (normalmente
       `C:\Program Files\nodejs\node.exe`)
     - **Startup directory:** la carpeta del agente, por ejemplo
       `C:\agente-impresion`
     - **Arguments:** `dist\index.js`
   - **Pestaña "Log on":** ⚠️ **importante, es el fallo de instalación más
     común.** Por defecto NSSM corre el servicio como "Local System", una
     cuenta que **no ve las impresoras instaladas para un usuario
     normal**. Si la impresora se instaló mientras estabas conectado como
     el usuario de la caja, elige aquí **"This account"** y pon ese mismo
     usuario y su contraseña de Windows. Si te equivocas en este paso, el
     servicio arranca, pero cada intento de imprimir en una estación
     `windows` falla con "no se pudo abrir la impresora" sin que se vea
     por qué — la impresora existe, solo que para otra cuenta.
   - **Pestaña "I/O":** en **"Output (stdout)"** y **"Error (stderr)"**
     escribe una ruta de archivo, por ejemplo
     `C:\agente-impresion\nssm-salida.log` y
     `C:\agente-impresion\nssm-errores.log`. El agente ya escribe su
     propio `agente.log`, pero esto captura cualquier fallo de arranque
     que ocurra ANTES de que el agente llegue a inicializar su propio
     registro (una ruta mal escrita, Node no encontrado, etc.).
   - **Pestaña "Exit actions":** en **"Restart action"** deja "Restart
     application" y en el intervalo pon algo como 5 segundos (5000 ms). Así,
     si el agente se cae por cualquier motivo, Windows lo vuelve a
     levantar solo, sin que nadie en la tienda tenga que hacer nada.
4. Clic en "Install service".
5. Arráncalo desde `Servicios de Windows` (buscar "Servicios" en el menú
   inicio) → busca "AgenteImpresionBoletos" → botón derecho → Iniciar. Marca
   el tipo de inicio como "Automático" para que arranque solo con la PC.

Si algo falla, revisa primero `agente.log` (dentro de la carpeta del
agente) y, si el servicio ni siquiera llegó a arrancar, los archivos que
configuraste en la pestaña "I/O".

## 4. Qué hace cada tipo de conexión

| Tipo | Cómo llegan los bytes a la impresora |
|---|---|
| `red` | El agente abre una conexión directa (TCP) a la IP y puerto de la impresora. |
| `windows` | El agente le pide al spooler de Windows que se los mande, tal cual, a la impresora instalada con ese nombre (sin que el driver los interprete como texto). |

El tipo lo elige un administrador al crear la estación en el sistema; el
agente no necesita configuración extra para uno u otro, salvo que la
impresora `windows` esté correctamente instalada en esta PC (paso 1) y el
servicio corra con la cuenta correcta (paso 3).

### Qué significa realmente "impreso" en cada tipo

Esto es importante y las dos conexiones NO garantizan lo mismo:

- **`red`:** el agente abre el socket, escribe los bytes y espera a que la
  impresora confirme la conexión. Si algo falla —apagada, sin red, no
  responde— el agente lo detecta y el boleto queda en `error`, nunca en
  `impreso`.
- **`windows`:** el agente le entrega los bytes al **spooler** de
  Windows, y eso es lo único que puede confirmar. El spooler acepta el
  trabajo aunque la impresora esté apagada, sin papel o en pausa — en esos
  casos el trabajo se queda esperando en la cola de Windows y el sistema
  igual lo marca como `impreso`, porque desde el punto de vista del
  agente, técnicamente lo está: llegó a donde el agente puede llegar.

  **Si un boleto figura como impreso en el sistema pero el cliente nunca
  lo recibió, y la estación es de tipo `windows`, revisa la cola de
  impresión de Windows** (`Configuración → Impresoras y escáneres → [la
  impresora] → Abrir cola`). Lo más probable es encontrar el trabajo ahí
  atascado, con la impresora apagada, sin papel o en pausa. El agente
  intenta avisar de esto por su cuenta —si detecta un trabajo así en la
  cola justo después de imprimir, escribe una línea `AVISO:` en
  `agente.log`— pero es un chequeo de mejor esfuerzo, no una garantía:
  no sustituye una revisión manual si algo no cuadra.

## 5. Errores comunes

- **"No se pudo contactar con el servidor"**: revisa que `API_URL` sea
  correcta y que esta PC tenga red hacia el servidor. El agente reintenta
  solo, cada vez con más espera.
- **"Token inválido"**: el token del `.env` no coincide con ninguna
  estación activa. Puede que se haya regenerado desde el sistema; pide uno
  nuevo.
- **Trabajo marcado "error" en el sistema con un mensaje de impresora**:
  revisa que la impresora esté encendida, con papel y, si es de red, que
  esté en la misma red que esta PC.
- **Trabajo marcado "impreso" pero el boleto no salió (solo en tipo
  `windows`)**: ver el apartado anterior — revisa la cola de impresión de
  Windows.
- **Impresora `windows` no imprime nada y da "no se pudo abrir la
  impresora"**: lo más común es que el servicio esté corriendo con una
  cuenta de Windows distinta de la que tiene la impresora instalada (ver
  la pestaña "Log on" de NSSM, arriba). Lo segundo más común es que el
  nombre configurado en el sistema no coincida EXACTO (mayúsculas,
  espacios) con el que muestra `Get-Printer`.

## 6. Simulador (solo para quien desarrolla el sistema)

No hace falta para instalar el agente en una tienda. Es una herramienta
para probar el agente sin tener una impresora física a mano:

- `npm run sim` levanta un servidor que hace de impresora de red: recibe
  los bytes y dibuja en la consola cómo quedaría el papel. Configúrala como
  estación `tipo_conexion = red` apuntando a `127.0.0.1` y al puerto que
  use el simulador (por defecto 9100, configurable con `SIM_PUERTO`).
- Poniendo `MODO_SIMULADOR=archivo` en el `.env` del agente, en vez de
  imprimir de verdad (por red o por Windows), vuelca los bytes a un
  archivo dentro de `volcado-simulador/` y muestra la interpretación en la
  consola del propio agente. Sirve para probar sin depender de que el
  simulador de red esté corriendo aparte.

Ninguno de los dos modos debe activarse en una PC de sucursal real: en
ambos casos, nada sale impreso de verdad.
