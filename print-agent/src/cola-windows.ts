import { log } from './logger'
import { correrPowerShell, filasDeSalida } from './powershell'

/**
 * La cola de impresión de Windows, mirada desde el agente.
 *
 * Por qué esto merece un módulo entero
 * ────────────────────────────────────
 * En una estación de tipo `windows`, "impreso" significa **el spooler
 * aceptó los bytes**, no "salió papel" (ver la nota larga en
 * `impresora-windows.ts`). El agente entrega al spooler y da el trabajo por
 * bueno, así que un trabajo que se queda atascado ahí produce exactamente
 * el fallo que peor se diagnostica: el sistema dice `impreso`, el cliente
 * no tiene su boleto, y no hay nada en `agente.log` que lo contradiga
 * salvo un `AVISO:` de mejor esfuerzo.
 *
 * Hasta ahora la única forma de verlo era abrir la cola de Windows a mano
 * desde «Impresoras y escáneres», que es justo lo que nadie hace en medio
 * de una fila de clientes. Enseñarla aquí no arregla el fallo, pero lo
 * convierte en visible, que es el paso que faltaba.
 *
 * Cancelar es destructivo y se trata como tal
 * ───────────────────────────────────────────
 * Cancelar un trabajo tira a la basura un boleto que el sistema YA dio por
 * impreso: nadie va a reimprimirlo solo porque aquí desaparezca. Por eso
 * cada cancelación queda escrita en `agente.log` con el nombre del
 * documento, y por eso la interfaz pide confirmación antes. Aquí abajo no
 * hay ninguna cancelación automática ni ningún "limpiar la cola" que se
 * dispare solo.
 */

/** Cuánto puede llevar un trabajo esperando antes de considerarlo atascado.
 *
 *  Un boleto de mostrador sale en segundos. Dos minutos parados no es
 *  "va lento": es que no va a salir. El umbral es generoso a propósito —
 *  llamar atascado a algo que iba a imprimirse solo enseña a desconfiar
 *  del aviso. */
export const MINUTOS_PARA_ATASCO = 2

export type EstadoTrabajo = 'imprimiendo' | 'esperando' | 'atascado'

export interface TrabajoEnCola {
    /** El número que le pone Windows. Es lo que hay que pasar para cancelar. */
    id: number
    documento: string
    estado: EstadoTrabajo
    /** Lo que dijo Windows sin traducir, para soporte. */
    estadoCrudo: string
    estadoTexto: string
    propietario: string
    paginas: number | null
    bytes: number | null
    /** ISO, o null si Windows no lo dijo. */
    enviadoEn: string | null
    minutosEnCola: number | null
}

/** Banderas de trabajo que significan «esto no va a salir solo». */
const BANDERAS_ATASCO: Record<string, string> = {
    paused: 'El trabajo está pausado',
    error: 'El trabajo dio error',
    offline: 'La impresora está sin conexión',
    paperout: 'La impresora se quedó sin papel',
    blocked: 'Windows lo tiene bloqueado',
    userintervention: 'Espera que alguien atienda la impresora',
    deleting: 'Se está cancelando',
    retained: 'Windows lo está reteniendo tras imprimirlo',
}

const BANDERAS_EN_MARCHA = new Set(['printing', 'spooling', 'restarted'])

/**
 * Traduce el estado de un trabajo, teniendo en cuenta cuánto lleva parado.
 *
 * El matiz importa: con la impresora en pausa, Windows deja el trabajo en
 * `Normal` — la pausada es la impresora, no el trabajo. Mirar solo la
 * bandera diría "esperando, todo normal" de un boleto que lleva media hora
 * sin salir. Por eso el tiempo en cola es parte de la decisión y no un
 * dato de adorno.
 */
export function clasificarEstadoTrabajo(
    crudo: string,
    minutosEnCola: number | null,
): { estado: EstadoTrabajo; texto: string } {
    const banderas = crudo.split(',')
        .map(b => b.trim().toLowerCase().replace(/[\s_-]/g, ''))
        .filter(Boolean)

    const mala = banderas.find(b => b in BANDERAS_ATASCO)
    if (mala) return { estado: 'atascado', texto: BANDERAS_ATASCO[mala] }

    if (minutosEnCola !== null && minutosEnCola >= MINUTOS_PARA_ATASCO) {
        return {
            estado: 'atascado',
            texto: `Lleva ${minutosEnCola} minutos en la cola sin salir`,
        }
    }

    if (banderas.some(b => BANDERAS_EN_MARCHA.has(b))) {
        return { estado: 'imprimiendo', texto: 'Saliendo ahora mismo' }
    }

    return { estado: 'esperando', texto: 'Esperando su turno' }
}

