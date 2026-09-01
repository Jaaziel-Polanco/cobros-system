/**
 * Payloads de PRUEBA de los webhooks.
 *
 * ── EL DEFECTO QUE ESTE MÓDULO CORRIGE ────────────────────────
 *
 * `testWebhook()` construía UN solo payload, escrito a mano, con forma de
 * cobranza (`cliente` + `deuda` + `etapa`), y lo enviaba a cualquier
 * webhook sin mirar su columna `evento`. Probar el webhook de Boletos
 * mandaba un recordatorio de mora: el flujo de n8n de boletos recibía un
 * cuerpo que no reconoce, sin `ticket` y sin `adjunto`, así que la prueba
 * no probaba nada de lo que iba a ocurrir de verdad.
 *
 * Peor: la vista tenía su PROPIA copia del payload (`samplePayload` en
 * webhooks-view.tsx) que ni siquiera coincidía con la del servidor -- la
 * vista mostraba `evento: 'recordatorio_cobranza'` y el servidor enviaba
 * `evento: 'test_conexion'`. El usuario leía una cosa y n8n recibía otra.
 *
 * Por eso los payloads viven aquí, en funciones puras, y los usan tanto el
 * envío como la previsualización. Una sola fuente: lo que se ve en pantalla
 * es, byte a byte, lo que sale por el POST (salvo el base64, que se elide
 * sólo para mostrarlo).
 *
 * ── POR QUÉ EL `evento` ES EL REAL Y NO 'test_conexion' ───────
 *
 * Un flujo de n8n enruta por `evento`. Si la prueba manda un valor que no
 * existe en producción, se cae por la rama por defecto y no ejercita nada:
 * es una prueba de que la URL responde 200, no de que el flujo funcione.
 * El payload de prueba lleva el `evento` real y se distingue por
 * `_test: true`, que n8n puede consultar en un IF cuando quiera cortar.
 */
import type { EventoWebhook, WebhookPayload } from '@/lib/types'
import type {
    ConfiguracionTicket, Ticket, TicketWebhookPayload,
} from '@/lib/types/tickets'
import { renderTemplate } from '@/lib/utils/template-renderer'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'

/** Marca que llevan TODOS los payloads de prueba. */
export interface MarcaPrueba {
    _test: true
}

export type PayloadPruebaCobranza = WebhookPayload & MarcaPrueba
export type PayloadPruebaTicket = TicketWebhookPayload & MarcaPrueba
export type PayloadPrueba = PayloadPruebaCobranza | PayloadPruebaTicket

/**
 * Lo que la pantalla necesita saber de una prueba, se envíe o no.
 *
 * `payload` viene con el base64 ya elidido (ver `payloadParaMostrar`); el
 * tamaño real del PDF va aparte, en `adjunto`. `avisos` son las diferencias
 * entre esta prueba y un envío real -- se muestran en pantalla en vez de
 * quedarse calladas, que es justo lo que hacía la versión anterior.
 *
 * Vive aquí y no en la Server Action porque un módulo `'use server'` sólo
 * debe exportar funciones asíncronas.
 */
export interface PruebaWebhook {
    evento: EventoWebhook
    payload: unknown
    adjunto: ResumenAdjunto | null
    avisos: string[]
}

/** El payload que viaja, junto con la vista que se pinta. */
export interface PruebaArmada {
    completo: PayloadPrueba
    vista: PruebaWebhook
}

export interface ResultadoPruebaWebhook extends PruebaWebhook {
    ok: boolean
    status: number
    body?: string
}


const UUID_DEUDA = '00000000-0000-0000-0000-000000000002'
const UUID_AGENTE = '00000000-0000-0000-0000-000000000003'

/**
 * El boleto ficticio vive en `lib/tickets/boleto-demo.ts` porque lo
 * comparten tres sitios: esta prueba, la página pública `/t/demo` y la
 * descarga `/api/tickets/demo/pdf`. Se re-exporta para no obligar a nadie
 * a importar de dos módulos.
 */
export {
    CFG_TICKET_POR_DEFECTO,
    TELEFONO_PRUEBA_FALLBACK,
    TOKEN_DEMO,
    construirTicketDePrueba,
    telefonoDePrueba,
    type SorteoDePrueba,
} from '@/lib/tickets/boleto-demo'

import { UUID_CLIENTE_DEMO as UUID_CLIENTE } from '@/lib/tickets/boleto-demo'

export const MENSAJE_COBRANZA_POR_DEFECTO =
    'Estimado Juan Pérez, le recordamos que tiene un saldo pendiente de ' +
    'RD$35,000.00. Favor contactarnos para coordinar su pago. ' +
    '(ENVÍO DE PRUEBA con datos ficticios.)'

