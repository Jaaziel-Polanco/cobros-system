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

/**
 * Tope agregado, sin clave: es el freno que sobrevive a la falsificación de
 * `X-Forwarded-For` (ver `ipDe`). El cupo por IP es una cortesía para no
 * penalizar a un usuario legítimo por los demás; este es el que de verdad
 * protege el proceso, porque no depende de nada que controle el cliente.
 * Se implementa reutilizando `permitir` con una clave constante compartida
 * por todas las peticiones.
 */
export function permitirGlobal(limite = 120, ventanaMs = 60_000): boolean {
    return permitir('__global__', limite, ventanaMs)
}

/**
 * IP del peticionario, mirando las cabeceras del proxy inverso SOLO si
 * `TRUST_PROXY_HEADERS=true`. Por defecto está desactivado a propósito:
 * `X-Forwarded-For` / `X-Real-IP` las manda el cliente y, si no hay un proxy
 * de confianza delante que las reescriba (el Dockerfile de este proyecto
 * expone Node directamente, sin uno), un atacante puede falsificarlas para
 * esquivar el límite por IP con una cabecera distinta en cada petición.
 * Con la confianza desactivada, todas las peticiones caen bajo la misma
 * clave constante ('sin-proxy'): el cupo por IP se degrada a un cupo
 * compartido, y es `permitirGlobal` (que no depende de ninguna cabecera)
 * quien sigue frenando de verdad.
 */
export function ipDe(req: Request): string {
    if (process.env.TRUST_PROXY_HEADERS !== 'true') {
        return 'sin-proxy'
    }
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'desconocida'
    )
}
