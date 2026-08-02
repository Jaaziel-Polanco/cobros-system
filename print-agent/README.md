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

## 4. La página de diagnóstico (interfaz local)

Mientras el agente esté corriendo, abre en el navegador de esa misma PC:

```
http://127.0.0.1:9110
```

Es una página que contesta de un vistazo la única pregunta que importa en
un mostrador: **¿puedo cobrar?** Sirve para no tener que leer `agente.log`
cada vez que algo no sale.

**Solo se ve desde esa PC.** No se puede abrir desde otra computadora de la
tienda, ni desde el celular, ni desde la red. Es a propósito: la página dice
a qué estación pertenece esta caja, permite cambiar el token y disparar
impresiones, y eso no puede quedar al alcance de cualquiera que esté
conectado al mismo wifi.

Si no la quieres, pon `UI_PUERTO=0` en el `.env` y no se levanta. Si el
puerto 9110 ya lo usa otro programa, escribe otro número en `UI_PUERTO`. En
cualquier caso, **que la página falle nunca detiene la impresión**: el
agente lo anota en `agente.log` y sigue trabajando.

### Qué enseña

**Diagnóstico.** Cuatro semáforos, cada uno con qué pasa y qué hacer:

| Punto | Qué significa si está en rojo |
|---|---|
| Servidor de cobros | Esta PC no llega al sistema. Es red o `API_URL`. El agente reintenta solo; en cuanto vuelva, los boletos pendientes salen sin que nadie haga nada. |
| Token de esta estación | El sistema rechaza el token. Hay que pedir uno nuevo en `Estaciones → Regenerar token`. **Cuando está en verde, dice a qué estación y sucursal pertenece:** es la forma de darse cuenta de que se instaló el token de otra tienda. |
| Impresora | La impresora que pide el servidor no existe en esta PC, o existe pero no está en condiciones de imprimir (en pausa, sin conexión, sin papel). O, si es de red, no contesta. |
| Contacto y última impresión | Cuándo fue la última vez que el servidor contestó y cuándo salió el último boleto. |

El punto de la impresora es el que más ahorra tiempo, y distingue **dos
cosas que se parecen y se arreglan en sitios distintos**:

- **«No existe.»** El nombre de la impresora **lo manda el servidor**, no se
  escribe en esta PC. Se arregla en `Estaciones`, en el sistema, escribiendo
  el nombre bien.
- **«Existe, pero está en pausa / sin conexión / sin papel.»** El nombre está
  bien y no hay nada que tocar en el sistema: se arregla aquí, en la propia
  PC. Esto es lo más traicionero que hay en un mostrador, porque **con la
  impresora en pausa Windows acepta los boletos igual y el sistema los da por
  impresos** — y no sale ni uno.

Ojo con un detalle que confunde: a Windows **las mayúsculas le dan igual**
(`pos` abre la impresora `POS` y los boletos salen), pero **los espacios
no** (`POS ` con un espacio al final falla). Por eso una diferencia de
mayúsculas sale como aviso amarillo y no como error: no hay nada roto.

**Impresoras de esta PC.** La lista completa, **siempre visible** (no solo
cuando algo falla), con el estado de cada una, su puerto, su controlador y
cuál es la predeterminada de Windows. Cada fila tiene un botón **Copiar
nombre exacto**: ese nombre hay que escribirlo tal cual en `Estaciones` al
montar la caja, y transcribirlo a ojo es justo como se cuela un espacio de
más que después nadie ve.

Son las impresoras que ve **la cuenta de Windows con la que corre el
agente**, que no siempre son las mismas que ves tú al abrir «Impresoras y
escáneres» (ver el aviso de la pestaña «Log on» de NSSM, más arriba). Si la
lista sale vacía, ese es el diagnóstico: la impresora está instalada para
otro usuario.

Dos cosas que Windows cuenta a medias y que la página junta: el estado que
da `Get-Printer` **no** refleja la casilla «Usar impresora sin conexión», así
que se lee además de `Win32_Printer` y se enseña como sin conexión. Y si no
se puede preguntar a Windows, la página lo dice con esas palabras: **«no se
pudo preguntar» no es «no hay impresoras»**, y el agente sigue imprimiendo
igual mientras tanto.

