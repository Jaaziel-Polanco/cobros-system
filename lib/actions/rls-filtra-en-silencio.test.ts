/**
 * ESTAS PRUEBAS FALLAN CON EL CODIGO ANTERIOR A LA CORRECCION.
 *
 * Dos Server Actions leian la configuracion del webhook con el cliente de
 * SESION: enviarRecordatorioManual() y enviarNotificacionReferencia().
 *
 *     await supabase.from('webhooks').select('*')
 *       .eq('activo', true).eq('evento', 'cobranza').maybeSingle()
 *     if (!webhook) throw new Error('No hay webhook activo configurado')
 *
 * En produccion `webhooks` tiene RLS activo y UNA sola policy:
 * "webhooks: admin full access" -> get_my_rol() = 'admin'. No existe
 * ninguna policy de lectura para agentes.
 *
 * Y ahi esta el filo: RLS no da error, FILTRA. El agente recibe
 * `data: null, error: null`, indistinguible de "no hay webhook
 * configurado". La accion lanzaba, Next.js redacta el mensaje en
 * produccion, y lo que veia el agente era el texto generico del digest,
 * que no menciona ni permisos ni webhooks. Por eso paso desapercibido
 * tanto tiempo: el sistema decia "no hay webhook" cuando lo que ocurria
 * era "tu no puedes verlo".
 *
 * Medido en la base de produccion antes de la correccion: 0 recordatorios
 * manuales enviados por agentes en toda la vida del sistema, frente a 445
 * automaticos (esos van por service_role) y 2 manuales de administradores.
 *
 * La correccion lee `webhooks` con el cliente admin, igual que ya hacian
 * intentarEnvioInmediato() y las dos acciones de boletos. La URL y los
 * `headers` no salen del servidor.
 *
 * `plantillas_mensaje` se sigue leyendo con la sesion a proposito: ahi SI
 * hay policy de lectura para agentes, y moverla tambien seria ampliar el
 * radio de la correccion sin motivo. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const AGENTE = 'agente-1'
const DEUDA = 'deuda-1'
const REFERENCIA = 'ref-1'

/** Lo que ve el agente a través de RLS. */
let dbSesion: Record<string, Fila[]> = {}
/** Lo que ve service_role, que no pasa por RLS. */
let dbAdmin: Record<string, Fila[]> = {}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        ...crearBaseFalsa(dbSesion),
        auth: { getUser: async () => ({ data: { user: { id: AGENTE } }, error: null }) },
    }),
}))

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => crearBaseFalsa(dbAdmin),
}))

const CLIENTE = {
    id: 'c-1', nombre: 'Ana', apellido: 'Perez',
    telefono: '8095550101', email: null,
}

const WEBHOOK: Fila = {
    id: 'wh-1',
    evento: 'cobranza',
    activo: true,
    url: 'https://n8n.example/webhook/cobranza',
    headers: {},
}

function datosSesion(): Record<string, Fila[]> {
    return {
        deudas: [{
            id: DEUDA,
            cliente_id: 'c-1',
            agente_id: AGENTE,
            estado: 'activo',
            pausado: false,
            etapa: 'mora_alta',
            monto_original: 10000,
            saldo_pendiente: 4000,
            cuota_mensual: 1000,
            tasa_interes: 5,
            fecha_corte: '2026-08-25',
            dias_atraso: 12,
            frecuencia_pago: 'mensual',
            // La base falsa no resuelve embeds; van ya incrustados.
            cliente: CLIENTE,
            agente: { id: AGENTE, full_name: 'Agente Uno' },
        }],
        referencias_cliente: [{
            id: REFERENCIA, cliente_id: 'c-1', nombre: 'Luis Tio',
            telefono: '8095550202', relacion: 'tio', cliente: CLIENTE,
        }],
        plantillas_mensaje: [
            { id: 'pl-1', etapa: 'mora_alta', activo: true, contenido: 'Hola {{nombre}}, tu saldo es {{saldo}}' },
            { id: 'pl-ref', etapa: 'referencia', activo: true, contenido: 'Hola {{nombre_referencia}}, sobre {{nombre}}' },
        ],
        // ── EL PUNTO DE LA PRUEBA ──
        // RLS filtra la tabla entera para un agente. No es un error: es vacío.
        webhooks: [],
        envios_log: [],
    }
}

let espiaFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
    dbSesion = datosSesion()
    dbAdmin = { webhooks: [WEBHOOK] }
    espiaFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }))
    vi.stubGlobal('fetch', espiaFetch)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('enviarRecordatorioManual', () => {
    it('un agente envía aunque RLS le oculte la tabla webhooks', async () => {
        const { enviarRecordatorioManual } = await import('./envios')

        await expect(enviarRecordatorioManual(DEUDA))
            .resolves.toMatchObject({ ok: true, estado: 'enviado' })
        expect(espiaFetch).toHaveBeenCalledOnce()
        expect(espiaFetch.mock.calls[0][0]).toBe(WEBHOOK.url)
    })

    it('deja el envío trazado en envios_log con el webhook que usó', async () => {
        const { enviarRecordatorioManual } = await import('./envios')
        await enviarRecordatorioManual(DEUDA)

        expect(dbSesion.envios_log).toHaveLength(1)
        expect(dbSesion.envios_log[0]).toMatchObject({
            webhook_id: 'wh-1',
            plantilla_id: 'pl-1',
            agente_id: AGENTE,
            enviado_por: 'manual',
            estado: 'enviado',
        })
    })

    it('si de verdad no hay webhook activo, sigue fallando', async () => {
        // El cliente admin ve la tabla entera y está vacía: eso ya no es
        // RLS escondiendo algo, es una configuración que falta. La
        // corrección no puede tapar ese caso.
        dbAdmin = { webhooks: [] }
        const { enviarRecordatorioManual } = await import('./envios')

        expect(await enviarRecordatorioManual(DEUDA)).toEqual({
            ok: false,
            motivo: 'No hay webhook activo para el evento "cobranza"',
        })
        expect(espiaFetch).not.toHaveBeenCalled()
    })

    // ── LA PROPIEDAD QUE IMPORTA ──
    // Next.js redacta el mensaje de lo que se LANZA desde una Server Action y
    // devuelve "An error occurred in the Server Components render...", idéntico
    // para las seis causas posibles. Devolver el motivo en vez de lanzarlo es
    // lo único que lo hace llegar al operador. Si alguien vuelve a poner un
    // throw en una de estas comprobaciones, esta prueba cae.
    it.each([
        ['deuda pausada',     () => { dbSesion.deudas[0].pausado = true },     'pausada'],
        ['deuda saldada',     () => { dbSesion.deudas[0].estado = 'saldado' }, 'saldada'],
        ['deuda inexistente', () => { dbSesion.deudas = [] },                  'no encontrada'],
        ['sin plantilla',     () => { dbSesion.plantillas_mensaje = [] },      'plantilla'],
        ['sin webhook',       () => { dbAdmin = { webhooks: [] } },            'webhook'],
    ])('devuelve el motivo en vez de lanzarlo: %s', async (_caso, preparar, esperado) => {
        preparar()
        const { enviarRecordatorioManual } = await import('./envios')

        // Sin `rejects`: si lanzara, esta línea propagaría y la prueba caería.
        const r = await enviarRecordatorioManual(DEUDA)

        expect(r.ok).toBe(false)
        expect((r as { motivo: string }).motivo.toLowerCase()).toContain(esperado)
        expect(espiaFetch).not.toHaveBeenCalled()
    })

    it('el motivo nombra la etapa cuando falta su plantilla', async () => {
        dbSesion.plantillas_mensaje = []
        const { enviarRecordatorioManual } = await import('./envios')

        const r = await enviarRecordatorioManual(DEUDA)
        expect((r as { motivo: string }).motivo).toContain('mora_alta')
    })

    it('un webhook que responde con error deja rastro y devuelve el código', async () => {
        espiaFetch = vi.fn(async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }))
        vi.stubGlobal('fetch', espiaFetch)
        const { enviarRecordatorioManual } = await import('./envios')

        const r = await enviarRecordatorioManual(DEUDA)

        expect(r).toMatchObject({ ok: false })
        expect((r as { motivo: string }).motivo).toContain('502')
        // Este intento SÍ queda en envios_log: hubo envío de verdad.
        expect(dbSesion.envios_log[0]).toMatchObject({ estado: 'error', respuesta_http: 502 })
    })
})

