import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crearBaseFalsa, type Fila } from './postgrest-falso'

let usuario: { id: string } | null = null
let db: Record<string, Fila[]> = {}

vi.mock('./server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: usuario } }) },
        ...crearBaseFalsa(db),
    }),
}))

beforeEach(() => {
    usuario = null
    db = { profiles: [{ id: 'u-1', rol: 'agente', sucursal_id: 's-1' }, { id: 'u-2', rol: 'admin' }] }
})

describe('getSesion', () => {
    it('devuelve null sin sesión', async () => {
        const { getSesion } = await import('./sesion')

        expect(await getSesion()).toBeNull()
    })

    it('devuelve el usuario y SU perfil', async () => {
        usuario = { id: 'u-1' }
        const { getSesion } = await import('./sesion')

        const sesion = await getSesion()

        expect(sesion?.user.id).toBe('u-1')
        expect(sesion?.perfil).toMatchObject({ id: 'u-1', rol: 'agente', sucursal_id: 's-1' })
    })
})
