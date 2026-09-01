/**
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * `testWebhook()` construía UN payload escrito a mano, con forma de
 * cobranza, y lo enviaba a cualquier webhook sin mirar su columna `evento`:
 *
 *     const testPayload = {
 *         evento: 'test_conexion',
 *         etapa: 'mora_temprana',
 *         cliente: {...}, deuda: {...},
 *     }
 *     await fetch(webhook.url, { body: JSON.stringify(testPayload) })
 *
 * Probar el webhook de Boletos mandaba, literalmente, un recordatorio de
 * mora: sin `ticket`, sin `adjunto`, sin PDF, y con un `evento` que no
 * existe en ninguna rama del flujo de n8n. La prueba comprobaba que la URL
 * respondía 200 y nada más.
 *
 * Se asserta contra el CUERPO que sale por `fetch`, no contra el valor de
 * retorno, porque el defecto estaba justo ahí: lo que se enviaba y lo que
 * se enseñaba en pantalla eran dos objetos distintos escritos a mano en dos
 * archivos distintos, y ninguna prueba los ataba.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

let db: Record<string, Fila[]> = {}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => crearBaseFalsa(db),
}))

/** El PDF real tarda ~200 ms y no es lo que se está probando aquí. */
const PDF_FALSO = Buffer.from('%PDF-1.7 boleto de prueba')
vi.mock('@/lib/pdf/ticket-document', () => ({
    generarTicketPdf: vi.fn(async () => PDF_FALSO),
}))

import { testWebhook, previsualizarPruebaWebhook } from './webhooks'
import { TOKEN_PUBLICO_PRUEBA } from '@/lib/webhooks/payload-prueba'

const WH_TICKET = 'wh-ticket'
const WH_COBRANZA = 'wh-cobranza'

const CONFIG: Fila = {
    id: true,
    nombre_comercial: 'Inversiones Héctor Cordero',
    rnc: '132966562',
    direccion: 'Av. Libertad No. 92',
    telefono: '8296190004',
    logo_url: null,
    texto_legal: '',
    url_terminos: 'https://ejemplo.test/terminos',
    prefijo_numeracion: 'BOL',
    pie_impresion: '',
    modo_adjunto: 'ambos',
    updated_at: '2026-08-01T00:00:00.000Z',
    updated_by: null,
}

function datos(): Record<string, Fila[]> {
    return {
        webhooks: [
            {
                id: WH_TICKET, nombre: 'WhatsApp Boletos', evento: 'ticket',
                activo: true, url: 'https://n8n.test/boletos', headers: {},
            },
            {
                id: WH_COBRANZA, nombre: 'whatsapp', evento: 'cobranza',
                activo: true, url: 'https://n8n.test/cobranza', headers: {},
            },
        ],
        configuracion_ticket: [{ ...CONFIG }],
        plantillas_mensaje: [
            {
                id: 'pl-ticket', etapa: 'ticket', activo: true,
                contenido: '¡Gracias {{nombre}}! Tu boleto es {{ticket_numero}} de {{sorteo}}.',
            },
            {
                id: 'pl-mora', etapa: 'mora_temprana', activo: true,
                contenido: 'Hola {{nombre}}, tiene {{dias_atraso}} días de atraso.',
            },
        ],
        sorteos: [
            {
                id: 's-1', nombre: 'FINANCIA, PAGA Y GANA', premio: 'iPhone 13',
                fecha_fin: '2026-12-04', prefijo: 'SPG126', estado: 'activo',
                created_at: '2026-07-01T00:00:00.000Z',
            },
            {
                id: 's-0', nombre: 'Sorteo viejo', premio: null,
                fecha_fin: '2026-01-01', prefijo: 'OLD', estado: 'cerrado',
                created_at: '2026-01-01T00:00:00.000Z',
            },
        ],
    }
}

