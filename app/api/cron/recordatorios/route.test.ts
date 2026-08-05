/**
 * Pruebas del cron de recordatorios contra un doble de PostgREST.
 *
 * ESTAS PRUEBAS FALLAN CON EL CÓDIGO ANTERIOR A LA CORRECCIÓN.
 *
 * Es el único sitio del proyecto donde un truncamiento silencioso se
 * convierte en un mensaje de WhatsApp de verdad, así que se ejercita el
 * `GET` entero —decisión, plantilla y envío incluidos— y se comprueba a
 * quién se le llama al webhook. No se toca la red: `fetch` está sustituido
 * por un espía y la prueba falla si alguien lo quita.
 *
 * ── Lo que atrapa ─────────────────────────────────────────────
 *
 * 1. `pagos` (era route.ts:127-133). El mapa "último pago por deuda" se
 *    construía con un `select` sin paginar ordenado por `created_at DESC`.
 *    PostgREST recortaba a 1000 filas sin error, quedándose con los 1000
 *    pagos más recientes del conjunto entero: una deuda cuyo último pago
 *    cayera fuera de esa ventana desaparecía del mapa y se trataba como
 *    impagada. En producción eran 82 deudas activas, a cuyos clientes se les
 *    mandaba un recordatorio de cobro habiendo pagado.
 *
 * 2. `deudas` (era route.ts:83-89). El `select` que alimenta el bucle de
 *    envío. Hoy son 741 filas y no corta; al pasar de 1000, las deudas de
 *    más simplemente no recibirían ningún recordatorio, sin error alguno.
 *
 * 3. El RPC `ultimos_envios_por_deuda` (era route.ts:143-155). El mapa
 *    anti-duplicado. **El resultado de un RPC también se recorta a 1000
 *    filas sin error**, y este devuelve una fila por `(deuda_id,
 *    tipo_destino)`. Una deuda que cae fuera del corte pierde su entrada, el
 *    cron la lee como nunca notificada y le manda un SEGUNDO WhatsApp — el
 *    defecto exacto que ese RPC vino a corregir en su día.
 *
 *    Los escenarios de este tercer bloque llevan a propósito los dos
 *    `tipo_destino`. En producción hoy no hay ni una fila `referencia`, así
 *    que `deuda_id` resulta ser único en el resultado del RPC; es una
 *    coincidencia, y `lib/actions/referencias.ts` ya tiene escrito el código
 *    que la rompe. La prueba tiene que proteger también ese día.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { crearBaseFalsa, type Fila } from '@/lib/supabase/postgrest-falso'

const SECRETO = 'ZZTEST-cron-secret'

// ─── Datos ────────────────────────────────────────────────────
//
// 20 deudas "charlatanas" con 80 pagos recientes cada una (1600 filas, que
// llenan el cupo de 1000) y una deuda que pagó AYER pero cuyo único pago es
// el más antiguo del conjunto. Es producción en miniatura.

const DEUDAS_CHARLATANAS = 20
const PAGOS_POR_CHARLATANA = 80
const DEUDA_QUE_PAGO = 'd-que-pago'
const DEUDA_MOROSA = 'd-morosa'

const haceDias = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

// La deuda que pagó lo hizo hace 20 días: dentro del umbral de 25 días que
// el cron aplica a la frecuencia mensual (así que NO se le debe escribir),
// pero más atrás que los 1600 pagos de las charlatanas, que son de anteayer.
// Esa es exactamente la forma del daño en producción: no es que la deuda
// haya pagado hace mucho, es que hay demasiados pagos ajenos por delante.
const DIAS_DEL_PAGO_INVISIBLE = 20

function deudaBase(id: string): Fila {
    return {
        id,
        cliente_id: `c-${id}`,
        agente_id: null,
        estado: 'activo',
        pausado: false,
        etapa: 'mora_temprana',
        dias_atraso: 10,
        monto_original: 10000,
        saldo_pendiente: 5000,
        cuota_mensual: 1000,
        tasa_interes: 5,
        fecha_corte: '2026-07-01',
        frecuencia_pago: 'mensual',
        cliente: { id: `c-${id}`, nombre: 'ZZTEST', apellido: id, telefono: '8090000000', email: null },
        agente: null,
        configuracion: null,
    }
}

function datos(): Record<string, Fila[]> {
    const deudas: Fila[] = [
        ...Array.from({ length: DEUDAS_CHARLATANAS }, (_, d) =>
            deudaBase(`d-${String(d).padStart(3, '0')}`)),
        deudaBase(DEUDA_QUE_PAGO),
        deudaBase(DEUDA_MOROSA),
    ]

    const pagos: Fila[] = []
    let n = 0
    for (let d = 0; d < DEUDAS_CHARLATANAS; d++) {
        for (let p = 0; p < PAGOS_POR_CHARLATANA; p++) {
            // Todos de anteayer, escalonados por centésimas de día: son los
            // 1600 pagos más recientes y llenan por sí solos el cupo de 1000.
            pagos.push({
                id: `p-${String(n++).padStart(6, '0')}`,
                deuda_id: `d-${String(d).padStart(3, '0')}`,
                created_at: haceDias(2 + p * 0.01),
            })
        }
    }
    // El pago que el corte silencioso hacía invisible: es real, es reciente
    // en términos de negocio (20 días < umbral de 25), y queda fuera de la
    // ventana de los 1000 más recientes por pura acumulación ajena.
    pagos.push({
        id: 'p-999999',
        deuda_id: DEUDA_QUE_PAGO,
        created_at: haceDias(DIAS_DEL_PAGO_INVISIBLE),
    })

    return {
        deudas,
        pagos,
        plantillas_mensaje: [
            { id: 'pl-1', etapa: 'mora_temprana', activo: true, contenido: 'Hola {{nombre}}, debes {{saldo}}.' },
        ],
        webhooks: [
            { id: 'wh-1', activo: true, evento: 'cobranza', url: 'https://ejemplo.invalido/hook', headers: {} },
        ],
        envios_log: [],
    }
}

// ─── Mocks ────────────────────────────────────────────────────

let db: Record<string, Fila[]> = {}
let maxRows = 1000

/**
 * Historial de envíos ANTERIORES a esta ejecución, la materia prima del RPC.
 * No vive en `db.envios_log` a propósito: ahí es donde el cron anota lo que
 * manda durante la prueba, y mezclarlos haría ilegibles las asertos sobre a
 * quién se le escribió.
 */