**La cola de Windows.** Los trabajos que están esperando en el *spooler* de
esa impresora. Es la pantalla que resuelve el fallo más difícil de explicar
por teléfono: **el sistema dice «impreso» y el cliente no tiene su boleto.**
Pasa porque en una estación `windows` el agente entrega los bytes al spooler
y eso es todo lo que puede confirmar (ver el apartado 5); si el trabajo se
atasca ahí, el agente ya dijo que sí.

- Un trabajo que lleva más de dos minutos sin salir se marca **atascado**,
  aunque Windows lo siga dando por normal — con la *impresora* en pausa, el
  *trabajo* figura como «Normal», así que mirar solo su estado engaña.
- Si la impresora está en pausa o sin conexión, se avisa arriba de la tabla:
  **no hay que cancelar nada**, en cuanto se arregle sale todo solo.
- **Cancelar** está para lo que ya no sirve. Pide confirmación y queda
  escrito en `agente.log`, porque tira papel a la basura de un boleto que el
  sistema ya tiene como impreso: cancelarlo aquí no lo devuelve a la cola del
  sistema ni avisa a nadie.

**Pausar el agente.** Para cambiar el rollo de papel o destrabar la
impresora sin que los boletos fallen. En pausa el agente **deja de pedir
trabajos al servidor**: los boletos que se generen se quedan pendientes en el
sistema, con sus intentos intactos, y salen todos solos al reanudar. Si se
pulsa con un boleto a medio imprimir, ese termina y los que quedaran del
mismo lote vuelven a la cola sin imprimirse.

La pausa se ve desde lejos —cartel grande, la página entera enmarcada en
ámbar y el título de la pestaña cambiado a `⏸ EN PAUSA`, que se lee aunque la
ventana esté detrás de otra— y cada cinco minutos deja una línea en
`agente.log` diciendo cuánto lleva parada. Dos cosas más que conviene saber:

- Mientras esté en pausa, en la pantalla **Estaciones** esta caja va a
  aparecer como desconectada al cabo de un rato. Es la verdad: no está
  tomando trabajos. Se prefiere eso a mandar un latido de mentira y dejar la
  estación en verde mientras los boletos se acumulan.
- **La pausa no se guarda en disco.** Si alguien la deja puesta y se va,
  reiniciar el agente o prender la PC al día siguiente la quita. Una tienda
  que amanece sin poder imprimir por una pausa de ayer es mucho peor que una
  pausa que se pierde.

**Prueba de impresión.** Un botón que manda una hoja a la impresora. Que
salga papel es la única prueba que convence.

Esa hoja **la genera el propio agente en esta PC**: no pasa por el servidor
ni por la cola de boletos. Se hizo así para que el botón siga funcionando
justo cuando más falta hace —con el servidor caído, con el token
equivocado, sin red— y para que probar la impresora no deje trabajos
sueltos en la cola del sistema. Recorre exactamente el mismo camino que un
boleto de verdad (`winspool.drv → spooler → impresora`, o el socket TCP si
es de red), y usa el ancho de papel y el codepage que dice el servidor, así
que si los acentos se ven bien en la hoja de prueba, se van a ver bien en
los boletos.

Lo que esta hoja **no** comprueba es el diseño de la tirilla, que vive en el
servidor. Para el recorrido completo de punta a punta sigue estando el botón
**Imprimir página de prueba** de la pantalla `Estaciones`.

#### Por qué no hay un botón de «reimprimir el último boleto»

Se pide mucho en un mostrador y aquí no está, a propósito.

El agente sí podría volver a mandar los bytes a la impresora, pero **el
servidor no se enteraría**: `veces_impreso` de ese boleto se quedaría como
estaba, no habría ningún evento en el historial del cliente, y en la calle
habría dos papeles con el mismo número de rifa sin rastro de que existan
dos. Además, el segundo papel saldría **sin la marca `***** COPIA *****`**,
que es exactamente lo que la distingue del original. Un contador que miente
es el fallo que este módulo ya ha tenido que matar varias veces —el `ack`
que reimprimía tras un fallo de red, el `ticket_id` prestado que inflaba
`veces_impreso` de otro cliente— y no vale la pena reintroducirlo por un
botón.

