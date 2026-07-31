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
  impresora debe estar **instalada en Windows primero**. Ve a
  `Configuración → Bluetooth y dispositivos → Impresoras y escáneres` y
  confirma que aparece en la lista con su nombre (por ejemplo "POS-80" o el
  modelo). Si Windows no la reconoce como impresora (solo como "dispositivo
  USB desconocido"), hay que instalar el driver que trae la impresora antes
  de seguir. Anota el nombre exacto: hace falta para configurar la
  estación en el sistema.

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

3. Copia el archivo `.env.example` y renómbralo a `.env`. Ábrelo con el
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

3. Se abre una ventana. Completa:
   - **Path:** la ruta a `node.exe` (normalmente
     `C:\Program Files\nodejs\node.exe`)
   - **Startup directory:** la carpeta del agente, por ejemplo
     `C:\agente-impresion`
   - **Arguments:** `dist\index.js`
4. Clic en "Install service".
5. Arráncalo desde `Servicios de Windows` (buscar "Servicios" en el menú
   inicio) → busca "AgenteImpresionBoletos" → botón derecho → Iniciar. Marca
   el tipo de inicio como "Automático" para que arranque solo con la PC.

Si algo falla, los registros quedan en `agente.log`, dentro de la misma
carpeta del agente.

## 4. Qué hace cada tipo de conexión

| Tipo | Cómo llegan los bytes a la impresora |
|---|---|
| `red` | El agente abre una conexión directa (TCP) a la IP y puerto de la impresora. |
| `windows` | El agente le pide a Windows que se los mande, tal cual, a la impresora instalada con ese nombre (sin que el driver los interprete como texto). |

El tipo lo elige un administrador al crear la estación en el sistema; el
agente no necesita configuración extra para uno u otro, salvo que la
impresora `windows` esté correctamente instalada en esta PC (paso 1).

## 5. Errores comunes

- **"No se pudo contactar con el servidor"**: revisa que `API_URL` sea
  correcta y que esta PC tenga red hacia el servidor. El agente reintenta
  solo, cada vez con más espera.
- **"Token inválido"**: el token del `.env` no coincide con ninguna
  estación activa. Puede que se haya regenerado desde el sistema; pide uno
  nuevo.
- **Trabajo marcado "error" en el sistema con un mensaje de impresora**:
  revisa que la impresora esté encendida, con papel y, si es de red, que
  esté en la misma red que esta PC. Ningún boleto queda marcado como
  "impreso" si no llegó de verdad al papel — si ves "error", puedes confiar
  en que no salió, y basta con reimprimirlo desde el sistema una vez
  resuelto el problema.
- **Impresora `windows` no imprime nada y no da error claro**: comprueba en
  `Impresoras y escáneres` que el nombre configurado en el sistema coincide
  EXACTO (mayúsculas, espacios) con el nombre de Windows.

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
