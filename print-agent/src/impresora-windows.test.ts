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

/**
 * El estado de una impresora es lo que separa «no existe» de «existe pero
 * no va a sacar papel», que hasta ahora se veían igual. Windows lo dice con
 * una lista de banderas, a veces varias a la vez, y traducirlas mal tiene
 * coste en las dos direcciones: dar por lista una impresora pausada esconde
 * el fallo, y dar por rota una que imprime bien enseña a ignorar el rojo.
 */
describe('clasificarEstadoImpresora', () => {
    it('lo normal es que esté lista, se diga como se diga', async () => {
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        for (const crudo of ['Normal', 'Idle', 'Printing', 'IOActive', 'Busy, Printing']) {
            expect(clasificarEstadoImpresora(crudo).estado).toBe('lista')
        }
    })

    it('la pausa se reconoce y se explica: es el fallo silencioso de verdad', async () => {
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        const r = clasificarEstadoImpresora('Paused')
        expect(r.estado).toBe('pausa')
        expect(r.texto).toMatch(/PAUSA/)
    })

    it('la pausa manda aunque venga con otras banderas', async () => {
        // Con "Paused, Error" hay dos cosas que arreglar, pero la primera
        // que hay que quitar es la pausa: sin eso no sale nada aunque el
        // error se resuelva.
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        expect(clasificarEstadoImpresora('Paused, Error').estado).toBe('pausa')
        expect(clasificarEstadoImpresora('Offline, Paused').estado).toBe('pausa')
    })

    it('sin conexión no es lo mismo que error', async () => {
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        expect(clasificarEstadoImpresora('Offline').estado).toBe('sin-conexion')
        expect(clasificarEstadoImpresora('NotAvailable').estado).toBe('sin-conexion')
    })

    it('«Normal, Offline» es sin conexión, no «lista»', async () => {
        // Comprobado en Windows 11: con «Usar impresora sin conexión»
        // marcado, Get-Printer sigue diciendo PrinterStatus = Normal y solo
        // Win32_Printer.WorkOffline lo delata. El script pega esa bandera al
        // final del estado, así que aquí llegan las dos a la vez y la que
        // manda tiene que ser la mala: con la impresora sin conexión Windows
        // acepta los boletos igual y no sale ninguno.
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        expect(clasificarEstadoImpresora('Normal, Offline').estado).toBe('sin-conexion')
    })

    it('cada avería lleva su motivo en castellano', async () => {
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        expect(clasificarEstadoImpresora('PaperOut').texto).toMatch(/sin papel/i)
        expect(clasificarEstadoImpresora('PaperJam').texto).toMatch(/atascado/i)
        expect(clasificarEstadoImpresora('DoorOpen').texto).toMatch(/tapa/i)
        expect(clasificarEstadoImpresora('PaperOut').estado).toBe('error')
    })

    it('no grita por lo que no impide imprimir', async () => {
        // Una impresora térmica de tickets no tiene tóner, y "poco tóner"
        // no ha impedido nunca que salga un boleto: marcarlo en rojo sería
        // el mismo error que marcar en rojo una diferencia de mayúsculas.
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        expect(clasificarEstadoImpresora('TonerLow').estado).toBe('lista')
        expect(clasificarEstadoImpresora('WarmingUp').estado).toBe('lista')
    })

    it('ante una bandera que no conoce no se inventa un veredicto', async () => {
        const { clasificarEstadoImpresora } = await import('./impresora-windows')
        const r = clasificarEstadoImpresora('LoQueSea')
        expect(r.estado).toBe('desconocido')
        expect(r.texto).toContain('LoQueSea')
        expect(clasificarEstadoImpresora('').estado).toBe('desconocido')
    })
})

describe('analizarSalidaImpresoras', () => {
    it('lee una impresora entera, con puerto, controlador y predeterminada', async () => {
        const { SEP } = await import('./powershell')
        const { analizarSalidaImpresoras } = await import('./impresora-windows')

        const salida = `P${SEP}POS${SEP}Normal${SEP}EmuladorPOS_9100${SEP}Generic / Text Only${SEP}1${SEP}3`
        expect(analizarSalidaImpresoras(salida)).toEqual([{
            nombre: 'POS',
            estado: 'lista',
            estadoCrudo: 'Normal',
            estadoTexto: 'Lista para imprimir',
            puerto: 'EmuladorPOS_9100',
            controlador: 'Generic / Text Only',
            predeterminada: true,
            enCola: 3,
        }])
    })

    it('distingue «cero trabajos en cola» de «no se pudo contar»', async () => {
        // El script manda 'x' cuando no pudo consultar la cola. Enseñar eso
        // como un 0 diría "no hay nada atascado" sin haberlo mirado.
        const { SEP } = await import('./powershell')
        const { analizarSalidaImpresoras } = await import('./impresora-windows')

        const base = `${SEP}Normal${SEP}p${SEP}d${SEP}0${SEP}`
        expect(analizarSalidaImpresoras(`P${SEP}A${base}0`)[0].enCola).toBe(0)
        expect(analizarSalidaImpresoras(`P${SEP}A${base}x`)[0].enCola).toBeNull()
    })

    it('un nombre con espacio al final llega tal cual', async () => {
        const { SEP } = await import('./powershell')
        const { analizarSalidaImpresoras } = await import('./impresora-windows')

        const salida = `P${SEP} POS ${SEP}Normal${SEP}p${SEP}d${SEP}0${SEP}0`
        expect(analizarSalidaImpresoras(salida)[0].nombre).toBe(' POS ')
    })

    it('con la máscara de bits de WMI traducida por el script, entiende lo mismo', async () => {
        // El camino de respaldo (Win32_Printer) emite los mismos nombres de
        // bandera que Get-Printer a propósito: si no, habría dos
        // vocabularios y uno de los dos se quedaría sin probar.
        const { SEP } = await import('./powershell')
        const { analizarSalidaImpresoras } = await import('./impresora-windows')

        const salida = `P${SEP}POS${SEP}Paused, Offline${SEP}USB001${SEP}d${SEP}0${SEP}2`
        expect(analizarSalidaImpresoras(salida)[0].estado).toBe('pausa')
    })

    it('una salida vacía es una lista vacía, no un error', async () => {
        const { analizarSalidaImpresoras } = await import('./impresora-windows')
        expect(analizarSalidaImpresoras('')).toEqual([])
    })
})
