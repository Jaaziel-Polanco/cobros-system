import fs from 'node:fs'

/**
 * Lectura y escritura del `.env` desde la interfaz local.
 *
 * El requisito que manda aquí: **el `.env` está escrito para quien instala
 * el agente**. Cada clave lleva encima un comentario que explica qué es y
 * qué pasa si la tocas, y en la PC de una tienda eso es la única
 * documentación que hay a mano. Regenerar el archivo desde cero con los
 * valores nuevos —que es lo que hace cualquier escritor de `.env` de una
 * línea— borraría todo eso la primera vez que alguien guarda desde la
 * interfaz. Por eso se edita el texto existente línea a línea y solo se
 * toca la parte de la derecha del `=`.
 */

/** Claves que la interfaz deja cambiar. Ninguna otra se escribe nunca. */
export const CLAVES_EDITABLES = [
    'API_URL',
    'ESTACION_TOKEN',
    'LOG_LEVEL',
    'POLL_ESPERA_MS',
    'MODO_SIMULADOR',
] as const

export type ClaveEditable = (typeof CLAVES_EDITABLES)[number]

/**
 * Enmascara el token para enseñarlo sin revelarlo.
 *
 * La interfaz escucha en localhost, pero la pantalla del mostrador la ve
 * cualquiera que pase por delante y una captura de pantalla enviada a
 * soporte viaja por WhatsApp. El token es la credencial completa de la
 * estación: con él se pueden reclamar los boletos de esa sucursal. Se
 * enseña lo justo para reconocer CUÁL token está puesto (los primeros y
 * los últimos caracteres) y nada más.
 *
 * Un token corto no se enseña en absoluto: con 8 caracteres, revelar 4 y 4
 * es revelarlo entero.
 */
export function enmascararToken(token: string | null | undefined): string {
    const t = (token ?? '').trim()
    if (!t) return '(sin token)'
    if (t.length <= 12) return '•'.repeat(8)
    return `${t.slice(0, 4)}${'•'.repeat(8)}${t.slice(-4)}`
}

/** Lee el `.env` con las mismas reglas que `config.ts`, sin tocar process.env. */
export function leerEnv(ruta: string): Record<string, string> {
    const valores: Record<string, string> = {}
    if (!fs.existsSync(ruta)) return valores

    for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
        const limpia = linea.trim()
        if (!limpia || limpia.startsWith('#')) continue
        const i = limpia.indexOf('=')
        if (i === -1) continue
        const clave = limpia.slice(0, i).trim()
        // Igual que `cargarEnv`: gana la PRIMERA aparición de una clave.
        if (!(clave in valores)) valores[clave] = limpia.slice(i + 1).trim()
    }
    return valores
}

/**
 * Devuelve el contenido del `.env` con los valores nuevos aplicados,
 * conservando todo lo demás: comentarios, líneas en blanco, orden, el
 * separador de línea del archivo y las claves que no se están cambiando.
 *
 * Detalles que importan y no son obvios:
 *
 * - Una línea comentada (`# API_URL=...`) NO se toca. En este `.env` los
 *   comentarios son documentación y ejemplos; convertirlos en configuración
 *   real al guardar sería cambiar el comportamiento del agente sin que
 *   nadie lo haya pedido.
 * - Si una clave aparece repetida, se actualizan TODAS las apariciones. El
 *   lector de `config.ts` se queda con la primera, pero dejar una segunda
 *   línea con el valor viejo es una trampa esperando a que alguien borre la
 *   primera; con todas iguales, da igual cuál gane.
 * - Una clave que no está en el archivo se añade al final, con un
 *   comentario que diga de dónde salió.
 */
export function aplicarCambiosEnv(
    contenido: string,
    cambios: Partial<Record<ClaveEditable, string>>,
): string {
    const usaCrlf = contenido.includes('\r\n')
    const salto = usaCrlf ? '\r\n' : '\n'
    const terminaEnSalto = contenido === '' || /\r?\n$/.test(contenido)

    const lineas = contenido.split(/\r?\n/)
    if (terminaEnSalto && lineas[lineas.length - 1] === '') lineas.pop()

    const pendientes = new Set(Object.keys(cambios) as ClaveEditable[])

    const resultado = lineas.map(linea => {
        const limpia = linea.trim()
        if (!limpia || limpia.startsWith('#')) return linea

        const i = limpia.indexOf('=')
        if (i === -1) return linea

        const clave = limpia.slice(0, i).trim() as ClaveEditable
        if (!(clave in cambios)) return linea

        pendientes.delete(clave)
        // Se respeta la sangría original de la línea (si la hubiera) y se
        // reescribe solo `CLAVE=valor`: ni comillas ni espacios alrededor
        // del `=`, que es exactamente lo que sabe leer `config.ts`.
        const sangria = linea.slice(0, linea.length - linea.trimStart().length)
        return `${sangria}${clave}=${cambios[clave]}`
    })

    if (pendientes.size > 0) {
        if (resultado.length > 0 && resultado[resultado.length - 1].trim() !== '') resultado.push('')
        resultado.push('# Añadido por la interfaz local del agente.')
        for (const clave of CLAVES_EDITABLES) {
            if (pendientes.has(clave)) resultado.push(`${clave}=${cambios[clave]}`)
        }
    }

    return resultado.join(salto) + (terminaEnSalto ? salto : '')
}

