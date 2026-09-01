/**
 * EL BOLETO DE EJEMPLO.
 *
 * Un boleto ficticio con la misma forma exacta que uno real, que NO existe
 * en la base de datos y que por tanto no entra en ningún sorteo, no cuenta
 * en ninguna estadística y no se le puede anular. Lo usan tres sitios:
 *
 *   1. La prueba del webhook de boletos (`lib/webhooks/payload-prueba.ts`),
 *      que necesita un payload completo con su PDF en base64.
 *   2. La página pública `/t/demo`.
 *   3. La descarga `/api/tickets/demo/pdf`.
 *
 * ── POR QUÉ EXISTE `/t/demo` ──────────────────────────────────
 *
 * Para dar de alta una plantilla de WhatsApp con un botón de URL, Meta pide
 * un ejemplo del enlace y dice, con todas las letras, «do not use real
 * customer information». Los enlaces reales son `/t/<token>` con un token
 * aleatorio de 256 bits y llevan el nombre y la cédula enmascarada de una
 * persona: no se pueden pegar en un formulario de revisión.
 *
 * La alternativa —emitir un boleto de mentira en producción— es peor: se
 * quedaría en la tabla `tickets`, entraría en el pool del sorteo y habría
 * que acordarse de borrarlo. Un boleto que se arma en memoria no ensucia
 * nada y no caduca.
 *
 * Los datos del NEGOCIO sí son los de verdad (nombre, RNC, dirección,
 * términos): es lo que hace que el ejemplo se parezca a lo que va a ver el
 * revisor. El cliente y el número de boleto son inventados.
 */
import type { ConfiguracionTicket, Ticket } from '@/lib/types/tickets'
import { formatearFechaHoraRD } from '@/lib/utils/fecha-rd'

/**
 * Token del boleto de ejemplo. Cuatro letras: ningún boleto real puede
 * colisionar, porque los suyos son 32 bytes aleatorios en base64url.
 */
export const TOKEN_DEMO = 'demo'

/** UUID nulo con un dígito final: imposible que choque con datos reales. */
export const UUID_CLIENTE_DEMO = '00000000-0000-0000-0000-000000000001'
export const UUID_TICKET_DEMO = '00000000-0000-0000-0000-000000000004'
export const UUID_SORTEO_DEMO = '00000000-0000-0000-0000-000000000005'

/**
 * El número 0 no lo puede tener ningún boleto real: la numeración de cada
 * sorteo arranca en 1 (`ultimo_numero + 1` en emitir_ticket). Así el boleto
 * de ejemplo conserva el formato exacto de producción y aun así es
 * inconfundible.
 */
export const NUMERO_DEMO = 0

/** Si no hay teléfono del negocio configurado. Ver `telefonoDePrueba()`. */
export const TELEFONO_PRUEBA_FALLBACK = '8095550000'

/**
 * A qué número va una prueba de envío.
 *
 * Al teléfono del NEGOCIO, no a uno inventado: si el flujo de n8n llega
 * hasta el envío, el WhatsApp con el PDF adjunto le cae a quien pulsó el
 * botón. Eso es justamente lo que hace útil una prueba de boletos -- se ve
 * el mensaje y se abre el PDF -- y evita molestar a un tercero al que le
 * hubiera tocado por azar el número ficticio.
 */
export function telefonoDePrueba(
    cfg?: Pick<ConfiguracionTicket, 'telefono'> | null,
): string {
    const t = cfg?.telefono?.trim()
    return t && t.replace(/\D/g, '').length >= 10 ? t : TELEFONO_PRUEBA_FALLBACK
}

/** Configuración de boletos mínima si la fila todavía no existe. */
export const CFG_TICKET_POR_DEFECTO: ConfiguracionTicket = {
    id: true,
    nombre_comercial: 'Inversiones Cordero',
    rnc: null,
    direccion: null,
    telefono: null,
    logo_url: null,
    texto_legal: null,
    url_terminos: null,
    prefijo_numeracion: 'BOL',
    pie_impresion: null,
    modo_adjunto: 'base64',
    updated_at: new Date(0).toISOString(),
    updated_by: null,
}

