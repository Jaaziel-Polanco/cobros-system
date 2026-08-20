import { describe, it, expect } from 'vitest'
import { getPermisos, tienePermiso } from './permisos'
import { DEFAULT_PERMISOS_AGENTE } from '@/lib/types'

describe('getPermisos', () => {
    it('da todos los permisos al admin, aunque su columna esté vacía', () => {
        const permisos = getPermisos({ rol: 'admin', permisos: null })
        for (const clave of Object.keys(DEFAULT_PERMISOS_AGENTE)) {
            expect(permisos[clave as keyof typeof permisos]).toBe(true)
        }
    })

    it('usa los valores por defecto cuando el agente no tiene permisos guardados', () => {
        const permisos = getPermisos({ rol: 'agente', permisos: null })
        expect(permisos).toEqual(DEFAULT_PERMISOS_AGENTE)
    })

    it('rellena con los valores por defecto las claves que faltan', () => {
        // Un agente guardado antes de que existieran los permisos de boletos
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_logs: true, ver_webhooks: false } as never,
        })
        expect(permisos.ver_tickets).toBe(DEFAULT_PERMISOS_AGENTE.ver_tickets)
        expect(permisos.ver_logs).toBe(true)
        expect(permisos.ver_webhooks).toBe(false)
    })

    it('respeta un false explícito por encima del valor por defecto', () => {
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { ver_tickets: false } as never,
        })
        expect(permisos.ver_tickets).toBe(false)
    })
})

describe('tienePermiso', () => {
    it('devuelve true para el admin en cualquier permiso', () => {
        expect(tienePermiso({ rol: 'admin', permisos: null }, 'realizar_sorteo')).toBe(true)
    })

    it('devuelve false para un agente sin el permiso', () => {
        expect(tienePermiso({ rol: 'agente', permisos: null }, 'realizar_sorteo')).toBe(false)
    })
})

describe('separación de anular_ticket', () => {
    /**
     * `anular_ticket` se separó de `generar_ticket_manual`. Estas pruebas
     * cubren el hueco entre el despliegue del código y la migración que
     * rellena la columna: durante ese rato hay perfiles sin la clave nueva.
     */

    it('NO concede anular a quien tenía generar en false', () => {
        // La prueba que motiva la herencia. Con la fusión a secas
        // ({...DEFAULT, ...guardados}), este agente recibiría el valor por
        // defecto `true` y amanecería pudiendo anular boletos que ayer no
        // podía. Un permiso que aparece solo porque se desplegó una versión
        // no lo concedió nadie.
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { generar_ticket_manual: false } as never,
        })
        expect(permisos.anular_ticket).toBe(false)
        expect(permisos.generar_ticket_manual).toBe(false)
    })

    it('mantiene anular a quien tenía generar en true', () => {
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { generar_ticket_manual: true } as never,
        })
        expect(permisos.anular_ticket).toBe(true)
    })

    it('una vez rellenada la clave, manda ella y no la vieja', () => {
        // Es el estado después de la migración: un administrador ya puede
        // dar «generar» sin dar «anular», que es el objetivo del cambio.
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { generar_ticket_manual: true, anular_ticket: false } as never,
        })
        expect(permisos.generar_ticket_manual).toBe(true)
        expect(permisos.anular_ticket).toBe(false)
    })

    it('y también al revés: anular sin generar', () => {
        const permisos = getPermisos({
            rol: 'agente',
            permisos: { generar_ticket_manual: false, anular_ticket: true } as never,
        })
        expect(permisos.anular_ticket).toBe(true)
        expect(permisos.generar_ticket_manual).toBe(false)
    })

    it('sin ninguna de las dos claves, usa el valor por defecto', () => {
        const permisos = getPermisos({ rol: 'agente', permisos: {} as never })
        expect(permisos.anular_ticket).toBe(true)
    })

    it('el admin puede anular siempre', () => {
        expect(tienePermiso({ rol: 'admin', permisos: null }, 'anular_ticket')).toBe(true)
    })
})