let enviosPrevios: Fila[] = []

/** Un envío previo por deuda, del tipo y la fecha dados. */
function enviosA(deudaIds: string[], tipo: string, sentAt: string): Fila[] {
    return deudaIds.map(id => ({ deuda_id: id, tipo_destino: tipo, sent_at: sentAt }))
}

/**
 * El RPC de verdad, en miniatura: `DISTINCT ON (deuda_id, tipo_destino)`
 * con la salida ordenada por `(deuda_id, tipo_destino)`. El orden importa:
 * es el que decide qué filas quedan del lado equivocado del recorte de 1000.
 */
let fallaRpc = false

function rpcUltimosEnvios(args: unknown) {
    if (fallaRpc) return { data: null, error: { message: 'RPC caído' } }
    const ids = new Set((args as { p_deuda_ids?: string[] })?.p_deuda_ids ?? [])
    const mejor = new Map<string, Fila>()
    for (const e of enviosPrevios) {
        if (!ids.has(String(e.deuda_id))) continue
        const clave = `${e.deuda_id} ${e.tipo_destino}`
        const previo = mejor.get(clave)
        if (!previo || String(e.sent_at) > String(previo.ultimo_sent_at)) {
            mejor.set(clave, {
                deuda_id: e.deuda_id,
                tipo_destino: e.tipo_destino,
                ultimo_sent_at: e.sent_at,
            })
        }
    }
    const filas = [...mejor.values()].sort((a, b) => {
        const d = String(a.deuda_id).localeCompare(String(b.deuda_id))
        return d !== 0 ? d : String(a.tipo_destino).localeCompare(String(b.tipo_destino))
    })
    return { data: filas, error: null }
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => crearBaseFalsa(db, {
        get maxRows() { return maxRows },
        rpc: {
            ultimos_envios_por_deuda: rpcUltimosEnvios,
            actualizar_dias_atraso: () => ({ data: null, error: null }),
        },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
}))

/** Los `deuda.id` a los que se llamó AL WEBHOOK, leídos del cuerpo enviado. */
function deudasLlamadasAlWebhook(): string[] {
    return espiaFetch.mock.calls.map(([, init]) =>
        String(JSON.parse((init as RequestInit).body as string).deuda.id))
}

/** `sent_at` de cada envío que se intentó, por deuda. */
function deudasNotificadas(): Set<string> {
    return new Set((db.envios_log ?? []).map(e => String(e.deuda_id)))
}

let espiaFetch: ReturnType<typeof vi.fn>

async function ejecutarCron(secreto = SECRETO) {
    const { GET } = await import('./route')
    const req = { headers: { get: (k: string) => (k === 'x-cron-secret' ? secreto : null) } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await GET(req as any)).json()
}

