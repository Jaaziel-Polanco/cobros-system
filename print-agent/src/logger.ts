import fs from 'node:fs'
import path from 'node:path'

const NIVELES = { debug: 10, info: 20, warn: 30, error: 40 } as const
type Nivel = keyof typeof NIVELES

const ARCHIVO = path.join(__dirname, '..', 'agente.log')
const MAX_BYTES = 5 * 1024 * 1024

let umbral: number = NIVELES.info

export function configurarLog(nivel: string): void {
    umbral = NIVELES[nivel as Nivel] ?? NIVELES.info
}

function rotarSiHaceFalta(): void {
    try {
        if (fs.existsSync(ARCHIVO) && fs.statSync(ARCHIVO).size > MAX_BYTES) {
            fs.renameSync(ARCHIVO, ARCHIVO + '.1')
        }
    } catch { /* la rotación nunca debe tumbar el agente */ }
}

function escribir(nivel: Nivel, mensaje: string): void {
    if (NIVELES[nivel] < umbral) return

    const linea = `[${new Date().toISOString()}] ${nivel.toUpperCase().padEnd(5)} ${mensaje}`
    console.log(linea)

    try {
        rotarSiHaceFalta()
        fs.appendFileSync(ARCHIVO, linea + '\n')
    } catch { /* si no se puede escribir el archivo, basta la consola */ }
}

export const log = {
    debug: (m: string) => escribir('debug', m),
    info: (m: string) => escribir('info', m),
    warn: (m: string) => escribir('warn', m),
    error: (m: string) => escribir('error', m),
}
