import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { log } from './logger'
import { correrPowerShell, filasDeSalida } from './powershell'

/**
 * Impresión en Windows: cómo se eligió y qué se descartó
 * ─────────────────────────────────────────────────────────────
 * La impresora va conectada directamente a la PC de la sucursal (USB) e
 * instalada con su driver normal, visible en «Impresoras y escáneres». El
 * requisito es innegociable: los bytes ESC/POS deben llegar CRUDOS al
 * spooler, sin que el driver los reinterprete como texto — si el driver
 * los formatea, los comandos salen impresos como caracteres sueltos en vez
 * de ejecutarse (cortar el papel, cambiar el tamaño, etc. dejan de
 * funcionar).
 *
 * Se descartó:
 *   - Un módulo npm nativo (p.ej. `printer`, `node-printer`): requieren
 *     node-gyp y un toolchain de compilación de C++. En una PC de tienda
 *     recién instalada, sin Visual Studio Build Tools, `npm install` falla
 *     ahí mismo. Justo lo que el enunciado pide evitar.
 *   - `pdf-to-printer` / imprimir vía GDI (`System.Drawing.Printing`):
 *     pasan por el subsistema gráfico de Windows, que interpreta el
 *     contenido como texto/gráficos y jamás entrega los bytes tal cual.
 *   - Compartir la impresora y hacer `copy /b archivo \\equipo\impresora`:
 *     sí es "solo herramientas de Windows", pero exige compartir la
 *     impresora (permisos de red, firewall, un paso de instalación más) y
 *     el resultado depende de cómo esté configurado el "print processor"
 *     de esa cola compartida — no garantiza modo RAW de forma tan directa.
 *
 * Se eligió: invocar `powershell.exe` (viene con Windows, no hay que
 * instalar nada) para llamar directamente a las funciones de la API de
 * impresión de Windows (`winspool.drv`: OpenPrinter, StartDocPrinter con
 * `pDataType = "RAW"`, WritePrinter, EndDocPrinter) vía P/Invoke con
 * `Add-Type -TypeDefinition` en C#. `Add-Type` compila ese C# con el
 * compilador de .NET que ya trae Windows — no hace falta node-gyp ni
 * ninguna herramienta adicional. El datatype "RAW" es precisamente el que
 * le dice al spooler "no toques esto, entrégaselo al driver tal cual",
 * que es el comportamiento que un driver ESC/POS espera.
 */

const PLANTILLA_PS1 = `
param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$DataFile
)
$ErrorActionPreference = 'Stop'

# Por defecto PowerShell escribe la consola (incluidos los mensajes de
# error) en la codepage OEM del sistema (p.ej. CP850 en instalaciones en
# español), no en UTF-8. Node descodifica stdout/stderr como UTF-8 por
# defecto: sin esto, cualquier acento en un mensaje de error llega
# ilegible al log del agente — justo lo que necesita leer alguien que no
# puede depurar en la propia PC de tienda.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true, EntryPoint = "OpenPrinterA")]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true, EntryPoint = "StartDocPrinterA")]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void EnviarCrudo(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        var di = new DOCINFOA { pDocName = "Boleto", pOutputFile = null, pDataType = "RAW" };

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("No se pudo abrir la impresora \\"" + printerName + "\\" (Win32 " + Marshal.GetLastWin32Error() + "). Comprueba el nombre exacto en Impresoras y escaneres.");

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("No se pudo iniciar el documento en \\"" + printerName + "\\" (Win32 " + Marshal.GetLastWin32Error() + ").");
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("No se pudo iniciar la pagina en \\"" + printerName + "\\" (Win32 " + Marshal.GetLastWin32Error() + ").");

                int escritos;
                if (!WritePrinter(hPrinter, bytes, bytes.Length, out escritos) || escritos != bytes.Length)
                    throw new Exception("Escritura incompleta en \\"" + printerName + "\\": " + escritos + " de " + bytes.Length + " bytes (Win32 " + Marshal.GetLastWin32Error() + ").");

                EndPagePrinter(hPrinter);
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($DataFile)
[RawPrinterHelper]::EnviarCrudo($PrinterName, $bytes)

# ─── Aviso, no verificación ────────────────────────────────────
# WritePrinter devuelve éxito en cuanto el SPOOLER acepta los bytes, no
# cuando salen del papel: con la impresora apagada, sin papel o en pausa,
# Windows igual encola el trabajo y esto ya habrá tenido éxito. Este
# chequeo es solo un intento adicional, de mejor esfuerzo, de detectar esa
# situación consultando la cola de Windows justo después de imprimir. Si
# la consulta falla o no encuentra nada raro, no cambia el resultado: se
# sigue reportando éxito (que es la verdad que puede garantizar este
# programa) y se limita a escribir una línea de AVISO que el agente
# registra como advertencia.
try {
    Start-Sleep -Milliseconds 400
    $filtro = "Name LIKE '" + ($PrinterName -replace "'", "''") + ",%'"
    $trabajos = Get-CimInstance Win32_PrintJob -Filter $filtro -ErrorAction Stop
    foreach ($t in $trabajos) {
        if ($t.Status -and $t.Status -notin @('OK', 'Printing', 'Spooling', 'Printed')) {
            Write-Output "AVISO: el trabajo quedo en la cola de Windows con estado '$($t.Status)' (revisa si la impresora esta encendida, con papel y sin pausar)"
        }
    }
} catch {
    # Sin PrintManagement/WMI disponible, o sin permisos para consultarlo:
    # no es un fallo de impresión, se ignora en silencio.
}

Write-Output "OK"
`

