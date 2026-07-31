/**
 * Manda una tirilla de boleto a una impresora ESC/POS por TCP.
 *
 * Pensado para el emulador de escritorio EscPosEmulator, pero sirve igual
 * contra una impresora de red de verdad: son los mismos bytes que enviaría
 * el agente de la sucursal, construidos con el mismo código del servidor.
 *
 *   npm run emulador                          (127.0.0.1:1234)
 *   npm run emulador -- --puerto 9100
 *   npm run emulador -- --host 192.168.1.77 --puerto 9100
 *   npm run emulador -- --caso copia          normal | copia | huerfano | largo
 *   npm run emulador -- --sin-qr              omite el QR (ver README)
 */

import net from 'node:net'
import { construirTirillaTicket } from '../lib/escpos/tirilla-ticket'
import type { TicketSnapshot } from '../lib/types'

const args = process.argv.slice(2)
const valor = (bandera: string, pordefecto: string) => {
    const i = args.indexOf(bandera)
    return i >= 0 && args[i + 1] ? args[i + 1] : pordefecto
}

const HOST = valor('--host', '127.0.0.1')
const PUERTO = Number(valor('--puerto', '1234'))
const CASO = valor('--caso', 'normal')
const ANCHO = Number(valor('--cols', '48'))
const SIN_QR = args.includes('--sin-qr')

const NEGOCIO = {
    nombre_comercial: 'Inversiones Héctor Cordero',
    rnc: '132966562',
    direccion: '',
    telefono: '8296190004',
    texto_legal: 'esto es una prueba',
    url_terminos: null,
    pie_impresion: '',
    logo_url: null,
}

const CLIENTE = {
    id: '00000000-0000-0000-0000-000000000001',
    nombre: 'María Altagracia',
    apellido: 'Muñoz Peña',
    telefono: '8095551234',
    dni_ruc: '001-1234567-8',
}

const SORTEO = {
    id: '00000000-0000-0000-0000-0000000000aa',
    nombre: 'Gran Sorteo de Navidad',
    premio: 'Un televisor Smart TV de 55 pulgadas',
    fecha_fin: '2026-12-24',
}

const snap = (sorteo: TicketSnapshot['sorteo']): TicketSnapshot =>
    ({
        cliente: CLIENTE,
        sorteo,
        negocio: NEGOCIO,
        emitido_at_rd: '31/07/2026 10:42 AM',
        origen: 'automatico',
        version_snapshot: 1,
    }) as TicketSnapshot

const CASOS: Record<string, { numero: string; snap: TicketSnapshot; esCopia: boolean }> = {
    normal: { numero: 'NAV-000042', snap: snap(SORTEO), esCopia: false },
    copia: { numero: 'NAV-000042', snap: snap(SORTEO), esCopia: true },
    huerfano: { numero: 'BOL-SN-000001', snap: snap(null), esCopia: false },
    largo: {
        numero: 'NAV-000007',
        snap: snap({
            ...SORTEO,
            nombre: 'Sorteo Aniversario 25 Años Inversiones Héctor Cordero',
            premio: 'Una motocicleta 0 km más un año de seguro pagado y un bono de RD$25,000 en efectivo',
        }),
        esCopia: false,
    },
}

const elegido = CASOS[CASO]
if (!elegido) {
    console.error(`Caso desconocido: "${CASO}". Usa: ${Object.keys(CASOS).join(' | ')}`)
    process.exit(1)
}

let { bytes } = construirTirillaTicket({
    numeroFormateado: elegido.numero,
    snapshot: elegido.snap,
    esCopia: elegido.esCopia,
    anchoCols: ANCHO,
    codepage: 'cp850',
    urlPublica: 'https://cobros.example.com/t/8Kj2mNpQ7rStUvWxYz0123456789AbCdEfGh',
})

if (SIN_QR) {
    // El emulador de escritorio no implementa GS ( k (código QR): al no
    // reconocerlo, escupe la URL como texto suelto en mitad del boleto. Una
    // impresora real sí lo dibuja. Esta bandera recorta ese bloque para poder
    // juzgar la maquetación sin ese ruido; NO cambia lo que se imprime de
    // verdad.
    const inicio = bytes.indexOf(Buffer.from([0x1d, 0x28, 0x6b]))
    const fin = bytes.lastIndexOf(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]))
    if (inicio >= 0 && fin > inicio) {
        bytes = Buffer.concat([bytes.subarray(0, inicio), bytes.subarray(fin + 8)])
    }
}

const socket = new net.Socket()
socket.setTimeout(5000)

socket.connect(PUERTO, HOST, () => {
    console.log(`Conectado a ${HOST}:${PUERTO} — enviando "${CASO}" (${bytes.length} bytes)`)
    socket.end(bytes)
})

socket.on('close', () => {
    console.log('Enviado y conexión cerrada. Mira la ventana del emulador.')
})

socket.on('timeout', () => {
    console.error(`Sin respuesta de ${HOST}:${PUERTO}. ¿Está el emulador abierto?`)
    socket.destroy()
    process.exit(1)
})

socket.on('error', e => {
    console.error(`No se pudo enviar a ${HOST}:${PUERTO} — ${e.message}`)
    console.error('Comprueba que el emulador esté abierto y en qué puerto escucha.')
    process.exit(1)
})
