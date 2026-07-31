import net from 'node:net'
import { interpretarEscPos } from './interprete-escpos'

/**
 * Simulador de impresora de red.
 *
 * Herramienta de desarrollo: no hay impresora física disponible mientras se
 * construye el agente, así que este servidor TCP hace de impresora
 * `tipo_conexion = "red"`. Escucha en un puerto, recibe los bytes que el
 * agente le manda y dibuja en consola cómo quedaría el papel — lo bastante
 * legible como para poder decir "sí, eso es un boleto".
 *
 * Se lanza con `npm run sim` (ver package.json). El puerto y el ancho de
 * columnas se configuran por variables de entorno para poder apuntar una
 * estación de prueba real contra este simulador.
 */

const PUERTO = Number(process.env.SIM_PUERTO ?? 9100)
const HOST = process.env.SIM_HOST ?? '0.0.0.0'
const ANCHO_COLS = Number(process.env.SIM_ANCHO_COLS ?? 48)

let contador = 0

const servidor = net.createServer(socket => {
    const remoto = `${socket.remoteAddress}:${socket.remotePort}`
    console.log(`[simulador] conexión de ${remoto}`)

    const trozos: Buffer[] = []

    socket.on('data', d => trozos.push(d))

    socket.on('end', () => {
        const bytes = Buffer.concat(trozos)
        if (!bytes.length) return

        contador++
        const { lienzo, cortado } = interpretarEscPos(bytes, ANCHO_COLS)

        console.log('')
        console.log(`╔═ BOLETO #${contador} recibido de ${remoto} (${bytes.length} bytes) ═╗`)
        console.log(lienzo)
        console.log(cortado ? '[simulador] papel cortado' : '[simulador] AVISO: el flujo no terminó en un corte')
        console.log('')
    })

    socket.on('error', err => {
        console.log(`[simulador] error de conexión con ${remoto}: ${err.message}`)
    })
})

servidor.listen(PUERTO, HOST, () => {
    console.log(`Simulador de impresora de red escuchando en ${HOST}:${PUERTO} (${ANCHO_COLS} columnas)`)
    console.log('Apunta la estación de prueba (tipo_conexion = red) a este puerto y encola un boleto.')
})

process.on('SIGINT', () => { console.log('\nSimulador detenido'); process.exit(0) })