beforeEach(() => {
    db = datos()
    maxRows = 1000
    fallaRpc = false
    // A todas las deudas se les escribió hace 5 días. Hace falta que NO sea
    // el primer envío: el cron se salta a propósito el bloqueo por pago
    // reciente en la primera notificación (para que las deudas sin historial
    // no se queden sin su primer aviso), y con ese atajo activo el mapa de
    // pagos no decidiría nada. Cinco días también deja atrás el intervalo
    // anti-duplicado de 48 h.
    enviosPrevios = enviosA(db.deudas.map(d => String(d.id)), 'cliente', haceDias(5))
    process.env.CRON_SECRET = SECRETO
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.invalido'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'ZZTEST-key'

    espiaFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', espiaFetch)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('GET /api/cron/recordatorios — el mapa de último pago', () => {
    it('NO manda recordatorio a quien pagó hace 20 días, con 1600 pagos ajenos por delante', async () => {
        // El corazón del defecto. Con el código viejo esta deuda no salía en
        // `pagosPorDeuda`, se leía como impagada y recibía el WhatsApp.
        // Aquí se comprueba sobre el envío de verdad, no sobre el mapa.
        await ejecutarCron()

        expect(deudasNotificadas().has(DEUDA_QUE_PAGO)).toBe(false)
    })

    it('sí manda recordatorio a la deuda que nunca ha pagado', async () => {
        // La contraparte: la corrección no puede lograr su verde callándolo
        // todo. El cron tiene que seguir cobrando a quien debe.
        await ejecutarCron()

        expect(deudasNotificadas().has(DEUDA_MOROSA)).toBe(true)
    })

    it('tampoco manda a las 20 deudas cuyo pago sí entraba en el recorte', async () => {
        await ejecutarCron()

        const notificadas = deudasNotificadas()
        for (let d = 0; d < DEUDAS_CHARLATANAS; d++) {
            expect(notificadas.has(`d-${String(d).padStart(3, '0')}`)).toBe(false)
        }
    })

    it('sólo llama al webhook una vez, por la única deuda que lo merece', async () => {
        const resultado = await ejecutarCron()

        expect(espiaFetch).toHaveBeenCalledTimes(1)
        expect(espiaFetch.mock.calls[0][0]).toBe('https://ejemplo.invalido/hook')
        expect(resultado.enviados).toBe(1)
        expect(resultado.omitidos).toBe(DEUDAS_CHARLATANAS + 1)
    })
})

