import fs from 'node:fs'
import path from 'node:path'
import { interpretarEscPos } from './interprete-escpos'
import type { DestinoImpresora } from './tipos'

/**
 * Modo simulador del propio agente: en vez de imprimir de verdad, vuelca
 * los bytes a un archivo (por si hace falta inspeccionarlos con un
 * visor hexadecimal) y su interpretación legible a la consola.
 *
 * Se activa con `MODO_SIMULADOR=archivo` en el `.env` y NUNCA debe
 * encenderse en una PC de sucursal real: ahí no imprimiría nada.
 */

const CARPETA = path.join(__dirname, '..', 'volcado-simulador')

export async function volcarASimulador(
    destino: DestinoImpresora,
    bytes: Buffer,
): Promise<void> {
    fs.mkdirSync(CARPETA, { recursive: true })

    const marca = new Date().toISOString().replace(/[:.]/g, '-')
    const rutaBin = path.join(CARPETA, `boleto-${marca}.bin`)
    fs.writeFileSync(rutaBin, bytes)

    // El ancho lo manda el servidor con el destino. Si no viene (servidor
    // anterior a ese cambio), 48 columnas, que es el papel de 80 mm.
    const cols = destino.ancho_cols ?? 48
    const { lienzo } = interpretarEscPos(bytes, cols)

    console.log('')
    console.log(`━━━ SIMULADOR (modo archivo) — destino: ${destino.tipo_conexion === 'windows' ? destino.nombre : `${destino.ip}:${destino.port}`} ━━━`)
    console.log(`Bytes: ${bytes.length} · ${cols} columnas · guardados en ${rutaBin}`)
    console.log(lienzo)
    console.log('━'.repeat(60))
    console.log('')
}