describe('enviarNotificacionReferencia', () => {
    it('un agente notifica a la referencia aunque RLS le oculte webhooks', async () => {
        const { enviarNotificacionReferencia } = await import('./referencias')

        await expect(enviarNotificacionReferencia(REFERENCIA, DEUDA)).resolves.toBeDefined()
        expect(espiaFetch).toHaveBeenCalledOnce()
        expect(espiaFetch.mock.calls[0][0]).toBe(WEBHOOK.url)
    })

    it('marca el envio como dirigido a la referencia, no al cliente', async () => {
        const { enviarNotificacionReferencia } = await import('./referencias')
        await enviarNotificacionReferencia(REFERENCIA, DEUDA)

        expect(dbSesion.envios_log[0]).toMatchObject({
            tipo_destino: 'referencia',
            referencia_id: REFERENCIA,
            webhook_id: 'wh-1',
        })
    })

    it('si de verdad no hay webhook activo, sigue fallando', async () => {
        dbAdmin = { webhooks: [] }
        const { enviarNotificacionReferencia } = await import('./referencias')

        await expect(enviarNotificacionReferencia(REFERENCIA, DEUDA))
            .rejects.toThrow('No hay webhook activo configurado')
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})

/**
 * El mismo defecto que los webhooks, en otro sitio y mas caro.
 *
 * La policy de `deudas` deja ver las del propio agente. La de `clientes`, los
 * clientes del propio agente. Son dos condiciones DISTINTAS: en cuanto una
 * deuda y su cliente estan asignados a agentes diferentes, el agente ve la
 * deuda pero el embed `cliente:clientes(*)` le llega null.
 *
 * En produccion existe una deuda asi. El codigo hacia `deuda.cliente.nombre`
 * y lanzaba "Cannot read properties of null (reading 'nombre')", que Next.js
 * presenta al operador como el mismo digest opaco de siempre.
 */
describe('embed de cliente filtrado por RLS', () => {
    it('no revienta cuando el cliente pertenece a otro agente', async () => {
        // Exactamente el caso real: la deuda se ve, el cliente no.
        dbSesion.deudas[0].cliente = null
        const { enviarRecordatorioManual } = await import('./envios')

        // Sin `rejects`: con el codigo anterior esto lanzaba un TypeError y
        // la linea propagaba.
        const r = await enviarRecordatorioManual(DEUDA)

        expect(r.ok).toBe(false)
        expect((r as { motivo: string }).motivo).toContain('otro agente')
        expect(espiaFetch).not.toHaveBeenCalled()
    })

    it('tampoco manda nada a medias en ese caso', async () => {
        dbSesion.deudas[0].cliente = null
        const { enviarRecordatorioManual } = await import('./envios')
        await enviarRecordatorioManual(DEUDA)

        // Ni webhook ni rastro: no hubo envio que registrar.
        expect(espiaFetch).not.toHaveBeenCalled()
        expect(dbSesion.envios_log).toHaveLength(0)
    })

    it('la notificacion a referencia explica la causa en vez de reventar', async () => {
        dbSesion.referencias_cliente[0].cliente = null
        const { enviarNotificacionReferencia } = await import('./referencias')

        // Sigue lanzando -- su contrato no cambia aqui -- pero con un mensaje
        // propio, no con un TypeError de desreferencia.
        await expect(enviarNotificacionReferencia(REFERENCIA, DEUDA))
            .rejects.toThrow(/asignado a otro agente/)
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})
