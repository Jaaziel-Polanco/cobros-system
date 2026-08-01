import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { log } from './logger'

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
 * instalaciones recortadas de Windows.
 */
const SCRIPT_LISTAR = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$nombres = @()
try {
    $nombres = @(Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name)
} catch {
    $nombres = @(Get-CimInstance Win32_Printer -ErrorAction Stop | Select-Object -ExpandProperty Name)
}
foreach ($n in $nombres) { Write-Output $n }
`.trim()

/**
 * Nombres de las impresoras instaladas en este PC, tal cual los ve Windows.
 *
 * Existe para un caso concreto y muy repetido: el servidor manda
 * `destino.nombre` y el agente no lo elige, así que cuando esa impresora no
 * existe aquí, decir "no se pudo abrir la impresora" no ayuda a nadie. Ver
 * al lado que el servidor pide `POS` y que en este PC se llama `POS-58`
 * resuelve el problema en un vistazo.
 *
 * Rechaza si no se pudo consultar; nunca devuelve una lista vacía para
 * disimular un fallo, porque "no hay impresoras" y "no se pudo preguntar"
 * llevan a acciones distintas.
 */
export function listarImpresorasWindows(timeoutMs = 12_000): Promise<string[]> {
    return new Promise((resolver, rechazar) => {
        let terminado = false
        const acabar = (err: Error | null, nombres?: string[]) => {
            if (terminado) return
            terminado = true
            clearTimeout(temporizador)
            if (err) rechazar(err)
            else resolver(nombres ?? [])
        }

        const proceso = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', SCRIPT_LISTAR,
        ])

        let salida = ''
        let salidaError = ''
        proceso.stdout?.on('data', d => { salida += d.toString() })
        proceso.stderr?.on('data', d => { salidaError += d.toString() })

        const temporizador = setTimeout(() => {
            proceso.kill()
            acabar(new Error(`Windows tardó más de ${timeoutMs / 1000} s en dar la lista de impresoras`))
        }, timeoutMs)

        proceso.on('error', err => {
            acabar(new Error(`No se pudo ejecutar PowerShell para listar las impresoras — ${err.message}`))
        })

        proceso.on('close', codigo => {
            if (codigo !== 0) {
                acabar(new Error(
                    `Windows no devolvió la lista de impresoras — ${salidaError.trim() || `powershell salió con código ${codigo}`}`,
                ))
                return
            }
            acabar(null, salida.split(/\r?\n/).map(l => l.trim()).filter(Boolean))
        })
    })
}
