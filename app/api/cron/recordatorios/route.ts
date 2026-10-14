import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { renderTemplate, formatMonto, formatFecha } from '@/lib/utils/template-renderer'
import {
    debeEnviar,
    getIntervaloEnvio,
    debeEnviarPreventivo,
    normalizarConfiguracionRecordatorio,
    normalizarTelefono,
    fechaCorteValida,
    URGENCIA_ETAPA,
} from '@/lib/utils/cobranza-engine'
import { WebhookPayload, EtapaCobranza, FrecuenciaPago } from '@/lib/types'
import { verificarCronSecret } from '@/lib/utils/auth'
import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from '@/lib/supabase/paginacion'
import { leerUltimoPagoPorDeuda } from '@/lib/supabase/ultimo-pago'
import { leerUltimoEnvioPorDeuda } from '@/lib/supabase/ultimo-envio'
import { leerUltimoEnvioPorTelefono } from '@/lib/supabase/ultimo-envio-telefono'

const BATCH_SIZE = 25
const WEBHOOK_TIMEOUT_MS = 15_000

async function fetchConTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

async function procesarEnvio(
    supabase: ReturnType<typeof createAdminClient>,
    webhook: { url: string; headers: Record<string, string> },
    payload: WebhookPayload,
    logData: Record<string, unknown>
) {
    let estadoEnvio: 'enviado' | 'error' = 'enviado'
    let respuestaHttp: number | undefined
    let respuestaBody: string | undefined

    try {
        const resp = await fetchConTimeout(webhook.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...webhook.headers },
            body: JSON.stringify(payload),
        })
        respuestaHttp = resp.status
        respuestaBody = await resp.text()
        if (!resp.ok) { estadoEnvio = 'error' }
    } catch (e) {
        estadoEnvio = 'error'
        respuestaBody = e instanceof DOMException && e.name === 'AbortError'
            ? `Timeout: webhook no respondió en ${WEBHOOK_TIMEOUT_MS}ms`
            : String(e)
    }

    const { error: logError } = await supabase.from('envios_log').insert({
        ...logData,
        estado: estadoEnvio,
        respuesta_http: respuestaHttp,
        respuesta_body: respuestaBody,
    })

    if (logError) {
        console.error('[CRON] Error al insertar log de envío:', logError.message)
    }

    return { estado: estadoEnvio }
}