/**
 * Escribe bytes crudos en una impresora instalada en Windows, identificada
 * por su nombre exacto (el que aparece en «Impresoras y escáneres»).
 *
 * Igual que `imprimirRed`, RECHAZA la promesa ante cualquier fallo real o
 * timeout de la llamada a `winspool.drv` — nunca resuelve silenciosamente
 * ante un fallo que Windows sí reportó.
 *
 * Con una diferencia importante frente a `imprimirRed`, que hay que tener
 * clara: aquí "resuelve" significa que el SPOOLER de Windows aceptó los
 * bytes, no que salieron del papel. `WritePrinter` no espera a que la
 * impresora física termine; si está apagada, sin papel o en pausa,
 * Windows encola el trabajo igual y esta función resuelve. Se hace un
 * chequeo de mejor esfuerzo contra la cola de impresión justo después
 * (ver el script embebido) que registra una advertencia si detecta algo
 * raro, pero no es una garantía — por eso es una advertencia y no un
 * rechazo. Ver el README, sección "Errores comunes", para cómo diagnosticar
 * un boleto que el sistema marca como impreso pero que el cliente nunca
 * recibió.
 */
export function imprimirWindows(
    nombreImpresora: string,
    bytes: Buffer,
    timeoutMs = 15_000,
): Promise<void> {
    return new Promise((resolver, rechazar) => {
        const carpeta = os.tmpdir()
        const id = crypto.randomBytes(6).toString('hex')
        const rutaDatos = path.join(carpeta, `boleto-${id}.bin`)
        const rutaScript = path.join(carpeta, `imprimir-${id}.ps1`)

        const limpiar = () => {
            for (const ruta of [rutaDatos, rutaScript]) {
                fs.rm(ruta, { force: true }, () => { /* limpieza best-effort */ })
            }
        }

        let terminado = false
        const acabar = (err?: Error) => {
            if (terminado) return
            terminado = true
            limpiar()
            err ? rechazar(err) : resolver()
        }

        try {
            fs.writeFileSync(rutaDatos, bytes)
            fs.writeFileSync(rutaScript, PLANTILLA_PS1, 'utf8')
        } catch (e) {
            acabar(new Error(`No se pudo preparar el trabajo para "${nombreImpresora}" — ${(e as Error).message}`))
            return
        }

        const proceso = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', rutaScript,
            '-PrinterName', nombreImpresora,
            '-DataFile', rutaDatos,
        ])

        let salidaError = ''
        let salidaEstandar = ''
        proceso.stderr?.on('data', d => { salidaError += d.toString() })
        // Hay que drenar stdout aunque solo se lea al final: un hijo cuyo
        // stdout nadie consume se bloquea al llenar el búfer del pipe en
        // cuanto escribe más de lo que el sistema operativo hace de
        // colchón (unos 64 KB). Hoy el script solo emite "OK" y, como
        // mucho, un par de líneas de AVISO, pero sin este listener
        // cualquier salida mayor —un warning de PowerShell más largo,
        // una versión futura del script— cuelga cada impresión hasta el
        // timeout.
        proceso.stdout?.on('data', d => { salidaEstandar += d.toString() })

        const temporizador = setTimeout(() => {
            proceso.kill()
            acabar(new Error(`Timeout de ${timeoutMs} ms imprimiendo en "${nombreImpresora}"`))
        }, timeoutMs)

        proceso.on('error', err => {
            clearTimeout(temporizador)
            acabar(new Error(`No se pudo ejecutar PowerShell para imprimir en "${nombreImpresora}" — ${err.message}`))
        })

        proceso.on('close', codigo => {
            clearTimeout(temporizador)
            if (codigo === 0) {
                // El spooler aceptó los bytes: es todo lo que este
                // transporte puede confirmar (ver la nota en el propio
                // script sobre por qué esto no es "salió del papel").
                // Si el chequeo de mejor esfuerzo contra la cola de
                // Windows detectó algo raro, se registra como advertencia
                // — nunca como fallo, porque no es una confirmación fiable
                // de que algo salió mal.
                for (const linea of salidaEstandar.split(/\r?\n/)) {
                    if (linea.startsWith('AVISO:')) log.warn(`Impresora "${nombreImpresora}": ${linea}`)
                }
                acabar()
            } else {
                const detalle = salidaError.trim() || `powershell salió con código ${codigo}`
                acabar(new Error(`No se pudo imprimir en "${nombreImpresora}" — ${detalle}`))
            }
        })
    })
}