/** Payload de prueba del flujo de cobranza: misma forma que envios.ts. */
export function construirPayloadPruebaCobranza(opciones: {
    telefono: string
    /** Contenido de la plantilla activa de `mora_temprana`, si la hay. */
    plantillaContenido?: string | null
    ahora?: Date
}): PayloadPruebaCobranza {
    const ahora = opciones.ahora ?? new Date()
    const fechaCorte = new Date(ahora.getTime() - 15 * 86_400_000)
        .toISOString().split('T')[0]

    const mensaje = opciones.plantillaContenido
        ? renderTemplate(opciones.plantillaContenido, {
            nombre: 'Juan',
            apellido: 'Pérez',
            monto: 'RD$35,000.00',
            saldo: 'RD$35,000.00',
            dias_atraso: 15,
            fecha_corte: fechaCorte,
            agente: 'Agente de Prueba',
        })
        : MENSAJE_COBRANZA_POR_DEFECTO

    return {
        evento: 'recordatorio_cobranza',
        timestamp: ahora.toISOString(),
        enviado_por: 'manual',
        etapa: 'mora_temprana',
        tipo_destino: 'cliente',
        cliente: {
            id: UUID_CLIENTE,
            nombre: 'Juan',
            apellido: 'Pérez',
            telefono: opciones.telefono,
            email: 'prueba@ejemplo.com',
        },
        deuda: {
            id: UUID_DEUDA,
            monto_original: 50000,
            saldo_pendiente: 35000,
            cuota_mensual: 5000,
            tasa_interes: 2.5,
            fecha_corte: fechaCorte,
            dias_atraso: 15,
            frecuencia_pago: 'quincenal',
        },
        mensaje,
        agente: { id: UUID_AGENTE, nombre: 'Agente de Prueba' },
        _test: true,
    }
}

export const PLANTILLA_TICKET_POR_DEFECTO =
    '¡Gracias {{nombre}}! Tu boleto para *{{sorteo}}* es el número ' +
    '*{{ticket_numero}}*. Emitido el {{fecha}}. ' +
    '(ENVÍO DE PRUEBA con datos ficticios.)'

/**
 * Payload de prueba del flujo de boletos: idéntico al de
 * `construirPayloadTicket()` de lib/actions/tickets.ts, incluido el PDF en
 * base64. Es el único modo de que n8n pueda mapear el adjunto sin esperar a
 * que se emita un boleto real.
 */
export function construirPayloadPruebaTicket(opciones: {
    ticket: Ticket
    cfg: ConfiguracionTicket
    plantillaContenido?: string | null
    /** base64 del PDF ya generado, o `null` si `modo_adjunto` lo excluye. */
    base64: string | null
    urlPublica: string | null
    ahora?: Date
}): PayloadPruebaTicket {
    const { ticket, cfg } = opciones
    const s = ticket.snapshot
    const ahora = opciones.ahora ?? new Date()

    const mensaje = renderTemplate(
        opciones.plantillaContenido || PLANTILLA_TICKET_POR_DEFECTO,
        {
            nombre: s.cliente.nombre,
            apellido: s.cliente.apellido,
            ticket_numero: ticket.numero_formateado,
            sorteo: s.sorteo?.nombre ?? 'nuestro sorteo',
            premio: s.sorteo?.premio ?? '',
            fecha: formatearFechaHoraRD(ticket.emitido_at),
            url_terminos: cfg.url_terminos ?? '',
        },
    )

    return {
        evento: 'ticket_emitido',
        timestamp: ahora.toISOString(),
        enviado_por: 'manual',
        reenvio: false,
        cliente: {
            id: s.cliente.id,
            nombre: s.cliente.nombre,
            apellido: s.cliente.apellido,
            telefono: s.cliente.telefono ?? '',
        },
        ticket: {
            id: ticket.id,
            numero: ticket.numero_formateado,
            sorteo: s.sorteo
                ? {
                    id: s.sorteo.id,
                    nombre: s.sorteo.nombre,
                    premio: s.sorteo.premio,
                    fecha_fin: s.sorteo.fecha_fin,
                }
                : null,
            emitido_at: ticket.emitido_at,
        },
        mensaje,
        url_terminos: cfg.url_terminos ?? null,
        url_publica: opciones.urlPublica,
        adjunto: opciones.base64
            ? {
                tipo: 'pdf',
                nombre: `boleto-${ticket.numero_formateado}.pdf`,
                base64: opciones.base64,
            }
            : null,
        _test: true,
    }
}

export interface ResumenAdjunto {
    nombre: string
    caracteres_base64: number
    bytes_pdf: number
}

/**
 * Copia del payload apta para ENSEÑAR en pantalla: el base64 se sustituye
 * por su tamaño. Mandar cincuenta mil caracteres al navegador para
 * pintarlos en un `<pre>` no ayuda a nadie y congela la pestaña.
 */
export function payloadParaMostrar(
    payload: PayloadPrueba,
): { payload: unknown; adjunto: ResumenAdjunto | null } {
    if (!('adjunto' in payload) || !payload.adjunto) {
        return { payload, adjunto: null }
    }

    const { base64, ...restoAdjunto } = payload.adjunto
    const caracteres = base64.length
    const bytes = Math.floor((caracteres * 3) / 4)

    return {
        payload: {
            ...payload,
            adjunto: {
                ...restoAdjunto,
                base64: `<${caracteres.toLocaleString('es-DO')} caracteres: el PDF real viaja aquí>`,
            },
        },
        adjunto: {
            nombre: payload.adjunto.nombre,
            caracteres_base64: caracteres,
            bytes_pdf: bytes,
        },
    }
}
