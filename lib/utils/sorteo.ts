import crypto from 'node:crypto'

/**
 * Selección de ganadores de sorteo, determinista y reproducible.
 *
 * Todo aquí es una función pura: mismos argumentos, mismo resultado, siempre.
 * Esa es la propiedad que permite guardar la semilla y volver a demostrar
 * meses después que los ganadores salieron de un barajado limpio.
 *
 * NUNCA introduzcas Math.random() ni Date.now() en este archivo.
 */

/** Versión del algoritmo. Se guarda en cada ejecución para poder verificarla. */
export const ALGORITMO_SORTEO = 'mulberry32-fisher-yates-v1'

export interface TicketParticipante {
    id: string
    numero: number
    cliente_id: string
}

export interface ResultadoSorteo {
    ganadores: TicketParticipante[]
    /** Posición de cada boleto tras el barajado. Se persiste para auditoría. */
    orden: { ticketId: string; orden: number }[]
    poolCount: number
    poolHash: string
    /** true si no había clientes distintos suficientes para todos los premios. */
    ganadoresInsuficientes: boolean
}

/** Convierte un texto en un entero de 32 bits (xmur3). */
export function xmur3(texto: string): () => number {
    let h = 1779033703 ^ texto.length
    for (let i = 0; i < texto.length; i++) {
        h = Math.imul(h ^ texto.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507)
        h = Math.imul(h ^ (h >>> 13), 3266489909)
        h ^= h >>> 16
        return h >>> 0
    }
}

export function hashSemilla(texto: string): number {
    return xmur3(texto)()
}

/** Generador pseudoaleatorio con semilla. Devuelve valores en [0, 1). */
export function mulberry32(semilla: number): () => number {
    let a = semilla >>> 0
    return function () {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** Fisher-Yates alimentado por el generador dado. No muta la entrada. */
export function barajarDeterminista<T>(items: readonly T[], rng: () => number): T[] {
    const copia = [...items]
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const tmp = copia[i]
        copia[i] = copia[j]
        copia[j] = tmp
    }
    return copia
}

/**
 * Huella del conjunto de participantes, independiente del orden de entrada.
 * Sirve para detectar si el pool cambió después de ejecutar el sorteo
 * (por ejemplo, porque se anuló un boleto).
 */
export function calcularPoolHash(ids: readonly string[]): string {
    return crypto
        .createHash('sha256')
        .update([...ids].sort().join(','))
        .digest('hex')
}

/**
 * Elige `cantidad` boletos ganadores del pool.
 *
 * El pool se ordena por número de boleto antes de barajar, así el resultado
 * no depende del orden en que la base de datos haya devuelto las filas.
 * Después se recorre el barajado saltando los clientes que ya ganaron, hasta
 * completar los premios o agotar el pool.
 */
export function seleccionarGanadores(
    pool: readonly TicketParticipante[],
    cantidad: number,
    semilla: string,
): ResultadoSorteo {
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error('La cantidad de ganadores debe ser un entero positivo')
    }
    if (!semilla || !semilla.trim()) {
        throw new Error('La semilla no puede estar vacía')
    }

    const poolHash = calcularPoolHash(pool.map(t => t.id))

    if (pool.length === 0) {
        return {
            ganadores: [],
            orden: [],
            poolCount: 0,
            poolHash,
            ganadoresInsuficientes: true,
        }
    }

    // Orden canónico: sin esto, el resultado dependería del ORDER BY de la consulta.
    // Se desempata por `id` (único siempre, garantizado por la base) en vez de
    // confiar solo en `numero`. Hoy `numero` es único por sorteo por un índice
    // de base de datos, pero esa es una garantía externa a este archivo: si
    // algún día dos boletos comparten `numero` (o llega un valor repetido/NaN),
    // sin el desempate el orden de entrada volvería a filtrarse en el resultado
    // y el sorteo dejaría de ser reproducible. Con `id` como segundo criterio,
    // el orden canónico es total pase lo que pase con `numero`.
    const ordenado = [...pool].sort((a, b) => a.numero - b.numero || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const barajado = barajarDeterminista(ordenado, mulberry32(hashSemilla(semilla)))

    const ganadores: TicketParticipante[] = []
    const clientesPremiados = new Set<string>()

    for (const boleto of barajado) {
        if (ganadores.length >= cantidad) break
        if (clientesPremiados.has(boleto.cliente_id)) continue
        ganadores.push(boleto)
        clientesPremiados.add(boleto.cliente_id)
    }

    return {
        ganadores,
        orden: barajado.map((t, i) => ({ ticketId: t.id, orden: i })),
        poolCount: pool.length,
        poolHash,
        ganadoresInsuficientes: ganadores.length < cantidad,
    }
}
