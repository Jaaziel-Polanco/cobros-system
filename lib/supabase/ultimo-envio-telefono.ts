/**
 * Último envío a cliente por TELÉFONO, dentro de una ventana reciente.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────
 *
 * El anti-duplicado del cron (`ultimo-envio.ts`) va por deuda: impide
 * escribir dos veces por la misma deuda dentro del intervalo de su etapa.
 * Pero el WhatsApp llega a un teléfono, y las plantillas no dicen de qué
 * deuda hablan, así que para el cliente dos deudas son dos mensajes iguales.
 *
 * Visto en producción (2026-10-14), en la tanda de reactivación del cron:
 * teléfonos que iban a recibir más de un mensaje en la misma corrida (muchos
 * por estar registrados como clientes distintos), y números que habían
 * recibido un mensaje MANUAL por otra deuda hacía menos de 24 h e iban a
 * recibir otro.
 *
 * Se lee `envios_log` directamente (no las deudas activas) para ver también
 * los envíos por deudas ya saldadas o pausadas y los manuales: lo que cuenta
 * es lo que le llegó a ese número. Se cuentan todos los estados, igual que el
 * anti-duplicado por deuda: ante la duda, no repetir.
 */

import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from './paginacion'
import { normalizarTelefono } from '@/lib/utils/cobranza-engine'

/** Lo mínimo que se necesita de un cliente de Supabase para leer. */
export interface ClienteLector {
    from(tabla: string): {
        select(
            columnas: string,
            opciones?: { count?: 'exact'; head?: boolean },
        ): unknown
    }
}

interface FilaEnvio {
    id: string
    sent_at: string
    cliente: { telefono: string | null } | null
}

/**
 * Teléfono normalizado (`normalizarTelefono`) → `sent_at` del envío a cliente
 * más reciente desde `desdeIso`. Lanza si la lectura no se puede completar:
 * un mapa corto aquí es un WhatsApp repetido.
 */
export async function leerUltimoEnvioPorTelefono(
    cliente: ClienteLector,
    desdeIso: string,
): Promise<Map<string, string>> {
    const filtrar = (consulta: ConsultaEncadenable) =>
        consulta.eq('tipo_destino', 'cliente').gte('sent_at', desdeIso)

    const envios = await leerTodasLasFilas<FilaEnvio>({
        etiqueta: 'los envíos recientes por teléfono',
        clave: 'id',
        lote: (cursor, limite) => {
            const base = filtrar(encadenable(
                cliente.from('envios_log').select('id, sent_at, cliente:clientes(telefono)'),
            ))
            return comoLote<FilaEnvio>(
                (cursor ? base.gt('id', cursor) : base).order('id').limit(limite),
            )
        },
        contar: () => comoConteo(filtrar(
            encadenable(cliente.from('envios_log').select('id', { count: 'exact', head: true })),
        )),
    })

    const mapa = new Map<string, string>()
    const masReciente = new Map<string, number>()
    for (const envio of envios) {
        const telefono = normalizarTelefono(envio.cliente?.telefono)
        const ms = Date.parse(envio.sent_at)
        if (!telefono || Number.isNaN(ms)) continue
        const previo = masReciente.get(telefono)
        if (previo === undefined || ms > previo) {
            masReciente.set(telefono, ms)
            mapa.set(telefono, envio.sent_at)
        }
    }
    return mapa
}
