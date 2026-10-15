import { describe, it, expect } from 'vitest'
import { avisarTrabajosNuevos, esperarTrabajos, oyentesActivos } from './avisos'

const medir = async (p: Promise<void>) => {
    const t = Date.now()
    await p
    return Date.now() - t
}

describe('esperarTrabajos', () => {
    it('despierta en cuanto se encola un trabajo, sin esperar al respaldo', async () => {
        const espera = esperarTrabajos(5_000, new AbortController().signal)
        setTimeout(avisarTrabajosNuevos, 20)

        expect(await medir(espera)).toBeLessThan(1_000)
    })

    it('despierta igual al cumplirse el respaldo aunque nadie avise', async () => {
        // El respaldo cubre lo que no pasa por este proceso: la recuperación
        // de trabajos reclamados y abandonados que hace el RPC a los 90 s.
        expect(await medir(esperarTrabajos(50, new AbortController().signal))).toBeGreaterThanOrEqual(40)
    })

    it('vuelve de inmediato si el agente ya se desconectó', async () => {
        const c = new AbortController()
        c.abort()

        expect(await medir(esperarTrabajos(5_000, c.signal))).toBeLessThan(100)
    })

    it('se corta cuando el agente se desconecta a mitad de la espera', async () => {
        const c = new AbortController()
        setTimeout(() => c.abort(), 20)

        expect(await medir(esperarTrabajos(5_000, c.signal))).toBeLessThan(1_000)
    })

    it('no deja oyentes colgados: un poll de 25 s cada pocos segundos, días seguidos', async () => {
        const c = new AbortController()
        const esperas = [esperarTrabajos(5_000, c.signal), esperarTrabajos(10, c.signal)]
        avisarTrabajosNuevos()
        await Promise.all(esperas)

        expect(oyentesActivos()).toBe(0)
    })
})
