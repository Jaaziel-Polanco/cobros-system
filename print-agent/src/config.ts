import fs from 'node:fs'
import path from 'node:path'

export interface Config {
    apiUrl: string
    token: string
    pollEsperaMs: number
    logLevel: string
    /** '' imprime de verdad; 'archivo' activa el modo simulador sin impresora. */
    modoSimulador: '' | 'archivo'
    /**
     * Puerto de la interfaz local (siempre en 127.0.0.1). 0 la desactiva
     * por completo, para quien no la quiera en la PC de la tienda.
     */
    uiPuerto: number
}

/** El `.env` vive junto al `dist/`, no dentro. Un único sitio que lo diga. */
export const RUTA_ENV = path.join(__dirname, '..', '.env')

export const UI_PUERTO_POR_DEFECTO = 9110

/** Lector mínimo de .env: evita añadir dotenv como dependencia. */
function cargarEnv(ruta: string): void {
    if (!fs.existsSync(ruta)) return
    for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
        const limpia = linea.trim()
        if (!limpia || limpia.startsWith('#')) continue
        const i = limpia.indexOf('=')
        if (i === -1) continue
        const clave = limpia.slice(0, i).trim()
        const valor = limpia.slice(i + 1).trim()
        if (!(clave in process.env)) process.env[clave] = valor
    }
}

/**
 * Puerto de la interfaz local.
 *
 * Un valor inválido (una letra, un puerto fuera de rango) NO tumba el
 * agente: se avisa y se usa el de por defecto. El agente existe para
 * imprimir; que no se pueda leer el puerto del panel de diagnóstico no es
 * motivo para dejar una tienda sin cobrar.
 */
export function resolverUiPuerto(bruto: string | undefined): { puerto: number; aviso?: string } {
    const texto = (bruto ?? '').trim()
    if (texto === '') return { puerto: UI_PUERTO_POR_DEFECTO }

    const n = Number(texto)
    if (!Number.isInteger(n) || n < 0 || n > 65_535) {
        return {
            puerto: UI_PUERTO_POR_DEFECTO,
            aviso: `UI_PUERTO="${texto}" no es un puerto válido; se usa ${UI_PUERTO_POR_DEFECTO}. `
                + 'Pon 0 si quieres desactivar la interfaz local.',
        }
    }
    return { puerto: n }
}

export function cargarConfig(): Config {
    cargarEnv(RUTA_ENV)

    const apiUrl = process.env.API_URL?.replace(/\/$/, '')
    const token = process.env.ESTACION_TOKEN

    if (!apiUrl) throw new Error('Falta API_URL en el archivo .env')
    if (!token || token === 'pega_aqui_el_token') {
        throw new Error('Falta ESTACION_TOKEN en el archivo .env')
    }

    const modo = (process.env.MODO_SIMULADOR ?? '').trim()
    if (modo !== '' && modo !== 'archivo') {
        throw new Error(`MODO_SIMULADOR desconocido: "${modo}" (usa "archivo" o déjalo vacío)`)
    }

    return {
        apiUrl,
        token,
        pollEsperaMs: Number(process.env.POLL_ESPERA_MS ?? 25_000),
        logLevel: process.env.LOG_LEVEL ?? 'info',
        modoSimulador: modo as '' | 'archivo',
        uiPuerto: resolverUiPuerto(process.env.UI_PUERTO).puerto,
    }
}
