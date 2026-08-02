import { describe, it, expect } from 'vitest'
import { SEP } from './powershell'
import {
    MINUTOS_PARA_ATASCO, analizarSalidaCancelacion, analizarSalidaCola,
    cancelarEnColaWindows, clasificarEstadoTrabajo,
} from './cola-windows'

/** Una línea de trabajo tal como la emite el script. */
function filaTrabajo(campos: Partial<{
    id: string; documento: string; estado: string; propietario: string;
    paginas: string; bytes: string; enviado: string
}> = {}): string {
    const c = {
        id: '11', documento: 'Boleto', estado: 'Normal', propietario: 'caja1',
        paginas: '1', bytes: '412', enviado: new Date().toISOString(),
        ...campos,
    }
    return ['T', c.id, c.documento, c.estado, c.propietario, c.paginas, c.bytes, c.enviado].join(SEP)
}

describe('clasificarEstadoTrabajo', () => {
    it('lo que está saliendo ahora no es un atasco', async () => {
        expect(clasificarEstadoTrabajo('Printing', 0).estado).toBe('imprimiendo')
        expect(clasificarEstadoTrabajo('Spooling', 0).estado).toBe('imprimiendo')
    })

    it('recién enviado y sin banderas malas es solo esperar', () => {
        expect(clasificarEstadoTrabajo('Normal', 0).estado).toBe('esperando')
    })

    it('el tiempo en cola basta para llamarlo atascado', () => {
        // Este es el matiz que hace útil la pantalla: con la IMPRESORA en
        // pausa, Windows deja el TRABAJO en 'Normal'. Mirar solo la bandera
        // diría "todo bien" de un boleto que lleva media hora sin salir.
        expect(clasificarEstadoTrabajo('Normal', MINUTOS_PARA_ATASCO - 1).estado).toBe('esperando')

        const r = clasificarEstadoTrabajo('Normal', MINUTOS_PARA_ATASCO)
        expect(r.estado).toBe('atascado')
        expect(r.texto).toContain(String(MINUTOS_PARA_ATASCO))
    })

    it('las banderas malas mandan aunque acabe de entrar', () => {
        expect(clasificarEstadoTrabajo('Error', 0).estado).toBe('atascado')
        expect(clasificarEstadoTrabajo('Paused', 0).estado).toBe('atascado')
        expect(clasificarEstadoTrabajo('PaperOut', 0).texto).toMatch(/sin papel/i)
        expect(clasificarEstadoTrabajo('Offline', 0).texto).toMatch(/sin conexión/i)
    })

    it('sin fecha de envío no se inventa una antigüedad', () => {
        expect(clasificarEstadoTrabajo('Normal', null).estado).toBe('esperando')
    })
})

describe('analizarSalidaCola', () => {
    it('lee un trabajo entero', () => {
        const ahora = Date.parse('2026-08-02T10:00:00.000Z')
        const salida = filaTrabajo({ enviado: '2026-08-02T09:57:00.000Z' })

        expect(analizarSalidaCola(salida, ahora)).toEqual([{
            id: 11,
            documento: 'Boleto',
            estado: 'atascado',
            estadoCrudo: 'Normal',
            estadoTexto: 'Lleva 3 minutos en la cola sin salir',
            propietario: 'caja1',
            paginas: 1,
            bytes: 412,
            enviadoEn: '2026-08-02T09:57:00.000Z',
            minutosEnCola: 3,
        }])
    })

    it('descarta una fila sin número de trabajo: no se podría cancelar', () => {
        const salida = [filaTrabajo({ id: '' }), filaTrabajo({ id: 'abc' }), filaTrabajo({ id: '7' })].join('\n')
        expect(analizarSalidaCola(salida).map(t => t.id)).toEqual([7])
    })

    it('un documento sin nombre no deja la fila en blanco', () => {
        expect(analizarSalidaCola(filaTrabajo({ documento: '' }))[0].documento).toBe('(sin nombre)')
    })

    it('una fecha ilegible no rompe nada ni inventa minutos', () => {
        const t = analizarSalidaCola(filaTrabajo({ enviado: 'ni idea' }))[0]
        expect(t.enviadoEn).toBeNull()
        expect(t.minutosEnCola).toBeNull()
    })

    it('un reloj que va hacia atrás no produce minutos negativos', () => {
        // La PC puede tener la hora movida respecto a lo que devuelve WMI:
        // "lleva -3 minutos en cola" no le sirve a nadie.
        const ahora = Date.parse('2026-08-02T10:00:00.000Z')
        const t = analizarSalidaCola(filaTrabajo({ enviado: '2026-08-02T10:05:00.000Z' }), ahora)[0]
        expect(t.minutosEnCola).toBe(0)
    })

    it('una cola vacía es una lista vacía', () => {
        expect(analizarSalidaCola('')).toEqual([])
    })
})

describe('analizarSalidaCancelacion', () => {
    it('lee cuántos se cancelaron de verdad', () => {
        expect(analizarSalidaCancelacion(`C${SEP}4`)).toBe(4)
        expect(analizarSalidaCancelacion(`C${SEP}0`)).toBe(0)
    })

    it('sin respuesta clara no dice que canceló nada', () => {
        expect(analizarSalidaCancelacion('')).toBe(0)
        expect(analizarSalidaCancelacion(`C${SEP}muchos`)).toBe(0)
    })
})

describe('cancelarEnColaWindows', () => {
    it('rechaza un número de trabajo que no es un número, sin llamar a Windows', async () => {
        await expect(cancelarEnColaWindows('POS', 1.5)).rejects.toThrow(/no es válido/)
        await expect(cancelarEnColaWindows('POS', NaN)).rejects.toThrow(/no es válido/)
    })
})