/**
 * Escribe el `.env` con los cambios, sin perder el archivo si algo va mal a
 * mitad.
 *
 * Se guarda una copia en `.env.bak` antes de tocar nada y se escribe en un
 * temporal que después se renombra encima. Sin lo primero, un error en esta
 * función se lleva por delante los comentarios de instalación y no hay
 * forma de recuperarlos; sin lo segundo, un corte de luz justo al guardar
 * deja un `.env` a medias y el agente no vuelve a arrancar.
 */
export function escribirEnv(
    ruta: string,
    cambios: Partial<Record<ClaveEditable, string>>,
): void {
    const contenido = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : ''
    const nuevo = aplicarCambiosEnv(contenido, cambios)

    if (contenido !== '') {
        try {
            fs.writeFileSync(`${ruta}.bak`, contenido, 'utf8')
        } catch {
            /* La copia de seguridad es una red, no un requisito: si el disco
               no deja escribirla, guardar igual es mejor que no guardar. */
        }
    }

    const temporal = `${ruta}.tmp`
    fs.writeFileSync(temporal, nuevo, 'utf8')
    fs.renameSync(temporal, ruta)
}

export interface ErrorValidacion {
    clave: ClaveEditable
    mensaje: string
}

/**
 * Comprueba los valores ANTES de escribirlos.
 *
 * Un `.env` con un valor imposible (un `POLL_ESPERA_MS` que no es un
 * número, un `MODO_SIMULADOR` inventado) hace que `cargarConfig()` lance al
 * arrancar y el agente no levante — y eso se descubre al reiniciar, cuando
 * ya nadie relaciona el fallo con lo que guardó hace una hora. Aquí se
 * rechaza en el momento, con el motivo delante.
 */
export function validarCambios(
    cambios: Partial<Record<ClaveEditable, string>>,
): ErrorValidacion[] {
    const errores: ErrorValidacion[] = []

    for (const [clave, valor] of Object.entries(cambios) as [ClaveEditable, string][]) {
        // Un salto de línea partiría el .env en dos y convertiría el resto
        // del valor en una clave inventada. Se corta aquí, para cualquier clave.
        if (/[\r\n]/.test(valor)) {
            errores.push({ clave, mensaje: 'No puede contener saltos de línea' })
            continue
        }

        if (clave === 'API_URL') {
            if (!/^https?:\/\/[^\s]+$/i.test(valor)) {
                errores.push({
                    clave,
                    mensaje: 'Tiene que empezar por http:// o https://, por ejemplo http://192.168.1.50:3000',
                })
            }
        }

        if (clave === 'ESTACION_TOKEN') {
            if (/\s/.test(valor)) {
                errores.push({ clave, mensaje: 'El token no lleva espacios; pégalo tal cual lo copiaste' })
            } else if (valor.length < 8) {
                errores.push({ clave, mensaje: 'Parece incompleto: un token tiene bastantes más caracteres' })
            }
        }

        if (clave === 'LOG_LEVEL' && !['debug', 'info', 'warn', 'error'].includes(valor)) {
            errores.push({ clave, mensaje: 'Solo puede ser debug, info, warn o error' })
        }

        if (clave === 'POLL_ESPERA_MS') {
            const n = Number(valor)
            if (!/^\d+$/.test(valor) || !Number.isFinite(n) || n > 120_000) {
                errores.push({ clave, mensaje: 'Tiene que ser un número entero de milisegundos, entre 0 y 120000' })
            }
        }

        if (clave === 'MODO_SIMULADOR' && valor !== '' && valor !== 'archivo') {
            errores.push({ clave, mensaje: 'Déjalo vacío para imprimir de verdad, o pon "archivo" para no imprimir' })
        }
    }

    return errores
}