**Para volver a sacar un boleto: desde el sistema, en el perfil del
cliente.** Ese camino encola un trabajo de verdad, lo cuenta y lo marca como
copia. La página lo dice donde toca (en la prueba de impresión y en la cola
de Windows), para que nadie tenga que preguntarse por qué falta el botón.

Lo que sí resuelve esta página del mismo problema: **ver dónde se quedó el
boleto** (la cola de Windows) y **por qué no salió** (el estado de la
impresora). Casi siempre no hay que reimprimir nada — quitar la pausa y el
papel sale solo.

**Actividad reciente.** Los últimos trabajos con la hora, el resultado y, si
falló, el error tal cual lo devolvió Windows o la red. Se guarda en memoria:
al reiniciar el agente se borra. El histórico completo está en `agente.log`.

Un resultado que solo sale aquí: **`devuelto`**, un boleto que el agente
tenía reclamado y no llegó a imprimir porque se pausó en medio. No es un
error (no hay nada roto) ni un descarte (el boleto no se perdió): volvió a la
cola del sistema y sale solo al reanudar.

**Registro (`agente.log`).** Las últimas líneas se ven en la propia página y
el archivo entero se descarga con un botón, para no tener que buscarlo en el
disco mientras alguien espera al teléfono. Al lado hay un tercer botón,
**Copiar informe para soporte**, que copia al portapapeles un texto plano con
todo lo que se pregunta siempre —qué estación es, qué impresora pide el
servidor, cómo la ve Windows, qué hay atascado en la cola y las últimas 60
líneas del registro— listo para pegar en el chat. El token nunca aparece
entero, ahí tampoco.

### Cambiar la configuración desde la página

Al final hay un formulario que escribe el `.env` por ti, **sin borrar los
comentarios** que ya tiene (antes de guardar deja una copia en `.env.bak`).

Algunos cambios se aplican al momento y otros no:

| Ajuste | ¿Hay que reiniciar el agente? |
|---|---|
| Detalle del registro (`LOG_LEVEL`) | No, al instante |
| Modo simulador (`MODO_SIMULADOR`) | No, al instante |
| Dirección del servidor (`API_URL`) | **Sí** |
| Token de la estación (`ESTACION_TOKEN`) | **Sí** |
| Espera al preguntar por boletos (`POLL_ESPERA_MS`) | **Sí** |

Los tres últimos quedan fijados cuando el agente arranca, y con el token
cambia además la identidad de la estación (otra sucursal, otra impresora,
otro ancho de papel): aplicarlos en caliente obligaría a rehacer la
conexión en mitad de una impresión. Mientras haya algo guardado que todavía
no se aplica, la página lo avisa arriba con un cartel amarillo — y también
si alguien editó el `.env` a mano en el Bloc de notas y se olvidó de
reiniciar.

El token **se enseña tapado** (`8V-f••••••••EdTd`) y no se puede leer desde
la página: solo sustituir. Deja el campo en blanco para conservar el que ya
está puesto.

Si `MODO_SIMULADOR` está en `archivo`, la página lo grita en rojo arriba del
todo. Con eso puesto no sale ni un boleto por la impresora aunque el sistema
los dé por impresos, y en una tienda eso es un fallo silencioso.

## 5. Qué hace cada tipo de conexión

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
  impresión de Windows.** La forma rápida es abrir la página de
  diagnóstico (apartado 4) y mirar **La cola de Windows**, que enseña lo
  mismo sin salir de ahí y además dice si la impresora está en pausa o sin
  conexión; a mano es `Configuración → Impresoras y escáneres → [la
  impresora] → Abrir cola`. Lo más probable es encontrar el trabajo ahí
  atascado, con la impresora apagada, sin papel o en pausa. El agente
  intenta avisar de esto por su cuenta —si detecta un trabajo así en la
  cola justo después de imprimir, escribe una línea `AVISO:` en
  `agente.log`— pero es un chequeo de mejor esfuerzo, no una garantía:
  no sustituye una revisión manual si algo no cuadra.

## 6. Errores comunes

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
  Windows en la página de diagnóstico.
- **No sale ningún boleto y no hay ningún error en ninguna parte**: mira la
  página de diagnóstico. Las tres causas mudas, por orden de frecuencia, son
  la impresora **en pausa** en Windows, el **agente en pausa** (el cartel
  ámbar es imposible de no ver) y el `MODO_SIMULADOR` puesto. Las tres dejan
  al sistema diciendo que todo va bien.