describe('GET /api/cron/recordatorios — la lista de deudas', () => {
    /** 1200 deudas activas, ni pagos ni plantillas: nadie recibe nada. */
    function milDoscientasDeudas() {
        db = {
            deudas: Array.from({ length: 1200 }, (_, i) =>
                deudaBase(`d-${String(i).padStart(5, '0')}`)),
            pagos: [],
            plantillas_mensaje: [],   // sin plantilla → `omitidos`, sin envío
            webhooks: db.webhooks,
            envios_log: [],
        }
        enviosPrevios = []
    }

    it('ve TODAS las deudas activas cuando pasan de 1000', async () => {
        // Sitio 3. Hoy son 741 y no corta, pero es el mismo camino del
        // dinero y va a cruzarlo. Con el `select` sin paginar de antes, el
        // cron veía 1000 de 1200 y las 200 restantes no recibían ningún
        // recordatorio nunca, sin error de ninguna clase: `total_deudas`
        // decía 1000 y todo parecía normal.
        milDoscientasDeudas()

        const resultado = await ejecutarCron()

        expect(resultado.total_deudas).toBe(1200)
        expect(resultado.omitidos).toBe(1200)
        expect(espiaFetch).not.toHaveBeenCalled()
    })

    it('ABORTA con 500 si el servidor recorta por debajo del tamaño de lote', async () => {
        // La defensa que de verdad cierra el agujero. Si `max-rows` cayera
        // por debajo del lote, el primer lote llegaría corto y un bucle
        // ingenuo daría la lectura por terminada. El contraste contra el
        // conteo exacto lo impide: el cron falla a la vista en vez de cobrar
        // a un subconjunto arbitrario de la cartera.
        maxRows = 10

        const { GET } = await import('./route')
        const req = { headers: { get: () => SECRETO } }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await GET(req as any)

        expect(resp.status).toBe(500)
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})

describe('GET /api/cron/recordatorios — el mapa anti-duplicado (RPC)', () => {
    /** Deuda sin ningún envío previo: la única que SÍ debe recibir mensaje. */
    const DEUDA_NUEVA = 'd-nunca-notificada'

    /**
     * `n` deudas a las que se acaba de escribir (hace 1 h, muy por dentro del
     * intervalo de 48 h: ninguna debe recibir nada) más una a la que nunca se
     * le ha escrito. Sin pagos y sin `configuracion`, para que lo único que
     * decida sea el mapa anti-duplicado.
     */
    function escenario(n: number, tipos: string[]) {
        const notificadas = Array.from({ length: n }, (_, i) => `d-${String(i).padStart(5, '0')}`)
        db = {
            deudas: [...notificadas, DEUDA_NUEVA].map(deudaBase),
            pagos: [],
            plantillas_mensaje: [
                { id: 'pl-1', etapa: 'mora_temprana', activo: true, contenido: 'Hola {{nombre}}.' },
            ],
            webhooks: [
                { id: 'wh-1', activo: true, evento: 'cobranza', url: 'https://ejemplo.invalido/hook', headers: {} },
            ],
            envios_log: [],
        }
        enviosPrevios = tipos.flatMap(t => enviosA(notificadas, t, haceDias(1 / 24)))
        return notificadas
    }

    it('no reenvía a nadie cuando los pares (deuda, tipo_destino) pasan de 1000', async () => {
        // 600 deudas × 2 tipos = 1200 filas de RPC sobre un tope de 1000. Con
        // el código viejo —`rpc()` a pelo y el filtro por 'cliente' hecho en
        // Node sobre lo que llegara— las 100 últimas deudas caen enteras
        // fuera del corte, salen del mapa como si nunca se les hubiera
        // escrito y reciben un SEGUNDO WhatsApp una hora después del primero.
        //
        // Este es el caso que hoy no se da en producción sólo porque no hay
        // ni una fila `referencia` en `envios_log`. El día que las haya, el
        // techo del cron se parte por la mitad sin que nada avise.
        escenario(600, ['cliente', 'referencia'])

        const resultado = await ejecutarCron()

        expect(deudasLlamadasAlWebhook()).toEqual([DEUDA_NUEVA])
        expect(resultado.omitidos).toBe(600)
    })

    it('no reenvía a nadie cuando las propias filas de `cliente` pasan de 1000', async () => {
        // Filtrar por 'cliente' no basta por sí solo: sólo baja el techo de
        // «1000 pares» a «1000 deudas», y la lista de deudas es justo lo que
        // ya hubo que paginar. Con 1200 deudas notificadas, sin paginar se
        // pierden 200 entradas del mapa → 200 clientes reciben el aviso dos
        // veces el mismo día.
        escenario(1200, ['cliente'])

        const resultado = await ejecutarCron()

        expect(deudasLlamadasAlWebhook()).toEqual([DEUDA_NUEVA])
        expect(resultado.omitidos).toBe(1200)
    })

    it('sigue escribiendo a quien nunca ha sido notificado', async () => {
        // La contraparte obligatoria: una corrección no puede lograr su verde
        // callándolo todo. Si el mapa bloqueara de más, el cron dejaría de
        // cobrar y eso tampoco se vería.
        escenario(5, ['cliente'])

        const resultado = await ejecutarCron()

        expect(deudasLlamadasAlWebhook()).toEqual([DEUDA_NUEVA])
        expect(resultado.enviados).toBe(1)
    })

    it('un fallo del RPC aborta en vez de tratar a todo el mundo como no notificado', async () => {
        // El código viejo hacía `console.error` y seguía con el mapa vacío,
        // que aguas abajo se lee como «a nadie se le ha escrito nunca»: una
        // andanada de duplicados a la cartera entera por un error transitorio.
        //
        // (El caso «`max-rows` por debajo del tamaño de lote» se prueba en
        // `lib/supabase/ultimo-envio.test.ts`. Desde el cron no se puede
        // aislar: filtrado por un `tipo_destino`, el RPC devuelve como mucho
        // una fila por deuda, así que un tope capaz de recortarlo recorta
        // antes la propia lista de deudas.)
        escenario(5, ['cliente'])
        fallaRpc = true

        const { GET } = await import('./route')
        const req = { headers: { get: () => SECRETO } }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await GET(req as any)

        expect(resp.status).toBe(500)
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})

describe('GET /api/cron/recordatorios — autorización', () => {
    it('rechaza la petición sin el secreto correcto y no envía nada', async () => {
        const resultado = await ejecutarCron('secreto-equivocado')

        expect(resultado.error).toBe('Unauthorized')
        expect(espiaFetch).not.toHaveBeenCalled()
    })
})