/** El sorteo real que se usaría; `null` si no hay ninguno. */
export interface SorteoDePrueba {
    id: string
    nombre: string
    premio: string | null
    fecha_fin: string
    prefijo: string
}

/** Columnas que hay que pedirle a `sorteos` para `elegirSorteoDemo()`. */
export const COLUMNAS_SORTEO_DEMO =
    'id, nombre, premio, fecha_fin, prefijo, estado, created_at'

/**
 * De las filas de `sorteos`, la que usaría el ejemplo.
 *
 * Se prefiere el ACTIVO porque es el único que usaría `emitir_ticket`. Si
 * no hay ninguno, se cae al borrador más reciente: el ejemplo sigue siendo
 * el del flujo real, pero con el nombre y el prefijo que de verdad se van a
 * usar, que es lo que se quiere ver antes de abrir el sorteo.
 *
 * Recibe `unknown` a propósito: los tres sitios que la llaman traen las
 * filas de clientes de Supabase con genéricos distintos, y tipar el cliente
 * en la firma obligaba a pelearse con ellos sin ganar nada.
 */
export function elegirSorteoDemo(filas: unknown): SorteoDePrueba | null {
    if (!Array.isArray(filas)) return null
    const candidatos = filas as (SorteoDePrueba & { estado?: string })[]
    return (
        candidatos.find(s => s.estado === 'activo')
        ?? candidatos.find(s => s.estado === 'borrador')
        ?? null
    )
}

/**
 * Boleto ficticio con la MISMA forma que uno real, para que el PDF salga
 * del mismo `TicketDocument` que usa producción. El snapshot se llena con
 * la configuración real del negocio: si el logo, el RNC o el texto legal
 * están mal puestos, el ejemplo lo enseña en el PDF.
 */
export function construirTicketDePrueba(
    cfg: ConfiguracionTicket,
    sorteo: SorteoDePrueba | null,
    ahora: Date = new Date(),
): Ticket {
    const emitidoAt = ahora.toISOString()
    const secuencia = String(NUMERO_DEMO).padStart(6, '0')
    const numeroFormateado = sorteo
        ? `${sorteo.prefijo}-${secuencia}`
        : `${cfg.prefijo_numeracion}-SN-${secuencia}`

    return {
        id: UUID_TICKET_DEMO,
        numero: NUMERO_DEMO,
        numero_formateado: numeroFormateado,
        sorteo_id: sorteo?.id ?? null,
        cliente_id: UUID_CLIENTE_DEMO,
        pago_id: null,
        deuda_id: null,
        origen: 'manual',
        motivo: 'Boleto de ejemplo: no existe en la base de datos',
        estado: 'valido',
        anulado_por: null,
        anulado_at: null,
        motivo_anulacion: null,
        token_publico: TOKEN_DEMO,
        snapshot: {
            cliente: {
                id: UUID_CLIENTE_DEMO,
                nombre: 'Juan',
                apellido: 'Pérez',
                telefono: telefonoDePrueba(cfg),
                dni_ruc: '00100000001',
            },
            sorteo: sorteo
                ? {
                    id: sorteo.id,
                    nombre: sorteo.nombre,
                    premio: sorteo.premio,
                    fecha_fin: sorteo.fecha_fin,
                }
                : {
                    id: UUID_SORTEO_DEMO,
                    nombre: 'Sorteo de Prueba',
                    premio: 'Premio de ejemplo',
                    fecha_fin: new Date(ahora.getTime() + 30 * 86_400_000)
                        .toISOString().split('T')[0],
                },
            negocio: {
                nombre_comercial: cfg.nombre_comercial,
                rnc: cfg.rnc,
                direccion: cfg.direccion,
                telefono: cfg.telefono,
                texto_legal: cfg.texto_legal,
                url_terminos: cfg.url_terminos,
                pie_impresion: cfg.pie_impresion,
                logo_url: cfg.logo_url,
            },
            emitido_at_rd: formatearFechaHoraRD(emitidoAt),
            origen: 'manual',
            version_snapshot: 1,
        },
        emitido_por: null,
        emitido_at: emitidoAt,
        veces_enviado: 0,
        veces_impreso: 0,
        created_at: emitidoAt,
    }
}
