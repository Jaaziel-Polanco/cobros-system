import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

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
Write-Output "OK"
`

/**
 * Escribe bytes crudos en una impresora instalada en Windows, identificada
 * por su nombre exacto (el que aparece en «Impresoras y escáneres»).
 *
 * Igual que `imprimirRed`, RECHAZA la promesa ante cualquier fallo real o
 * timeout: nunca resuelve silenciosamente algo que no llegó al papel.
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
        proceso.stderr?.on('data', d => { salidaError += d.toString() })

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
                acabar()
            } else {
                const detalle = salidaError.trim() || `powershell salió con código ${codigo}`
                acabar(new Error(`No se pudo imprimir en "${nombreImpresora}" — ${detalle}`))
            }
        })
    })
}
