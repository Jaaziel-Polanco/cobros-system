import net from 'node:net'

/**
 * Escribe bytes crudos en una impresora ESC/POS conectada por red, vía TCP.
 *
 * A diferencia del servicio de referencia del restaurante
 * (printer-service/services/escpos.ts), esta función RECHAZA la promesa
 * ante cualquier fallo. Aquella resolvía también en 'error' y en 'timeout',
 * y el llamador terminaba marcando como impreso lo que nunca salió del
 * papel. Aquí un fallo real siempre se propaga como rechazo.
 */
export function imprimirRed(
    ip: string,
    puerto: number,
    bytes: Buffer,
    timeoutMs = 8_000,
): Promise<void> {
    return new Promise((resolver, rechazar) => {
        let terminado = false

        const acabar = (err?: Error) => {
            if (terminado) return
            terminado = true
            socket.destroy()
            err ? rechazar(err) : resolver()
        }

        const socket = net.createConnection({ host: ip, port: puerto, timeout: timeoutMs })

        socket.on('connect', () => {
            socket.write(bytes, err => {
                if (err) {
                    acabar(new Error(`Fallo al escribir en ${ip}:${puerto} — ${err.message}`))
                    return
                }
                // `end` cierra la escritura; el 'close' posterior confirma el envío
                socket.end()
            })
        })

        socket.on('error', (err: NodeJS.ErrnoException) => {
            acabar(new Error(`No se pudo imprimir en ${ip}:${puerto} — ${err.code ?? ''} ${err.message}`.trim()))
        })

        socket.on('timeout', () => {
            acabar(new Error(`Timeout de ${timeoutMs} ms conectando con ${ip}:${puerto}`))
        })

        socket.on('close', hadError => {
            if (!hadError) acabar()
        })
    })
}