export async function GET(req: NextRequest) {
    if (!verificarCronSecret(req.headers.get('x-cron-secret'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // `?dry_run=1`: las mismas lecturas y decisiones que una corrida real,
    // pero sin escribir nada ni llamar al webhook. Devuelve a quién se le
    // escribiría. Sirve para medir una tanda antes de que salga — p. ej. la
    // primera tras semanas con el cron caído.
    const dryRun = req.nextUrl?.searchParams.get('dry_run') === '1'

    try {
        // 1. Actualizar dias_atraso y etapa atómicamente en la DB (fuente de verdad)
        if (!dryRun) await supabase.rpc('actualizar_dias_atraso')

        // 2. Obtener deudas activas — limitar envios_log a los últimos 5 por deuda
        //
        // PAGINADA. Este `select` alimenta el bucle que manda los
        // recordatorios: toda deuda que no salga de aquí simplemente no
        // recibe ninguno, y PostgREST corta en 1000 filas sin error ni
        // cabecera (ver lib/supabase/paginacion.ts). Hoy son 741 y por tanto
        // no corta, pero es el mismo camino del dinero que el mapa de pagos
        // de abajo, que sí está cortando, y la diferencia entre los dos es
        // sólo cuestión de tiempo. `leerTodasLasFilas` lanza antes que
        // devolver una lista corta: preferimos un cron que falle a la vista
        // que un cron que deje de cobrar a un puñado de deudas en silencio.
        //
        // Se pagina por `id` (único). Antes no había `order`, así que el
        // orden del bucle ya era el que quisiera Postgres; ahora es estable.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type FilaDeuda = { id: string } & Record<string, any>

        const filtrarDeudas = (consulta: ConsultaEncadenable) =>
            consulta
                .eq('estado', 'activo')
                .eq('pausado', false)
                .neq('etapa', 'saldado')

        const deudas = await leerTodasLasFilas<FilaDeuda>({
            etiqueta: 'las deudas activas del cron de recordatorios',
            clave: 'id',
            lote: (cursor, limite) => {
                const base = filtrarDeudas(encadenable(
                    supabase.from('deudas').select(`
                        *,
                        cliente:clientes(*),
                        agente:profiles(id, full_name),
                        configuracion:configuracion_recordatorio(*)
                    `),
                ))
                return comoLote<FilaDeuda>(
                    (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
                )
            },
            contar: () => comoConteo(filtrarDeudas(
                encadenable(supabase.from('deudas').select('id', { count: 'exact', head: true })),
            )),
        })

        // Último envío por deuda (por tipo_destino) — vía RPC con DISTINCT ON.
        // ANTES: .limit(deudaIds.length * 5) era un límite GLOBAL, no por grupo, así que
        // las deudas chatty acaparaban el cupo y el último envío de otras quedaba fuera
        // → ultimoEnvioCliente=null → el cron reenviaba 2-3 veces al día.
        //
        // FILTRADO Y PAGINADO EN `leerUltimoEnvioPorDeuda`. El RPC arregló
        // aquel límite global, pero el resultado de un RPC **también** está
        // sujeto al `max-rows` de 1000 de PostgREST: 200, `error: null` y
        // menos filas. Este mapa es lo único que impide reenviar, así que un
        // recorte aquí significa un segundo WhatsApp a quien ya recibió el
        // aviso — el defecto exacto que el RPC vino a corregir.
        // Ver lib/supabase/ultimo-envio.ts.
        //
        // El filtro por 'cliente' pasa a resolverse en la base: antes se
        // traían también los envíos a referencias para descartarlos aquí,
        // gastando cupo con filas que nadie usa.
        const deudaIds = deudas.map(d => d.id)
        const ultimoEnvioClientePorDeuda = await leerUltimoEnvioPorDeuda(
            supabase, deudaIds, 'cliente',
        )

        // 2b. Cargar pagos recientes para determinar si ya pagó este período
        //
        // PAGINADO Y AGREGADO EN `leerUltimoPagoPorDeuda`. Este era el peor de
        // los cortes silenciosos del proyecto y estaba causando daño en
        // producción: 1905 pagos de deudas activas recortados a 1000, y como
        // el `.order('created_at', desc)` de antes se quedaba con los 1000 más
        // recientes GLOBALES, las 82 deudas cuyo último pago caía fuera de esa
        // ventana no aparecían en el mapa. No como "pagó hace mucho": como
        // **no ha pagado nunca**. A esos clientes se les mandaba el
        // recordatorio de cobro habiendo pagado. Ver lib/supabase/ultimo-pago.ts.
        const pagosPorDeuda = await leerUltimoPagoPorDeuda(supabase, deudaIds)

        // 3. Obtener plantillas activas
        const { data: plantillas } = await supabase
            .from('plantillas_mensaje')
            .select('*')
            .eq('activo', true)

        // 4. Obtener webhook activo de cobranza.
        // El filtro por `evento` es obligatorio desde que la migración 05
        // separó los webhooks de cobranza y de boletos: sin él, en cuanto
        // hay un segundo webhook activo (el de boletos) esta consulta deja
        // de poder decidir cuál fila devolver y Postgres responde
        // PGRST116 ("Results contain 2 rows") en vez de una sola fila.
        const { data: webhook, error: webhookError } = await supabase
            .from('webhooks')
            .select('*')
            .eq('activo', true)
            .eq('evento', 'cobranza')
            .maybeSingle()

        // Un error de consulta (p. ej. PGRST116 por más de un webhook activo
        // sin este filtro) y "no hay webhook configurado" son fallos
        // distintos: el primero es un bug/config inconsistente en la base,
        // el segundo es un estado válido. Confundirlos bajo el mismo
        // mensaje es justo lo que hizo pasar desapercibido este problema.
        if (webhookError) {
            return NextResponse.json(
                { ok: false, message: `Error al buscar el webhook de cobranza: ${webhookError.message}` },
                { status: 500 },
            )
        }
        if (!webhook) {
            return NextResponse.json({ ok: false, message: 'No hay webhook activo' })
        }

        // 5. Lo que le llegó a cada TELÉFONO en la ventana del intervalo más
        // largo configurado (el formulario lo topa en 168 h). El anti-duplicado
        // por deuda no basta: el WhatsApp llega a un número, varias deudas (y
        // clientes duplicados) comparten número, y las plantillas no dicen de
        // qué deuda hablan. Ver lib/supabase/ultimo-envio-telefono.ts.
        const ventanaHoras = Math.max(24, ...deudas.map(d => {
            const c = normalizarConfiguracionRecordatorio(d.configuracion)
            return Math.max(c.frecuencia_mora_h, c.frecuencia_recuperacion_h)
        }))
        const ultimoEnvioPorTelefono = await leerUltimoEnvioPorTelefono(
            supabase, new Date(Date.now() - ventanaHoras * 3_600_000).toISOString(),
        )

        // Por qué se omitió cada deuda. Sale en la respuesta (y en el dry_run)
        // para que una tanda rara se pueda explicar sin leer código.
        const motivos = {
            datos_invalidos: 0,
            pago_reciente: 0,
            fuera_de_ventana_preventivo: 0,
            intervalo_deuda: 0,
            intervalo_telefono: 0,
            sin_plantilla: 0,
            mismo_telefono_en_corrida: 0,
        }
        const datosInvalidos: string[] = []

        type Plantilla = { id: string; etapa: string; contenido: string }
        interface Candidata {
            deuda: FilaDeuda
            etapa: EtapaCobranza
            diasAtraso: number
            plantilla: Plantilla
            ultimoEnvio: string | null
            telefono: string | null
        }
        const candidatas: Candidata[] = []

        for (const deuda of deudas ?? []) {
            // Una fecha de corte imposible (p. ej. año 0026) da cientos de
            // miles de días de atraso, y la plantilla se los dice al cliente.
            if (!fechaCorteValida(deuda.fecha_corte)) {
                motivos.datos_invalidos++
                datosInvalidos.push(deuda.id)
                continue
            }

            const config = normalizarConfiguracionRecordatorio(deuda.configuracion)

            // Usar etapa y dias_atraso de la DB (ya actualizados por el RPC) — evita inconsistencia de timezone
            const etapaActual: EtapaCobranza = deuda.etapa as EtapaCobranza
            const diasAtraso: number = deuda.dias_atraso
            const ultimoEnvioCliente = ultimoEnvioClientePorDeuda.get(deuda.id) ?? null
            const esPrimerEnvioCliente = !ultimoEnvioCliente

            // Verificar si el cliente ya pagó este período
            const ultimoPago = pagosPorDeuda.get(deuda.id)
            // Regla: para la PRIMERA notificación no bloquear por pago reciente.
            // Esto evita que deudas existentes sin historial de envíos se queden sin su primer recordatorio.
            if (ultimoPago && !esPrimerEnvioCliente) {
                const fechaPago = new Date(ultimoPago)
                const ahora = new Date()
                const diasDesdePago = (ahora.getTime() - fechaPago.getTime()) / (1000 * 60 * 60 * 24)
                const freq = (deuda.frecuencia_pago as FrecuenciaPago) ?? 'mensual'
                const umbral = freq === 'semanal' ? 5 : freq === 'quincenal' ? 12 : 25
                if (diasDesdePago < umbral) {
                    motivos.pago_reciente++
                    continue
                }
            }

            // Preventivo: SIEMPRE respetar la ventana (días antes del vencimiento), también en el primer envío.
            // El bypass de "primer envío" solo aplica al bloqueo por pago reciente arriba, no aquí — si no,
            // se enviarían recordatorios preventivos semanas antes del corte (bug visto en producción).
            if (etapaActual === 'preventivo') {
                if (!debeEnviarPreventivo(deuda.fecha_corte, config.dias_antes_vencimiento)) {
                    motivos.fuera_de_ventana_preventivo++
                    continue
                }
            }

            // Anti-duplicado para envío al cliente: por deuda...
            const intervalo = getIntervaloEnvio(etapaActual, config)

            if (!debeEnviar(ultimoEnvioCliente, intervalo)) {
                motivos.intervalo_deuda++
                continue
            }

            // ...y por teléfono: cualquier mensaje a ese número (manual o del
            // cron, por esta deuda o por otra) dentro del mismo intervalo.
            const telefono = normalizarTelefono(deuda.cliente?.telefono)
            const ultimoAlTelefono = telefono ? ultimoEnvioPorTelefono.get(telefono) ?? null : null
            if (!debeEnviar(ultimoAlTelefono, intervalo)) {
                motivos.intervalo_telefono++
                continue
            }

            const plantilla = plantillas?.find(p => p.etapa === etapaActual)
            if (!plantilla) { motivos.sin_plantilla++; continue }

            candidatas.push({
                deuda, etapa: etapaActual, diasAtraso, plantilla, ultimoEnvio: ultimoEnvioCliente, telefono,
            })
        }

        // Un solo mensaje por teléfono en cada corrida: el de la deuda más
        // urgente (etapa, y a igual etapa más días de atraso). Las demás
        // quedan cubiertas en las corridas siguientes por el intervalo del
        // teléfono.
        const masUrgente = (a: Candidata, b: Candidata) =>
            (URGENCIA_ETAPA[a.etapa] - URGENCIA_ETAPA[b.etapa]) || (a.diasAtraso - b.diasAtraso)
        const porTelefono = new Map<string, Candidata>()
        const elegidas: Candidata[] = []
        for (const c of candidatas) {
            if (!c.telefono) { elegidas.push(c); continue }
            const actual = porTelefono.get(c.telefono)
            if (actual) {
                motivos.mismo_telefono_en_corrida++
                if (masUrgente(c, actual) <= 0) continue
            }
            porTelefono.set(c.telefono, c)
        }
        elegidas.push(...porTelefono.values())
        elegidas.sort((a, b) => (a.deuda.id < b.deuda.id ? -1 : a.deuda.id > b.deuda.id ? 1 : 0))

        if (datosInvalidos.length > 0) {
            console.warn(`[CRON] ${datosInvalidos.length} deuda(s) omitidas por fecha_corte inválida: ${datosInvalidos.join(', ')}`)
        }

        const procesadas = elegidas.length
        const omitidos = (deudas?.length ?? 0) - procesadas

        type TareaEnvio = () => Promise<{ estado: 'enviado' | 'error' }>
        const tareasEnvio: TareaEnvio[] = []
        const planificados: {
            deuda_id: string
            cliente_id: string
            etapa: EtapaCobranza
            dias_atraso: number
            ultimo_envio: string | null
        }[] = []

        for (const { deuda, etapa: etapaActual, diasAtraso, plantilla, ultimoEnvio: ultimoEnvioCliente } of elegidas) {
            const cuotaDisplay = deuda.cuota_mensual
                ? formatMonto(deuda.cuota_mensual)
                : formatMonto(deuda.saldo_pendiente)

            const variables = {
                nombre: deuda.cliente.nombre,
                apellido: deuda.cliente.apellido,
                monto: formatMonto(deuda.monto_original),
                saldo: formatMonto(deuda.saldo_pendiente),
                cuota: cuotaDisplay,
                fecha_corte: formatFecha(deuda.fecha_corte),
                dias_atraso: diasAtraso,
                tasa_interes: deuda.tasa_interes,
                agente: deuda.agente?.full_name ?? 'Inversiones Cordero',
            }

            const mensajeRendered = renderTemplate(plantilla.contenido, variables)
            const payload: WebhookPayload = {
                evento: 'recordatorio_cobranza',
                timestamp: new Date().toISOString(),
                enviado_por: 'cron',
                etapa: etapaActual,
                tipo_destino: 'cliente',
                cliente: {
                    id: deuda.cliente.id,
                    nombre: deuda.cliente.nombre,
                    apellido: deuda.cliente.apellido,
                    telefono: deuda.cliente.telefono,
                    email: deuda.cliente.email,
                },
                deuda: {
                    id: deuda.id,
                    monto_original: deuda.monto_original,
                    saldo_pendiente: deuda.saldo_pendiente,
                    cuota_mensual: deuda.cuota_mensual,
                    tasa_interes: deuda.tasa_interes,
                    fecha_corte: deuda.fecha_corte,
                    dias_atraso: diasAtraso,
                    frecuencia_pago: deuda.frecuencia_pago,
                },
                mensaje: mensajeRendered,
                agente: deuda.agente ? { id: deuda.agente.id, nombre: deuda.agente.full_name } : undefined,
            }

            tareasEnvio.push(() => procesarEnvio(supabase, webhook, payload, {
                deuda_id: deuda.id,
                cliente_id: deuda.cliente_id,
                webhook_id: webhook.id,
                plantilla_id: plantilla.id,
                etapa: etapaActual,
                mensaje_enviado: mensajeRendered,
                payload,
                tipo_destino: 'cliente',
                enviado_por: 'cron',
            }))
            planificados.push({
                deuda_id: deuda.id,
                cliente_id: deuda.cliente_id,
                etapa: etapaActual,
                dias_atraso: diasAtraso,
                ultimo_envio: ultimoEnvioCliente,
            })

        }

        if (dryRun) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                timestamp: new Date().toISOString(),
                total_deudas: deudas?.length ?? 0,
                procesadas,
                omitidos,
                motivos,
                datos_invalidos: datosInvalidos,
                planificados,
            })
        }

        // Ejecutar en lotes
        let enviados = 0
        let errores = 0

        for (let i = 0; i < tareasEnvio.length; i += BATCH_SIZE) {
            const batch = tareasEnvio.slice(i, i + BATCH_SIZE)
            const resultados = await Promise.allSettled(batch.map(fn => fn()))

            for (const res of resultados) {
                if (res.status === 'fulfilled' && res.value.estado === 'enviado') {
                    enviados++
                } else {
                    errores++
                }
            }
        }

        return NextResponse.json({
            ok: true,
            timestamp: new Date().toISOString(),
            total_deudas: deudas?.length ?? 0,
            procesadas,
            enviados,
            omitidos,
            errores,
            motivos,
        })
    } catch (error) {
        console.error('[CRON] Error:', error)
        return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
    }
}
