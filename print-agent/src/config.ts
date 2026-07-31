import fs from 'node:fs'
import path from 'node:path'

export interface Config {
    apiUrl: string
    token: string
    pollEsperaMs: number
    logLevel: string
    /** '' imprime de verdad; 'archivo' activa el modo simulador sin impresora. */
    modoSimulador: '' | 'archivo'
}

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

export function cargarConfig(): Config {
    cargarEnv(path.join(__dirname, '..', '.env'))

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
    }
}