/**
 * Trabajos de UNA impresora.
 *
 * `Get-PrintJob` primero y `Win32_PrintJob` por WMI si no está el módulo
 * PrintManagement, igual que la lista de impresoras. La fecha se emite
 * siempre en UTC con formato ISO: la conversión la hace PowerShell, que es
 * quien sabe en qué zona horaria está la PC — una fecha sin zona horaria
 * llega a JavaScript como si fuera UTC y el "lleva 4 horas en cola" saldría
 * inventado.
 */
const SCRIPT_COLA = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$s = [string][char]31
$nombre = [string]$env:AGENTE_IMPRESORA
try {
    $lineas = New-Object System.Collections.ArrayList
    try {
        foreach ($j in @(Get-PrintJob -PrinterName $nombre -ErrorAction Stop)) {
            $f = ''
            if ($j.SubmittedTime) { $f = $j.SubmittedTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
            [void]$lineas.Add('T' + $s + [string]$j.Id + $s + [string]$j.DocumentName + $s +
                [string]$j.JobStatus + $s + [string]$j.UserName + $s + [string]$j.TotalPages + $s +
                [string]$j.Size + $s + $f)
        }
    } catch {
        $fallo = $_
        $lineas.Clear()
        # Sin esta comprobacion, preguntar por una impresora que no existe
        # devolveria una cola vacia: Win32_PrintJob no se queja, simplemente
        # no encuentra nada. Y 'la cola esta vacia' y 'esa impresora no
        # existe' son dos respuestas que llevan a sitios opuestos.
        $escapado = ($nombre -replace [char]39, ([char]39 + [char]39))
        $existe = Get-CimInstance Win32_Printer -Filter ('Name=' + [char]39 + $escapado + [char]39) -ErrorAction SilentlyContinue
        if (-not $existe) { throw $fallo }
        $filtro = 'Name LIKE ' + [char]39 + $escapado + ',%' + [char]39
        foreach ($j in @(Get-CimInstance Win32_PrintJob -Filter $filtro -ErrorAction Stop)) {
            $f = ''
            if ($j.TimeSubmitted) { $f = $j.TimeSubmitted.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
            [void]$lineas.Add('T' + $s + [string]$j.JobId + $s + [string]$j.Document + $s +
                [string]$j.Status + $s + [string]$j.Owner + $s + [string]$j.TotalPages + $s +
                [string]$j.Size + $s + $f)
        }
    }
    foreach ($l in $lineas) { Write-Output $l }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`.trim()

/**
 * Cancela un trabajo, o todos los de la impresora si no se pasa número.
 *
 * Al cancelar todos NO se corta al primer fallo: un trabajo que ya terminó
 * de imprimirse entre que se listó y se intentó cancelar da error, y eso no
 * puede impedir que se cancelen los demás — que es justo lo que se pidió.
 * Se devuelve cuántos se cancelaron de verdad.
 */
const SCRIPT_CANCELAR = `
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$s = [string][char]31
$nombre = [string]$env:AGENTE_IMPRESORA
$soloEste = [string]$env:AGENTE_TRABAJO_ID

function CancelarUno {
    param([string]$impresora, [int]$id)
    try {
        Remove-PrintJob -PrinterName $impresora -ID $id -ErrorAction Stop
        return
    } catch {
        $fallo = $_
        $filtro = 'Name=' + [char]39 + ($impresora -replace [char]39, ([char]39 + [char]39)) + ', ' + [string]$id + [char]39
        $t = Get-CimInstance Win32_PrintJob -Filter $filtro -ErrorAction SilentlyContinue
        if ($t) {
            Remove-CimInstance -InputObject $t -ErrorAction Stop
            return
        }
        throw $fallo
    }
}

try {
    $hechos = 0
    if ($soloEste -ne '') {
        CancelarUno -impresora $nombre -id ([int]$soloEste)
        $hechos = 1
    } else {
        $ids = New-Object System.Collections.ArrayList
        try {
            foreach ($j in @(Get-PrintJob -PrinterName $nombre -ErrorAction Stop)) { [void]$ids.Add([int]$j.Id) }
        } catch {
            $ids.Clear()
            $filtro = 'Name LIKE ' + [char]39 + ($nombre -replace [char]39, ([char]39 + [char]39)) + ',%' + [char]39
            foreach ($j in @(Get-CimInstance Win32_PrintJob -Filter $filtro -ErrorAction Stop)) { [void]$ids.Add([int]$j.JobId) }
        }
        foreach ($id in $ids) {
            try { CancelarUno -impresora $nombre -id $id; $hechos = $hechos + 1 } catch { }
        }
    }
    Write-Output ('C' + $s + [string]$hechos)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`.trim()

/** Análisis puro de la salida del script. Separado para poder probarlo. */
export function analizarSalidaCola(salida: string, ahora = Date.now()): TrabajoEnCola[] {
    const trabajos: TrabajoEnCola[] = []

    for (const campos of filasDeSalida(salida, 'T', 7)) {
        const [id, documento, estadoCrudo, propietario, paginas, bytes, enviado] = campos

        // Sin número de trabajo no hay nada que cancelar y la fila no sirve
        // para lo único que se puede hacer con ella: mejor no enseñarla.
        if (!/^\d+$/.test(id)) continue

        const fecha = enviado && !Number.isNaN(Date.parse(enviado)) ? new Date(enviado) : null
        const minutosEnCola = fecha
            ? Math.max(0, Math.floor((ahora - fecha.getTime()) / 60_000))
            : null

        const { estado, texto } = clasificarEstadoTrabajo(estadoCrudo, minutosEnCola)

        trabajos.push({
            id: Number(id),
            documento: documento || '(sin nombre)',
            estado,
            estadoCrudo,
            estadoTexto: texto,
            propietario,
            paginas: /^\d+$/.test(paginas) ? Number(paginas) : null,
            bytes: /^\d+$/.test(bytes) ? Number(bytes) : null,
            enviadoEn: fecha ? fecha.toISOString() : null,
            minutosEnCola,
        })
    }

    return trabajos
}

/** Análisis puro del resultado de cancelar. */
export function analizarSalidaCancelacion(salida: string): number {
    const filas = filasDeSalida(salida, 'C', 1)
    const cuenta = filas.length ? filas[0][0] : ''
    return /^\d+$/.test(cuenta) ? Number(cuenta) : 0
}

/**
 * Lo que hay ahora mismo en la cola de Windows de esa impresora.
 *
 * Rechaza si no se pudo preguntar. Una cola vacía y una consulta que falló
 * significan cosas opuestas —"todo salió" y "no lo sé"— y no pueden
 * enseñarse igual.
 */
export async function listarColaWindows(
    nombreImpresora: string,
    timeoutMs = 12_000,
): Promise<TrabajoEnCola[]> {
    const salida = await correrPowerShell(SCRIPT_COLA, {
        timeoutMs,
        queSeIntentaba: `mirar la cola de impresión de «${nombreImpresora}»`,
        entorno: { AGENTE_IMPRESORA: nombreImpresora },
    })
    return analizarSalidaCola(salida)
}

/**
 * Cancela trabajos de la cola de Windows. Devuelve cuántos se cancelaron.
 *
 * `idTrabajo` a `null` cancela todos. Toda cancelación queda en
 * `agente.log`: se está tirando papel que el sistema ya dio por impreso, y
 * dentro de dos semanas nadie va a recordar quién vació esa cola.
 */
export async function cancelarEnColaWindows(
    nombreImpresora: string,
    idTrabajo: number | null,
    timeoutMs = 20_000,
): Promise<number> {
    if (idTrabajo !== null && !Number.isInteger(idTrabajo)) {
        throw new Error(`El número de trabajo "${idTrabajo}" no es válido`)
    }

    const salida = await correrPowerShell(SCRIPT_CANCELAR, {
        timeoutMs,
        queSeIntentaba: idTrabajo === null
            ? `vaciar la cola de impresión de «${nombreImpresora}»`
            : `cancelar el trabajo ${idTrabajo} de «${nombreImpresora}»`,
        entorno: {
            AGENTE_IMPRESORA: nombreImpresora,
            AGENTE_TRABAJO_ID: idTrabajo === null ? '' : String(idTrabajo),
        },
    })

    const cancelados = analizarSalidaCancelacion(salida)
    log.warn(
        `Cancelados ${cancelados} trabajo(s) de la cola de Windows de "${nombreImpresora}" `
        + `desde la interfaz local${idTrabajo === null ? ' (la cola entera)' : ` (trabajo ${idTrabajo})`}. `
        + 'Ese papel NO va a salir: si eran boletos, el sistema los tiene como impresos y hay que '
        + 'volver a imprimirlos desde el sistema, que los marca como copia.',
    )
    return cancelados
}