- **Impresora `windows` no imprime nada y da "no se pudo abrir la
  impresora"**: lo más común es que el servicio esté corriendo con una
  cuenta de Windows distinta de la que tiene la impresora instalada (ver
  la pestaña "Log on" de NSSM, arriba). Lo segundo más común es que el
  nombre configurado en el sistema no coincida EXACTO (mayúsculas,
  espacios) con el que muestra `Get-Printer`.

## 7. Simulador (solo para quien desarrolla el sistema)

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

### Probar el recorrido completo sin impresora

Esto es lo más parecido a la sucursal que se puede montar sin tener el
papel delante. Recorre lo mismo que recorrerá en producción —web, API,
cola de impresión, agente, reintentos, marca de COPIA, acuse— y solo
cambia el último paso: en vez de escribir en el spooler de Windows, los
bytes van a un archivo.

1. Con el sistema corriendo (`npm run dev` en la carpeta del proyecto),
   entra en **Estaciones** y pulsa **Regenerar token** en la estación con
   la que quieras probar. El token se muestra una sola vez: cópialo.
2. En esta carpeta, copia `env.example` a `.env` y rellena:

   ```
   API_URL=http://localhost:3000
   ESTACION_TOKEN=<el token que acabas de copiar>
   MODO_SIMULADOR=archivo
   LOG_LEVEL=debug
   ```

3. `npm install && npm run build && npm start`. En cuanto arranque, la
   estación aparecerá como conectada en **Estaciones**: ese es el mismo
   latido que verás desde la tienda.
4. Desde el perfil de un cliente, genera un boleto y dale a **Imprimir**.
   En la consola del agente sale la tirilla dibujada, y el archivo con los
   bytes crudos queda en `volcado-simulador/`.

Vale la pena probar también lo que no sale bien: **para el agente** y manda
un boleto — el trabajo se queda en cola y se imprime solo cuando lo
levantas. E **imprime dos veces el mismo boleto**: el segundo tiene que
salir marcado `***** COPIA *****`.

Cuando toque instalarlo de verdad en la tienda, lo único que cambia es
dejar `MODO_SIMULADOR=` vacío y apuntar `API_URL` al servidor real.

### Simular la cola de Windows con una impresora falsa

Lo anterior salta el spooler. Esto no: crea una impresora de Windows de
verdad cuyo puerto TCP apunta a un emulador ESC/POS, de modo que el agente
recorre `winspool.drv -> spooler -> puerto -> impresora` exactamente igual
que en la tienda. Lo único que cambia es qué hay al otro lado del cable.

No hace falta ser administrador:

```powershell
Add-PrinterDriver -Name "Generic / Text Only"
Add-PrinterPort -Name "EmuladorPOS_9100" -PrinterHostAddress "127.0.0.1" -PortNumber 9100
Add-Printer -Name "POS" -DriverName "Generic / Text Only" -PortName "EmuladorPOS_9100"
```

El nombre de la impresora (`POS`) tiene que coincidir con el campo
"Nombre de la impresora" de la estación en **Estaciones**. Si tu estación
usa otro nombre, ponle ese aquí y no hace falta tocar la base de datos.

Al otro lado del puerto tiene que haber algo escuchando en el 9100: el
`npm run sim` de este mismo paquete, o un emulador de escritorio.

Para deshacerlo cuando llegue la impresora de verdad:

```powershell
Remove-Printer -Name "POS"
Remove-PrinterPort -Name "EmuladorPOS_9100"
```

### Ver solo cómo queda el papel

Si únicamente quieres revisar la maquetación —qué entra en 48 columnas,
cómo parten los nombres largos, dónde cae el QR— no hace falta montar
nada. Desde la carpeta del proyecto:

```
npm run papel
npm run papel -- --cols 32     # papel de 58 mm
```

Construye la tirilla con el mismo código del servidor y la dibuja con el
mismo intérprete que usa el simulador, en cuatro casos: boleto normal,
reimpresión marcada como copia, boleto huérfano (sin sorteo abierto) y
uno con nombre y premio largos.
