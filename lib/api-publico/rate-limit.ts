/**
 * Limitador de tasa en memoria para las rutas públicas.
 *
 * Deliberadamente simple: este sistema corre en un único proceso Node
 * autohospedado, así que un Map basta y evita añadir Redis. Si algún día se
 * escala a varias instancias, habrá que moverlo a almacenamiento compartido.
 */

interface Ventana {
    conteo: number
    expira: number
}

const ventanas = new Map<string, Ventana>()
const LIMPIEZA_CADA = 5 * 60_000
let ultimaLimpieza = 0

function limpiarVencidas(ahora: number): void {
    if (ahora - ultimaLimpieza < LIMPIEZA_CADA) return
    ultimaLimpieza = ahora
    for (const [clave, v] of ventanas) {
        if (v.expira <= ahora) ventanas.delete(clave)
    }
}

/**
 * Devuelve true si la petición se permite.
 * Por defecto: 30 peticiones por minuto y clave.
 */
export function permitir(
    clave: string,
    limite = 30,
    ventanaMs = 60_000,
): boolean {
    const ahora = Date.now()
    limpiarVencidas(ahora)

    const actual = ventanas.get(clave)

    if (!actual || actual.expira <= ahora) {
        ventanas.set(clave, { conteo: 1, expira: ahora + ventanaMs })
        return true
    }

    actual.conteo++
    return actual.conteo <= limite
}

/** IP del peticionario, mirando primero las cabeceras del proxy inverso. */
export function ipDe(req: Request): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'desconocida'
    )
}
