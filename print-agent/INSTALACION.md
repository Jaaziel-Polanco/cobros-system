# Instalar el agente en una PC de sucursal

Guía de principio a fin para dejar el agente de impresión corriendo
permanentemente en la PC de una tienda, y para **comprobar desde lejos que
de verdad está imprimiendo**.

El `README.md` explica qué hace cada pieza y cómo funciona la página de
diagnóstico. Esto es solo la secuencia de pasos.

---

## Antes de empezar

Necesitas tres cosas:

1. **Node.js 20 LTS** instalado en esa PC (https://nodejs.org, versión LTS).
   Es el único requisito previo.
2. **El token de esa estación**, que sale del sistema en
   `Estaciones → Regenerar token`. Se muestra una sola vez.
3. **La impresora ya instalada en Windows** y funcionando. Si Windows no la
   reconoce como impresora, instala primero el driver que trae.

> **El token es distinto en cada caja.** Identifica a la estación. Si pones
> el mismo token en dos PCs, las dos se presentan como la misma caja y los
> boletos salen por la impresora equivocada, sin ningún error a la vista.

No hace falta copiar `node_modules` ni compilar nada en la tienda: el
agente no tiene dependencias en tiempo de ejecución. El paquete
`agente-impresion-v1.1.0.zip` ya trae todo lo necesario.

---

## 1. Copiar la carpeta

Descomprime el zip en `C:\agente-impresion`.

**No la dejes en el Escritorio.** Si ese Escritorio está sincronizado con
OneDrive, el `agente.log` se sube a la nube y OneDrive puede mover archivos
por debajo del servicio. Además, una ruta dentro de un perfil de usuario se
complica si el servicio termina corriendo con otra cuenta.

Si ya la descomprimiste ahí:

```powershell
Move-Item C:\Users\User\Desktop\agente-impresion-v1.1.0 C:\agente-impresion
```

---

## 2. Configurar el `.env`

Copia `env.example` y renómbralo a `.env`. Ábrelo con el Bloc de notas:

```env
API_URL=https://negocio-ia-cuentas-por-cobrar.bkrj0h.easypanel.host
ESTACION_TOKEN=<el token DE ESTA caja>
```

No toques las demás líneas.

**`MODO_SIMULADOR` tiene que quedar vacío.** Con `archivo` puesto no sale ni
un boleto por la impresora aunque el sistema los dé por impresos. Además,
sin `node_modules` ese modo ni siquiera arranca.

Antes de seguir, copia el nombre exacto de la impresora:

```powershell
Get-Printer | Select-Object Name
```

Si ese comando no existe (`Get-Printer` llegó con Windows 8; en Windows 7
no está), usa este otro, que funciona en cualquier versión:

```powershell
Get-CimInstance Win32_Printer | Select-Object Name
```

Ese nombre tiene que coincidir **carácter por carácter** con el que está
puesto en `Estaciones`. A Windows las mayúsculas le dan igual, pero los
espacios no: `POS ` con un espacio al final falla con un error que no
explica nada.

---

## 3. Probar a mano

**No te saltes este paso.** Un agente que no funciona a mano tampoco
funciona como servicio, y depurarlo como servicio es mucho más difícil.

```powershell
cd C:\agente-impresion
node dist\index.js
```

Tiene que salir:

```
Estación "Impresion Carr mella" · sucursal "Sucursal Carr.Mella"
Impresora: Windows: "POS" · 48 columnas · cp850
```

**Comprueba que el nombre de la estación es el que esperas.** Ahí es donde
se detecta un token cruzado, y es mucho más barato verlo ahora que cuando
los boletos empiecen a salir en la sucursal equivocada.

Con eso corriendo, abre en esa misma PC:

```
http://127.0.0.1:9110
```

Dale al botón de **prueba de impresión**. Si sale papel, sigue. Si no,
arréglalo aquí.

Para el agente con `Ctrl+C`.

---

## 4. Instalar NSSM

Node no puede ser un servicio de Windows por sí solo: el sistema lo mataría
por no responder a las órdenes de control. Hace falta un envoltorio.

Baja NSSM de **<https://nssm.cc/download>** (el zip de `nssm 2.24`). Dentro
trae dos carpetas y hay que sacar el `nssm.exe` **de la que corresponda a
esta PC**, no siempre la de 64 bits:

```powershell
[Environment]::Is64BitOperatingSystem
```

- `True`  → copia `win64\nssm.exe` a `C:\nssm\`
- `False` → copia `win32\nssm.exe` a `C:\nssm\`

Hay PCs de mostrador con Windows de 32 bits, y en esas el instalador de
Node solo ofrece la versión x86. **No es un problema:** el agente no tiene
ningún módulo nativo, así que funciona idéntico en 32 y en 64 bits. Está
probado en las dos.

---

## 5. Crear el servicio

PowerShell **como administrador** (clic derecho → *Ejecutar como
administrador*).

Primero averigua dónde quedó Node, porque la ruta **no siempre es la
misma** y aquí hay que escribirla exacta:

```powershell
(Get-Command node).Source
```

En un Windows de 32 bits sale `C:\Program Files\nodejs\node.exe`. En uno de
64 bits con Node x86 instalado sale `C:\Program Files (x86)\nodejs\node.exe`
— y ese `(x86)` es fácil de pasar por alto. Usa lo que devuelva el comando
en la primera línea de abajo:

```powershell
C:\nssm\nssm.exe install AgenteImpresionBoletos "C:\Program Files\nodejs\node.exe" "dist\index.js"
C:\nssm\nssm.exe set AgenteImpresionBoletos AppDirectory "C:\agente-impresion"
C:\nssm\nssm.exe set AgenteImpresionBoletos AppStdout "C:\agente-impresion\nssm-salida.log"
C:\nssm\nssm.exe set AgenteImpresionBoletos AppStderr "C:\agente-impresion\nssm-errores.log"
C:\nssm\nssm.exe set AgenteImpresionBoletos AppNoConsole 1
```

**`AppNoConsole 1` no es opcional, ponlo siempre.** NSSM por defecto le crea
una consola al proceso hijo, y los servicios corren en la Sesión 0, donde esa
asignación puede fallar. Cuando falla, Node muere cargando sus DLLs **antes
de ejecutar una sola línea de código**: el servicio queda en `PAUSED`, los
dos archivos de log quedan **vacíos** y no hay ni un error a la vista. Está
documentado abajo, en Problemas comunes, porque diagnosticarlo desde cero
lleva una hora larga.

Así por línea de comandos en vez de con la ventana gráfica de
`nssm install`: hay menos donde equivocarse.

Los dos últimos capturan los fallos que ocurren **antes** de que el agente
llegue a crear su propio `agente.log` — Node no encontrado, ruta mal
escrita, `.env` ilegible. Sin eso, un arranque fallido no deja rastro en
ninguna parte y parece que el servicio simplemente "no hace nada".

---

## 6. Correr el script de endurecimiento

```powershell
cd C:\agente-impresion
powershell -ExecutionPolicy Bypass -File .\asegurar-servicio.ps1
```

Encuentra el servicio solo y deja cuatro cosas listas:

| Qué | Por qué |
|---|---|
| Arranque automático | Vuelve solo tras apagar, reiniciar o Windows Update, **sin que nadie inicie sesión** |
| Dos redes de reinicio | Windows revive el servicio; NSSM revive el proceso `node`. Con una sola queda un hueco |
| Energía | Sin suspensión ni hibernación. Una PC dormida no imprime, y parece encendida |
| USB sin suspensión | Windows apaga el puerto "para ahorrar" y la impresora deja de responder hasta que alguien la desenchufa |

Es idempotente: se puede volver a correr las veces que haga falta. Termina
con un resumen en verde de lo que quedó bien.

---

## 7. Comprobar que el servicio ve la impresora

**Este es el paso que se salta todo el mundo y luego no entiende por qué no
imprime.**

El servicio arranca por defecto con una cuenta de sistema, que **no ve las
impresoras instaladas por un usuario normal**. Abre `http://127.0.0.1:9110`
y mira la lista de impresoras.

- Si tu impresora aparece → listo.
- **Si la lista sale vacía o falta la impresora** → es eso.

Para arreglarlo:

```powershell
C:\nssm\nssm.exe edit AgenteImpresionBoletos
```

Pestaña **Log on** → *This account* → el usuario del cajero y su contraseña
de Windows. Reinicia el servicio después.

> Si usas una cuenta de usuario, ponle **contraseña que no expire**. Cuando
> caduca, el servicio deja de arrancar y no hay nada que lo explique.

---

## 8. La prueba de verdad

Reinicia la PC y **no inicies sesión**. Desde el sistema, en `Estaciones`,
esa caja tiene que salir conectada al cabo de un minuto.

Si aparece sin que nadie haya entrado a Windows, quedó bien puesto.

---

## 9. Lo que no se arregla por software

Entra en la BIOS y activa **Restore on AC Power Loss → Power On** (según la
marca puede llamarse *AC Back* o *After Power Failure*).

Sin eso, cuando se vaya la luz la PC no vuelve sola y alguien tiene que
apretar el botón — que es justo lo que se quiere evitar.

---
---

# Validar en remoto que está imprimiendo

Esta es la parte incómoda y conviene ser honesto: **para una estación de
tipo `windows` no existe ninguna prueba por software de que salió papel.**

El agente entrega los bytes al *spooler* de Windows y eso es todo lo que
puede confirmar. El spooler acepta el trabajo aunque la impresora esté
apagada, sin papel o en pausa. Desde el punto de vista del agente el boleto
está impreso, porque llegó hasta donde el agente puede llegar.

Dicho eso, se puede llegar bastante lejos. Aquí están las señales por
orden, y **qué demuestra cada una**.

## Nivel 1 — Desde la web, sin acceso a la PC

### La estación está viva

`Estaciones`. Si la caja aparece conectada, el agente está corriendo y
hablando con el servidor. Se considera desconectada cuando pasa **un
minuto** sin dar señales.

**Demuestra:** el agente vive, el token es válido, hay red.
**No demuestra:** nada sobre la impresora.

### La cola de trabajos

En la misma pantalla `Estaciones`, desplegando la sucursal, sale la lista
de trabajos con su estado, el número de boleto, cuándo se encoló, cuántos
intentos lleva y en qué estación cayó.

Los estados y qué significan de verdad:

| Lo que ves | Estado interno | Qué pasó | ¿Salió papel? |
|---|---|---|---|
| **En cola** | `pendiente` | Encolado, ningún agente lo ha tomado | No |
| **Imprimiendo** | `reclamado` | Un agente lo tomó y aún no confirma | Quizá, en curso |
| **Impreso** | `impreso` | El agente confirmó | En `red` sí. En `windows`, **el spooler lo aceptó** |
| **Error** | `error` | Falló y lo dijo | No, o no se sabe |
| **Cancelado** | `cancelado` | Alguien lo canceló a mano | No |

Un trabajo que se queda en `reclamado` mucho rato vuelve solo a
`pendiente` **a los 90 segundos** y se reintenta, hasta agotar los
intentos. Eso pasa cuando el agente muere en mitad de una impresión.

**Ojo con la asimetría:** en una estación de tipo `red` el agente abre un
socket a la impresora y falla si no responde, así que `impreso` es casi
concluyente. En `windows` no. Tus dos estaciones son `windows`.

### El historial del boleto

En el perfil del cliente, cada boleto tiene sus eventos. Ahí sale también
el mensaje de error tal cual si algo falló, incluida la línea que deja la
recuperación automática:

> *Recuperado tras 90 s sin confirmación del agente. Puede haberse impreso
> ya en la estación; verifica el papel físico antes de reimprimir.*

Esa frase está escrita así a propósito: cuando un trabajo se recupera, el
sistema **no sabe** si salió papel o no.

## Nivel 2 — Entrando a la PC en remoto

La página de diagnóstico del agente (`http://127.0.0.1:9110`) **solo se ve
desde esa PC**. No se puede abrir por la red, ni desde tu casa, ni desde el
celular. Es deliberado: permite cambiar el token y disparar impresiones.

Así que para esto necesitas AnyDesk, TeamViewer, Escritorio Remoto o
similar. Una vez dentro, esa página es la mejor herramienta que hay:

**La cola de Windows.** Es la pantalla que contesta la pregunta difícil:
*el sistema dice «impreso» y el cliente no tiene su boleto*. Si el trabajo
sigue ahí parado, nunca salió. La página marca como **atascado** todo lo
que lleve más de dos minutos, aunque Windows lo siga dando por normal — con
la *impresora* en pausa, el *trabajo* figura como `Normal`, así que mirar
solo su estado engaña.

**El estado de la impresora.** Distingue «no existe» (nombre mal escrito en
el sistema) de «existe pero está en pausa / sin conexión / sin papel»
(se arregla en la propia PC). Incluye la casilla *Usar impresora sin
conexión*, que `Get-Printer` **no** refleja.

**El registro.** El agente intenta avisar por su cuenta: justo después de
imprimir consulta la cola y, si encuentra el trabajo en un estado raro,
escribe una línea `AVISO:` en `agente.log`. Es un chequeo de mejor
esfuerzo, no una garantía, pero cuando aparece es señal casi segura de que
no salió papel.

**Copiar informe para soporte.** Un botón que junta todo lo anterior en
texto plano listo para pegar en un chat. Si vas a preguntarle algo a
alguien de la tienda, mándale esto primero.

### Sin abrir la página, desde PowerShell

Si prefieres la terminal:

```powershell
# ¿Hay algo atascado en la cola?
Get-PrintJob -PrinterName "POS" | Select-Object Id, JobStatus, SubmittedTime, Size

# ¿Cómo ve Windows la impresora? (WorkOffline es el que Get-Printer omite)
Get-CimInstance Win32_Printer -Filter "Name='POS'" |
    Select-Object Name, PrinterStatus, WorkOffline, PrinterState, DetectedErrorState

# Las últimas líneas del log del agente
Get-Content C:\agente-impresion\agente.log -Tail 40
```

**Cola vacía + impresora sin errores + `impreso` en el sistema** es lo más
cerca que se llega de una confirmación sin mirar el papel. En la práctica,
si esas tres cosas se cumplen, salió.

## Nivel 3 — La única prueba real

Alguien mira la impresora. En serio: para la primera impresión de una
estación recién montada, pídele a alguien de la tienda una foto del boleto
por WhatsApp.

Cuesta dos minutos y confirma de golpe lo que ninguna consulta puede: que
el papel salió, que los acentos y las eñes se ven bien, que el QR está
completo y que el ancho de columna es el correcto.

Después de esa primera vez, la cadena del nivel 1 y 2 basta para el día a
día.

## Lo que sí puedes dar por seguro estando lejos

- **Nada se pierde con la PC apagada.** Los boletos se quedan en
  `pendiente` y salen todos, en orden, cuando el agente vuelva. La purga
  nocturna solo vacía trabajos ya terminados (`impreso`, `cancelado`,
  `error`); a los pendientes no los toca nunca, y no tienen fecha de
  caducidad.
- **Al volver imprime todo lo acumulado de golpe** (de 5 en 5, hasta 20 por
  ronda). Si estuvo apagada un día, ten papel.
- **Un fallo real sí se reporta.** Si el agente no puede escribir en la
  impresora, el boleto queda en `error` con el mensaje de Windows, visible
  desde la web, y hay un botón para reencolarlo.

---

## Problemas comunes

**«No se pudo contactar con el servidor».** Revisa `API_URL` y que esa PC
tenga internet. El agente reintenta solo, cada vez con más espera; en
cuanto vuelva, los pendientes salen sin que nadie haga nada.

**«Token inválido».** El token no coincide con ninguna estación activa.
Pide uno nuevo en `Estaciones → Regenerar token`.

**Trabajo en `impreso` pero el boleto no salió.** Estación tipo `windows`:
mira la cola de Windows (nivel 2). Casi siempre está el trabajo ahí, con la
impresora apagada, sin papel o en pausa.

**No sale nada y no hay ningún error en ninguna parte.** Las tres causas
mudas, por frecuencia: la impresora **en pausa** en Windows, el **agente en
pausa** desde su propia página, y `MODO_SIMULADOR` puesto. Las tres dejan
al sistema diciendo que todo va bien.

**«No se pudo abrir la impresora».** Lo más común es que el servicio corra
con una cuenta de Windows distinta de la que tiene la impresora instalada
(paso 7). Lo segundo, que el nombre configurado en el sistema no coincida
exacto con el que muestra `Get-Printer`.

---

## El servicio no arranca y no hay ningún error

Este merece su propio apartado porque es el que más tiempo roba: **no deja
rastro en ninguno de los sitios donde uno mira.**

Los síntomas, todos a la vez:

- `Start-Service` falla con un mensaje genérico
- `sc.exe query` dice **`PAUSED`**
- `nssm-salida.log` y `nssm-errores.log` existen pero están **vacíos**
- No hay ningún `node.exe` en el Administrador de tareas
- El agente, a mano con `node dist\index.js`, **funciona perfectamente**

### Por qué los logs están vacíos

`AppStdout` y `AppStderr` capturan lo que escribe el **proceso hijo**. Si el
hijo no llega a nacer, no hay nada que capturar. Un archivo vacío se lee como
«no pasó nada» cuando significa justo lo contrario.

Los errores del **propio NSSM** —por qué no pudo lanzar el programa, con qué
código murió— van al registro de eventos de Aplicación:

```powershell
Get-EventLog -LogName Application -Newest 30 | Where-Object { $_.Source -match "nssm" } | Select-Object -First 6 TimeGenerated, EntryType, Message | Format-List
```

Ahí sale la línea que lo explica todo, con el código de salida real.

### Y por qué dice `PAUSED`

No lo pausó nadie. Cuando el programa muere antes del margen de
`AppThrottle`, **NSSM deja el servicio en pausa** mientras espera para
reintentar. Sobre un servicio pausado, `Start-Service` no dice eso: falla con
«no pudo iniciarse» o con el error **1056 («ya se está ejecutando»)**, que
apunta exactamente al revés. Para salir del estado:

```powershell
C:\nssm\nssm.exe stop AgenteImpresionBoletos
```

### Los códigos que aparecen de verdad

| Código de salida | Qué es | Arreglo |
|---|---|---|
| **3221225794** | `0xC0000142 STATUS_DLL_INIT_FAILED`. Muere cargando sus DLLs, antes de ejecutar código. En un servicio es la consola de la Sesión 0 | `nssm set <servicio> AppNoConsole 1` |
| **3** | `ERROR_PATH_NOT_FOUND`. Alguna ruta del servicio no existe | Comprueba `AppDirectory` y `Application` con `nssm get` |
| **1** | El agente abortó por configuración | Falta `API_URL` o `ESTACION_TOKEN` en el `.env` |

El primero es el traicionero: **funciona a mano y falla como servicio**,
porque la Sesión 0 no es el escritorio del usuario. Por eso el paso 5 pone
`AppNoConsole 1` siempre, no solo cuando falla.

`asegurar-servicio.ps1` ya hace todo esto por su cuenta: si el servicio no
arranca, lee el registro de eventos, traduce el código y avisa cuando un log
está vacío en vez de callárselo.

### Si el servicio queda inservible

Bórralo y recréalo. No pierdes nada: la configuración vive en el `.env`, no
en el servicio.

```powershell
C:\nssm\nssm.exe remove AgenteImpresionBoletos confirm
```

Si responde **«marcado para ser eliminado»**, hay una ventana abierta
sujetándolo (Servicios, Administrador de tareas, Visor de eventos). Ciérralas
y repite. Si aun así no cede y **no puedes reiniciar la PC**, no pelees:
créalo con otro nombre —`AgenteBoletos`, por ejemplo— y sigue adelante. El
nombre viejo se libera solo en el próximo arranque. Recuerda entonces
pasarle el nombre al script:

```powershell
powershell -ExecutionPolicy Bypass -File .\asegurar-servicio.ps1 -Servicio AgenteBoletos
```
