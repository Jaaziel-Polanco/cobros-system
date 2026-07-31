import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { imprimirRed } from './impresora-red'

let servidor: net.Server | null = null

afterEach(() => {
    servidor?.close()
    servidor = null
})

function servidorFalso(
    alRecibir: (datos: Buffer) => void,
): Promise<number> {
    return new Promise(resolve => {
        servidor = net.createServer(socket => {
            socket.on('data', alRecibir)
        })
        servidor.listen(0, '127.0.0.1', () => {
            resolve((servidor!.address() as net.AddressInfo).port)
        })
    })
}

describe('imprimirRed', () => {
    it('envía los bytes exactos a la impresora', async () => {
        let recibido: Buffer | null = null
        const puerto = await servidorFalso(d => { recibido = d })

        await imprimirRed('127.0.0.1', puerto, Buffer.from([0x1b, 0x40, 0x41]))

        // Pequeña espera para que el servidor procese el 'data'
        await new Promise(r => setTimeout(r, 50))
        expect(recibido).toEqual(Buffer.from([0x1b, 0x40, 0x41]))
    })

    it('RECHAZA cuando la impresora no está accesible', async () => {
        // Puerto cerrado: el servicio de referencia resolvía en este caso y
        // marcaba como impreso lo que nunca salió. Aquí debe rechazar.
        await expect(
            imprimirRed('127.0.0.1', 1, Buffer.from([0x41]), 500),
        ).rejects.toThrow()
    })

    it('RECHAZA por timeout cuando la impresora no responde', async () => {
        // 10.255.255.1 es una dirección no enrutable: la conexión se cuelga
        await expect(
            imprimirRed('10.255.255.1', 9100, Buffer.from([0x41]), 300),
        ).rejects.toThrow(/[Tt]imeout/)
    })

    it('incluye la dirección en el mensaje de error', async () => {
        await expect(
            imprimirRed('127.0.0.1', 1, Buffer.from([0x41]), 500),
        ).rejects.toThrow(/127\.0\.0\.1:1/)
    })
})
