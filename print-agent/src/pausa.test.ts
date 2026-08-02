import { describe, it, expect, beforeEach } from 'vitest'
import {
    MINUTOS_ENTRE_AVISOS, estaPausado, estadoPausa, pausar, reanudar,
    reiniciarPausa, tocaAvisarEnRegistro,
} from './pausa'

beforeEach(() => { reiniciarPausa() })

describe('la pausa', () => {
    it('empieza apagada', () => {
        expect(estaPausado()).toBe(false)
        expect(estadoPausa()).toEqual({ pausado: false, desde: null, minutos: 0 })
    })

    it('se pone y se quita', () => {
        pausar()
        expect(estaPausado()).toBe(true)
        reanudar()
        expect(estaPausado()).toBe(false)
    })

    it('cuenta los minutos que lleva parada', () => {
        const t0 = Date.parse('2026-08-02T10:00:00.000Z')
        pausar(t0)

        expect(estadoPausa(t0).minutos).toBe(0)
        expect(estadoPausa(t0 + 59_000).minutos).toBe(0)
        expect(estadoPausa(t0 + 60_000).minutos).toBe(1)
        expect(estadoPausa(t0 + 25 * 60_000).minutos).toBe(25)
        expect(estadoPausa(t0).desde).toBe('2026-08-02T10:00:00.000Z')
    })

    it('pausar dos veces NO reinicia el contador', () => {
        // El cartel tiene que decir la verdad sobre desde cuándo está
        // parada. Si un segundo clic pusiera el contador a cero, media hora
        // olvidada se enseñaría como "hace un momento", que es justo lo
        // contrario de lo que el cartel existe para evitar.
        const t0 = Date.parse('2026-08-02T10:00:00.000Z')
        pausar(t0)
        pausar(t0 + 20 * 60_000)

        expect(estadoPausa(t0 + 20 * 60_000).minutos).toBe(20)
    })

    it('reanudar borra el momento en que se pausó', () => {
        pausar()
        reanudar()
        expect(estadoPausa().desde).toBeNull()
        expect(estadoPausa().minutos).toBe(0)
    })
})

describe('avisos en el registro mientras sigue en pausa', () => {
    it('no dice nada si no está pausada', () => {
        expect(tocaAvisarEnRegistro()).toBe(false)
    })

    it('avisa al pausar y luego una vez cada tanto, no en cada vuelta', () => {
        // El bucle pasa por aquí una vez por segundo. Sin espaciarlo, el
        // registro se llenaría de la misma línea y taparía justo lo que se
        // busca al abrirlo.
        const t0 = Date.parse('2026-08-02T10:00:00.000Z')
        pausar(t0)

        expect(tocaAvisarEnRegistro(t0)).toBe(true)
        expect(tocaAvisarEnRegistro(t0 + 1_000)).toBe(false)
        expect(tocaAvisarEnRegistro(t0 + 60_000)).toBe(false)
        expect(tocaAvisarEnRegistro(t0 + MINUTOS_ENTRE_AVISOS * 60_000)).toBe(true)
        expect(tocaAvisarEnRegistro(t0 + MINUTOS_ENTRE_AVISOS * 60_000 + 1_000)).toBe(false)
    })

    it('tras reanudar y volver a pausar, vuelve a avisar enseguida', () => {
        const t0 = Date.parse('2026-08-02T10:00:00.000Z')
        pausar(t0)
        expect(tocaAvisarEnRegistro(t0)).toBe(true)

        reanudar(t0 + 1_000)
        pausar(t0 + 2_000)
        expect(tocaAvisarEnRegistro(t0 + 2_000)).toBe(true)
    })
})
