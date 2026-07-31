import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Simulamos powershell.exe: aquí no hay impresora real ni Windows en CI.
// Lo que se prueba es que imprimirWindows arma el proceso correctamente y,
// sobre todo, que RECHAZA ante error y ante timeout — el mismo defecto
// central que imprimirRed no debe repetir.
const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}))

function procesoFalso() {
    const proceso = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter
        stdout: EventEmitter
        kill: () => void
    }
    proceso.stderr = new EventEmitter()
    proceso.stdout = new EventEmitter()
    proceso.kill = vi.fn()
    return proceso
}

beforeEach(() => {
    spawnMock.mockReset()
})

describe('imprimirWindows', () => {
    it('invoca powershell.exe con el nombre de la impresora', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('POS-80', Buffer.from([0x1b, 0x40]))

        setImmediate(() => proceso.emit('close', 0))
        await promesa

        expect(spawnMock).toHaveBeenCalledWith(
            'powershell.exe',
            expect.arrayContaining(['-PrinterName', 'POS-80']),
        )
    })

    it('resuelve cuando powershell termina con código 0', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('POS-80', Buffer.from([0x41]))
        setImmediate(() => proceso.emit('close', 0))

        await expect(promesa).resolves.toBeUndefined()
    })

    it('RECHAZA cuando powershell termina con código distinto de 0', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('Impresora Inexistente', Buffer.from([0x41]))
        setImmediate(() => {
            proceso.stderr.emit('data', Buffer.from('No se pudo abrir la impresora'))
            proceso.emit('close', 1)
        })

        await expect(promesa).rejects.toThrow(/Impresora Inexistente/)
    })

    it('RECHAZA si el proceso de powershell no se puede lanzar', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('POS-80', Buffer.from([0x41]))
        setImmediate(() => proceso.emit('error', new Error('ENOENT')))

        await expect(promesa).rejects.toThrow(/POS-80/)
    })

    it('resuelve (no rechaza) cuando el script solo deja un AVISO de la cola de Windows', async () => {
        // WritePrinter ya tuvo éxito: el spooler aceptó los bytes. Un
        // AVISO es información de mejor esfuerzo, no una confirmación de
        // fallo — por eso esto debe resolver, no rechazar.
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('POS-80', Buffer.from([0x41]))
        setImmediate(() => {
            proceso.stdout.emit('data', Buffer.from("AVISO: el trabajo quedo en la cola de Windows con estado 'Error'\nOK\n"))
            proceso.emit('close', 0)
        })

        await expect(promesa).resolves.toBeUndefined()
    })

    it('drena stdout sin colgarse aunque el script escriba mucho', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        const promesa = imprimirWindows('POS-80', Buffer.from([0x41]), 500)
        const salidaLarga = Buffer.from('x'.repeat(200_000))
        setImmediate(() => {
            proceso.stdout.emit('data', salidaLarga)
            proceso.emit('close', 0)
        })

        await expect(promesa).resolves.toBeUndefined()
    })

    it('RECHAZA por timeout cuando powershell se cuelga sin responder', async () => {
        const proceso = procesoFalso()
        spawnMock.mockReturnValue(proceso)

        const { imprimirWindows } = await import('./impresora-windows')
        // Nunca emitimos 'close': el proceso simulado se queda colgado.
        await expect(
            imprimirWindows('POS-80', Buffer.from([0x41]), 50),
        ).rejects.toThrow(/[Tt]imeout/)
        expect(proceso.kill).toHaveBeenCalled()
    })
})