// ─── Qué impresoras hay y cómo están ───────────────────────────

/**
 * En qué situación está una impresora, reducido a lo único que decide qué
 * hacer en un mostrador.
 *
 * Windows tiene veintitantas banderas de estado. Aquí solo importan cuatro
 * grupos, porque cada uno lleva a una acción distinta:
 *
 *  - `lista`        → no hay nada que tocar.
 *  - `pausa`        → alguien la pausó. El spooler SIGUE aceptando trabajos
 *                     y el agente los da por entregados, pero no sale ni
 *                     un papel. Es el fallo silencioso por excelencia.
 *  - `sin-conexion` → Windows no la ve: apagada, cable suelto, o marcada
 *                     como «usar sin conexión».
 *  - `error`        → sin papel, atascada, tapa abierta.
 */
export type EstadoImpresora = 'lista' | 'pausa' | 'sin-conexion' | 'error' | 'desconocido'

export interface ImpresoraInstalada {
    /** Tal cual lo escribe Windows, sin recortar. Es lo que hay que copiar. */
    nombre: string
    estado: EstadoImpresora
    /** Lo que dijo Windows sin traducir, para soporte. */
    estadoCrudo: string
    /** Una línea en castellano de mostrador. */
    estadoTexto: string
    /** `EmuladorPOS_9100`, `USB001`, `192.168.1.60`… */
    puerto: string
    controlador: string
    predeterminada: boolean
    /** Trabajos esperando en la cola de Windows. `null` si no se pudo contar. */
    enCola: number | null
}

/** Banderas de Windows que NO impiden que salga papel. */
const BANDERAS_SANAS = new Set([
    'normal', 'idle', 'printing', 'spooling', 'ioactive', 'busy', 'processing',
    'waiting', 'warmingup', 'initializing', 'powersave', 'tonerlow',
])

/** Banderas que dejan a la impresora sin poder imprimir, con su motivo. */
const BANDERAS_ROTAS: Record<string, string> = {
    paperout: 'Se quedó sin papel',
    paperjam: 'Tiene papel atascado',
    paperproblem: 'Tiene un problema con el papel',
    dooropen: 'Tiene la tapa abierta',
    notoner: 'Se quedó sin tinta o sin tóner',
    outputbinfull: 'Tiene la bandeja de salida llena',
    userintervention: 'Pide que alguien la atienda',
    outofmemory: 'Se quedó sin memoria',
    pagepunt: 'No pudo con la página',
    pendingdeletion: 'Se está borrando de este PC',
    manualfeed: 'Está esperando que le metan el papel a mano',
    error: 'Windows la marca con error',
}

const BANDERAS_SIN_CONEXION = new Set(['offline', 'notavailable', 'serverunknown'])