/** El cuerpo JSON que salió por `fetch`, que es lo que recibe n8n. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cuerpoEnviado(): any {
    const llamada = vi.mocked(global.fetch).mock.calls[0]
    return JSON.parse((llamada[1] as RequestInit).body as string)
}

beforeEach(() => {
    db = datos()
    global.fetch = vi.fn(async () =>
        new Response('{"ok":true}', { status: 200 })
    ) as unknown as typeof fetch
})

describe('testWebhook elige el payload según el evento del webhook', () => {
    it('el webhook de boletos recibe un payload de BOLETOS, no de cobranza', async () => {
        await testWebhook(WH_TICKET)
        const cuerpo = cuerpoEnviado()

        expect(cuerpo.evento).toBe('ticket_emitido')
        expect(cuerpo).toHaveProperty('ticket')
        expect(cuerpo).toHaveProperty('adjunto')
        // Lo que enviaba la versión anterior y no tiene nada que hacer aquí:
        expect(cuerpo).not.toHaveProperty('deuda')
        expect(cuerpo).not.toHaveProperty('etapa')
        expect(cuerpo.evento).not.toBe('test_conexion')
    })

    it('el webhook de cobranza sigue recibiendo el payload de cobranza', async () => {
        await testWebhook(WH_COBRANZA)
        const cuerpo = cuerpoEnviado()

        expect(cuerpo.evento).toBe('recordatorio_cobranza')
        expect(cuerpo).toHaveProperty('deuda')
        expect(cuerpo).not.toHaveProperty('ticket')
        expect(cuerpo.adjunto).toBeUndefined()
    })

    it('cada payload de prueba va marcado con _test para que n8n pueda cortar', async () => {
        await testWebhook(WH_TICKET)
        expect(cuerpoEnviado()._test).toBe(true)

        vi.mocked(global.fetch).mockClear()
        await testWebhook(WH_COBRANZA)
        expect(cuerpoEnviado()._test).toBe(true)
    })
})

describe('la prueba de boletos va completa', () => {
    it('lleva el PDF en base64 dentro del adjunto', async () => {
        await testWebhook(WH_TICKET)
        const { adjunto } = cuerpoEnviado()

        expect(adjunto.tipo).toBe('pdf')
        expect(adjunto.base64).toBe(PDF_FALSO.toString('base64'))
        expect(Buffer.from(adjunto.base64, 'base64').toString())
            .toContain('%PDF')
    })

    it('el adjunto se llama como el boleto y usa el prefijo del sorteo activo', async () => {
        await testWebhook(WH_TICKET)
        const cuerpo = cuerpoEnviado()

        expect(cuerpo.ticket.numero).toBe('SPG126-000000')
        expect(cuerpo.adjunto.nombre).toBe('boleto-SPG126-000000.pdf')
        expect(cuerpo.ticket.sorteo.nombre).toBe('FINANCIA, PAGA Y GANA')
    })

    it('el sorteo viaja entero: fecha y premio, no sólo el nombre', async () => {
        await testWebhook(WH_TICKET)
        const { sorteo } = cuerpoEnviado().ticket

        expect(sorteo).toEqual({
            id: 's-1',
            nombre: 'FINANCIA, PAGA Y GANA',
            premio: 'iPhone 13',
            fecha_fin: '2026-12-04',
        })
    })

    it('sin ningún sorteo en la base, el ficticio también lleva fecha', async () => {
        db.sorteos = []

        await testWebhook(WH_TICKET)
        const { sorteo } = cuerpoEnviado().ticket

        // La prueba no manda `sorteo: null`: un payload sin sorteo no deja
        // mapear el bloque en n8n, que es para lo que se prueba.
        expect(sorteo.nombre).toBe('Sorteo de Prueba')
        expect(sorteo.fecha_fin).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(sorteo.premio).toBeTruthy()
    })

    it('el mensaje sale de la plantilla activa de boletos, ya renderizado', async () => {
        await testWebhook(WH_TICKET)
        const { mensaje } = cuerpoEnviado()

        expect(mensaje).toContain('SPG126-000000')
        expect(mensaje).toContain('FINANCIA, PAGA Y GANA')
        expect(mensaje).not.toContain('{{')
    })

    it('manda el WhatsApp al teléfono del negocio, no a uno inventado', async () => {
        await testWebhook(WH_TICKET)
        expect(cuerpoEnviado().cliente.telefono).toBe('8296190004')
    })

    it('incluye url_publica y url_terminos cuando modo_adjunto es «ambos»', async () => {
        await testWebhook(WH_TICKET)
        const cuerpo = cuerpoEnviado()

        expect(cuerpo.url_publica).toContain(`/t/${TOKEN_PUBLICO_PRUEBA}`)
        expect(cuerpo.url_terminos).toBe('https://ejemplo.test/terminos')
    })
})

describe('la prueba respeta la configuración en vez de fingir', () => {
    it('con modo_adjunto=url no manda base64, y lo dice en un aviso', async () => {
        db.configuracion_ticket = [{ ...CONFIG, modo_adjunto: 'url' }]

        const r = await testWebhook(WH_TICKET)

        expect(cuerpoEnviado().adjunto).toBeNull()
        expect(r.adjunto).toBeNull()
        expect(r.avisos.join(' ')).toContain('NO lleva el PDF en base64')
    })

    it('sin sorteo activo cae al borrador más reciente y avisa', async () => {
        db.sorteos = [
            {
                id: 's-2', nombre: 'Sorteo nuevo', premio: null, fecha_fin: '2027-01-01',
                prefijo: 'NVO', estado: 'borrador', created_at: '2026-08-01T00:00:00.000Z',
            },
            {
                id: 's-1', nombre: 'Sorteo viejo', premio: null, fecha_fin: '2026-01-01',
                prefijo: 'OLD', estado: 'borrador', created_at: '2026-01-01T00:00:00.000Z',
            },
        ]

        const r = await testWebhook(WH_TICKET)

        expect(cuerpoEnviado().ticket.numero).toBe('NVO-000000')
        expect(r.avisos.join(' ')).toContain('está en borrador')
    })

    it('sin ningún sorteo usable cae a la numeración SN y avisa', async () => {
        db.sorteos = db.sorteos.map(s => ({ ...s, estado: 'cerrado' }))

        const r = await testWebhook(WH_TICKET)

        expect(cuerpoEnviado().ticket.numero).toBe('BOL-SN-000000')
        expect(r.avisos.join(' ')).toContain('ni en borrador')
    })

    it('el sorteo activo gana al borrador aunque el borrador sea más nuevo', async () => {
        db.sorteos.push({
            id: 's-9', nombre: 'Borrador nuevo', premio: null, fecha_fin: '2027-06-01',
            prefijo: 'NUE', estado: 'borrador', created_at: '2026-08-30T00:00:00.000Z',
        })

        await testWebhook(WH_TICKET)

        expect(cuerpoEnviado().ticket.numero).toBe('SPG126-000000')
    })

    it('sin plantilla activa de boletos avisa en vez de callar', async () => {
        db.plantillas_mensaje = db.plantillas_mensaje.filter(p => p.etapa !== 'ticket')

        const r = await testWebhook(WH_TICKET)

        expect(r.avisos.join(' ')).toContain('No hay plantilla activa de boletos')
        expect(cuerpoEnviado().mensaje).not.toContain('{{')
    })
})

describe('lo que vuelve a pantalla es lo que se envió', () => {
    it('el payload mostrable elide el base64 pero conserva el resto', async () => {
        const r = await testWebhook(WH_TICKET)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vista = r.payload as any

        expect(vista.evento).toBe('ticket_emitido')
        expect(vista.adjunto.base64).not.toBe(PDF_FALSO.toString('base64'))
        expect(vista.adjunto.base64).toContain('caracteres')
        expect(r.adjunto?.caracteres_base64)
            .toBe(PDF_FALSO.toString('base64').length)
        expect(r.evento).toBe('ticket')
    })

    it('previsualizar arma el MISMO payload sin hacer el POST', async () => {
        const vista = await previsualizarPruebaWebhook(WH_TICKET)

        expect(global.fetch).not.toHaveBeenCalled()
        expect(vista.evento).toBe('ticket')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((vista.payload as any).evento).toBe('ticket_emitido')
        expect(vista.adjunto?.nombre).toBe('boleto-SPG126-000000.pdf')
    })

    it('devuelve el estado HTTP y el cuerpo de la respuesta', async () => {
        global.fetch = vi.fn(async () =>
            new Response('workflow no encontrado', { status: 404 })
        ) as unknown as typeof fetch

        const r = await testWebhook(WH_TICKET)

        expect(r.ok).toBe(false)
        expect(r.status).toBe(404)
        expect(r.body).toBe('workflow no encontrado')
    })

    it('un webhook inexistente da un motivo legible, no un digest', async () => {
        await expect(testWebhook('no-existe')).rejects.toThrow(/permiso para verlo/)
    })
})
