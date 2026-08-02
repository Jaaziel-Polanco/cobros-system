import fs from 'node:fs'

/**
 * Leer `agente.log` desde la interfaz.
 *
 * El motivo es de mostrador puro: cuando algo no sale y hay que llamar por
 * teléfono, lo primero que pide soporte es el registro. Pedirle a quien
 * está atendiendo que abra el explorador de archivos, encuentre la carpeta
 * del agente y adjunte un `.log` es pedir demasiado con clientes delante.
 *
 * Dos reglas que condicionan el código de aquí abajo:
 *
 * 1. **Nunca leer el archivo entero.** El registro rota a los 5 MB, así que
 *    puede haber casi 5 MB en disco. Cargarlos para enseñar las últimas 200
 *    líneas es tirar memoria y tiempo del proceso que tiene que estar
 *    imprimiendo. Se leen solo los últimos `VENTANA_BYTES` desde el final.
 * 2. **Nada síncrono.** Todo va por `fs.promises`, y el archivo entero solo
 *    se manda al navegador por un flujo (ver la ruta de descarga), nunca
 *    cargándolo en memoria.
 */

/** Cuánto se lee desde el final para sacar las últimas líneas.
 *
 *  256 KB son de sobra para varios miles de líneas del registro, que es
 *  mucho más de lo que nadie va a leer en una página. */
export const VENTANA_BYTES = 256 * 1024

/** Cuántas líneas enseña la página por defecto. */
export const LINEAS_POR_DEFECTO = 200

/** Tope duro, para que un `?lineas=999999` no se convierta en un problema. */
export const LINEAS_MAXIMAS = 2_000

/**
 * Las últimas `maximo` líneas de un texto.
 *
 * Descarta la primera línea si el texto viene cortado por el principio
 * (`recortadoAlPrincipio`): al leer solo el final del archivo, esa primera
 * línea casi siempre está partida por la mitad, y media línea de registro
 * enseñada como si fuera entera confunde más de lo que informa.
 */
export function ultimasLineas(
    texto: string,
    maximo: number,
    recortadoAlPrincipio = false,
): string[] {
    const lineas = texto.split(/\r?\n/)
    if (recortadoAlPrincipio && lineas.length > 1) lineas.shift()

    // La última línea suele ser el '' que deja el salto final del archivo.
    while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop()

    return lineas.slice(Math.max(0, lineas.length - Math.max(1, maximo)))
}

export interface FinalDelRegistro {
    existe: boolean
    /** Tamaño total del archivo en disco, aunque solo se lea el final. */
    bytes: number
    lineas: string[]
    /** true si el archivo es más grande que lo que se enseña. */
    hayMas: boolean
}

/**
 * Las últimas líneas de `agente.log`, sin cargar el archivo entero.
 *
 * Nunca lanza: un registro que no se puede leer no es motivo para dejar la
 * página en blanco, y desde luego no lo es para tocar la impresión. Se
 * devuelve `existe: false` y ya.
 */
export async function leerFinalDelRegistro(
    ruta: string,
    maximo = LINEAS_POR_DEFECTO,
): Promise<FinalDelRegistro> {
    const tope = Math.min(Math.max(1, Math.floor(maximo)), LINEAS_MAXIMAS)

    let manejador: fs.promises.FileHandle | null = null
    try {
        manejador = await fs.promises.open(ruta, 'r')
        const { size } = await manejador.stat()

        const desde = Math.max(0, size - VENTANA_BYTES)
        const cuanto = size - desde
        const bufer = Buffer.alloc(cuanto)
        if (cuanto > 0) await manejador.read(bufer, 0, cuanto, desde)

        const lineas = ultimasLineas(bufer.toString('utf8'), tope, desde > 0)
        return { existe: true, bytes: size, lineas, hayMas: desde > 0 }
    } catch {
        return { existe: false, bytes: 0, lineas: [], hayMas: false }
    } finally {
        await manejador?.close().catch(() => { /* cerrar es best-effort */ })
    }
}

/** Nombre con el que se descarga, con la fecha dentro: en la bandeja de
 *  entrada de soporte van a acabar quince `agente.log` distintos. */
export function nombreDeDescarga(ahora = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `agente-${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}`
        + `-${p(ahora.getHours())}${p(ahora.getMinutes())}.log`
}