/**
 * Traduce lo que dice Windows a lo que hay que hacer.
 *
 * `PrinterStatus` es una lista de banderas: `Paused`, pero también
 * `Paused, Error` o `Offline, PaperOut`. Se miran por orden de gravedad
 * práctica —primero pausa, luego sin conexión, luego avería— porque el
 * primer paso a dar es distinto en cada caso y enseñar los tres a la vez
 * no ayuda a nadie a decidir por dónde empezar.
 */
export function clasificarEstadoImpresora(
    crudo: string,
): { estado: EstadoImpresora; texto: string } {
    const banderas = crudo.split(',')
        .map(b => b.trim().toLowerCase().replace(/[\s_-]/g, ''))
        .filter(Boolean)

    if (banderas.length === 0) {
        return { estado: 'desconocido', texto: 'Windows no dijo en qué estado está' }
    }

    if (banderas.includes('paused')) {
        return {
            estado: 'pausa',
            texto: 'EN PAUSA. Windows le acepta los boletos pero no imprime ninguno hasta que se reanude',
        }
    }

    if (banderas.some(b => BANDERAS_SIN_CONEXION.has(b))) {
        return {
            estado: 'sin-conexion',
            texto: 'Sin conexión: Windows no la encuentra (apagada, cable suelto, o marcada como «usar sin conexión»)',
        }
    }

    const rota = banderas.find(b => b in BANDERAS_ROTAS)
    if (rota) return { estado: 'error', texto: BANDERAS_ROTAS[rota] }

    if (banderas.every(b => BANDERAS_SANAS.has(b))) {
        return { estado: 'lista', texto: 'Lista para imprimir' }
    }

    return { estado: 'desconocido', texto: `Windows dice «${crudo}»` }
}

/**
 * Script que lista las impresoras instaladas PARA LA CUENTA que corre este
 * proceso. Ese matiz es el que hace útil la lista: el fallo de instalación
 * más común es un servicio NSSM corriendo como "Local System", que no ve
 * las impresoras del usuario de la caja (ver el README). Preguntándoselo a
 * la misma cuenta que va a imprimir, lo que se enseña es exactamente lo que
 * el agente puede usar, no lo que se ve al abrir "Impresoras y escáneres"
 * con otra sesión.
 *
 * `Get-Printer` primero (es el cmdlet moderno) y `Win32_Printer` por WMI si
 * no está el módulo PrintManagement, que falta en algunas ediciones e
 * instalaciones recortadas de Windows. Los dos caminos emiten el MISMO
 * vocabulario de banderas (`Paused`, `Offline`, `PaperOut`…): la traducción
 * de la máscara de bits de WMI se hace aquí y no en TypeScript, para que
 * `clasificarEstadoImpresora` tenga una sola lista de nombres que entender.
 *
 * Cuál es la predeterminada y cuántos trabajos hay en cada cola son dos
 * preguntas de adorno comparadas con la lista en sí: si fallan, se sigue
 * adelante sin ellas en vez de quedarse sin lista.
 */
const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$s = [string][char]31
try {
    # Cual es la predeterminada y cuales estan marcadas como 'usar sin
    # conexion'. Lo segundo hace falta porque Get-Printer NO lo refleja:
    # comprobado en Windows 11, con WorkOffline=True el PrinterStatus sigue
    # diciendo 'Normal'. Y 'usar impresora sin conexion' es una de las
    # causas mas comunes de que Windows acepte los boletos y no salga
    # ninguno, justo el fallo que esta pantalla existe para cazar.
    $pred = ''
    $sinConexion = @{}
    try {
        foreach ($w in @(Get-CimInstance Win32_Printer -ErrorAction Stop)) {
            if ($w.Default) { $pred = [string]$w.Name }
            if ($w.WorkOffline) { $sinConexion[[string]$w.Name] = $true }
        }
    } catch { $pred = '' }

    $cuenta = @{}
    $hayCuenta = $true
    try {
        foreach ($t in @(Get-CimInstance Win32_PrintJob -ErrorAction Stop)) {
            $n = [string]$t.Name
            $i = $n.LastIndexOf(',')
            if ($i -gt 0) { $n = $n.Substring(0, $i) }
            if ($cuenta.ContainsKey($n)) { $cuenta[$n] = $cuenta[$n] + 1 } else { $cuenta[$n] = 1 }
        }
    } catch { $hayCuenta = $false }

    $filas = New-Object System.Collections.ArrayList
    try {
        foreach ($p in @(Get-Printer -ErrorAction Stop)) {
            [void]$filas.Add(@([string]$p.Name, [string]$p.PrinterStatus, [string]$p.PortName, [string]$p.DriverName))
        }
    } catch {
        $filas.Clear()
        foreach ($p in @(Get-CimInstance Win32_Printer -ErrorAction Stop)) {
            $e = New-Object System.Collections.ArrayList
            $st = 0
            try { $st = [int]$p.PrinterState } catch { $st = 0 }
            if ($st -band 1)     { [void]$e.Add('Paused') }
            if ($st -band 2)     { [void]$e.Add('Error') }
            if ($st -band 4)     { [void]$e.Add('PendingDeletion') }
            if ($st -band 8)     { [void]$e.Add('PaperJam') }
            if ($st -band 16)    { [void]$e.Add('PaperOut') }
            if ($st -band 32)    { [void]$e.Add('ManualFeed') }
            if ($st -band 64)    { [void]$e.Add('PaperProblem') }
            if ($st -band 128)   { [void]$e.Add('Offline') }
            if ($st -band 4096)  { [void]$e.Add('NotAvailable') }
            if ($st -band 262144){ [void]$e.Add('NoToner') }
            if ($st -band 4194304) { [void]$e.Add('DoorOpen') }
            if ($p.WorkOffline)  { [void]$e.Add('Offline') }
            if ($e.Count -eq 0)  { [void]$e.Add('Normal') }
            [void]$filas.Add(@([string]$p.Name, ($e -join ', '), [string]$p.PortName, [string]$p.DriverName))
        }
    }

    foreach ($f in $filas) {
        $n = $f[0]
        $estado = [string]$f[1]
        if ($sinConexion.ContainsKey($n) -and ($estado -notmatch 'Offline')) {
            $estado = $estado + ', Offline'
        }
        $c = 'x'
        if ($hayCuenta) {
            if ($cuenta.ContainsKey($n)) { $c = [string]$cuenta[$n] } else { $c = '0' }
        }
        $d = '0'
        if ($n -eq $pred) { $d = '1' }
        Write-Output ('P' + $s + $n + $s + $estado + $s + $f[2] + $s + $f[3] + $s + $d + $s + $c)
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`.trim()

/** Análisis puro de la salida del script. Separado para poder probarlo. */
export function analizarSalidaImpresoras(salida: string): ImpresoraInstalada[] {
    return filasDeSalida(salida, 'P', 6).map(campos => {
        const [nombre, estadoCrudo, puerto, controlador, predeterminada, enCola] = campos
        const { estado, texto } = clasificarEstadoImpresora(estadoCrudo)

        return {
            nombre,
            estado,
            estadoCrudo,
            estadoTexto: texto,
            puerto,
            controlador,
            predeterminada: predeterminada === '1',
            enCola: /^\d+$/.test(enCola) ? Number(enCola) : null,
        }
    })
}

/**
 * Las impresoras instaladas en este PC, con su estado, su puerto, su
 * controlador y cuál es la predeterminada.
 *
 * Existe para dos casos concretos y muy repetidos:
 *
 * 1. El servidor manda `destino.nombre` y el agente no lo elige, así que
 *    cuando esa impresora no existe aquí, decir "no se pudo abrir la
 *    impresora" no ayuda a nadie. Ver al lado que el servidor pide `POS` y
 *    que en este PC se llama `POS-58` resuelve el problema en un vistazo.
 * 2. La impresora SÍ existe pero está en pausa o sin conexión. Antes eso se
 *    veía igual que si existiera y estuviera bien —la comprobación solo
 *    miraba el nombre—, y sin embargo es la causa más común de que el
 *    sistema diga «impreso» y del papel no salga nada.
 *
 * Rechaza si no se pudo consultar; nunca devuelve una lista vacía para
 * disimular un fallo, porque "no hay impresoras" y "no se pudo preguntar"
 * llevan a acciones distintas.
 */
export async function listarImpresorasWindows(timeoutMs = 12_000): Promise<ImpresoraInstalada[]> {
    const salida = await correrPowerShell(SCRIPT_LISTAR, {
        timeoutMs,
        queSeIntentaba: 'dar la lista de impresoras de este PC',
    })
    return analizarSalidaImpresoras(salida)
}
