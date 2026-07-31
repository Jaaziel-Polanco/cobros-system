/**
 * Último envío registrado por deuda, para un `tipo_destino` concreto.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────
 *
 * El cron de recordatorios construía este mapa así:
 *
 *   const { data } = await supabase.rpc('ultimos_envios_por_deuda',
 *                                       { p_deuda_ids: deudaIds })
 *   for (const r of data ?? []) {
 *       if (r.tipo_destino === 'cliente') mapa.set(r.deuda_id, r.ultimo_sent_at)
 *   }
 *
 * Ese mapa es lo único que impide reenviar: una deuda que no aparece en él se
 * lee como «nunca notificada» y recibe otro WhatsApp. Y **el resultado de un
 * RPC también está sujeto al `max-rows` de PostgREST**, que recorta a 1000
 * filas sin error, sin cabecera y con `error: null` (ver `paginacion.ts`).
 * Una función no es inmune al tope: PostgREST expone una función que devuelve
 * `SETOF`/`TABLE` como una relación más.
 *
 * Comprobado contra producción (2026-07-31, sólo lecturas):
 *
 *   | Llamando con las 741 deudas activas de hoy | 729 filas / 1000 |
 *   | Llamando con las 1102 deudas de la tabla   | **1000 filas devueltas, 1088 reales** |
 *
 * O sea: no es un riesgo futuro que dependa de crecer, es un recorte que ya
 * se reproduce hoy en cuanto el conjunto de deudas consultado es mayor. Con
 * el conjunto que usa el cron el margen es del 73 %, y **88 deudas** se
 * perdían en la segunda medición. Cada deuda perdida es un cliente que ya
 * recibió el aviso y lo recibe otra vez.
 *
 * ── POR QUÉ ESTE DISEÑO Y NO OTRO ─────────────────────────────
 *
 * El obstáculo conocido era que `deuda_id` **no es único** en el resultado
 * del RPC —agrupa por `(deuda_id, tipo_destino)`—, así que no sirve de cursor
 * por sí solo. Que hoy sí lo sea (en `envios_log` no hay ni una fila
 * `referencia`: 30 981 filas, todas `cliente`) es una coincidencia, y
 * `lib/actions/referencias.ts` ya tiene escrito el código que la romperá.
 * Construir la corrección sobre ella sería repetir la clase de suposición no
 * declarada que causó todos los defectos de este módulo.
 *
 * La salida es que PostgREST trata el resultado del RPC como una relación, y
 * por tanto le admite `.eq()`, `.order()`, `.gt()`, `.limit()` y
 * `count: 'exact'`, **todo resuelto en la base y antes del recorte**
 * (comprobado contra producción, no supuesto). Eso permite:
 *
 *  1. **Filtrar por `tipo_destino` en la base.** El cron sólo usa `cliente`;
 *     el resto se descartaba en Node después de haber gastado cupo con él.
 *  2. **Paginar por `deuda_id`** con la misma `leerTodasLasFilas` de siempre.
 *
 * Y lo que hace correcto el cursor no es el dato de hoy, es el SQL: con
 * `DISTINCT ON (deuda_id, tipo_destino)`, fijado un `tipo_destino`, hay como
 * mucho **una** fila por `deuda_id`. Por eso `tipoDestino` es un parámetro
 * obligatorio de esta función y no tiene valor por defecto: el modo inseguro
 * —paginar por `deuda_id` sin fijar el tipo— no es alcanzable desde aquí. Si
 * alguien lo intentase igualmente, `leerTodasLasFilas` aborta con «la fila
 * con deuda_id=… llegó dos veces» en vez de saltarse filas en silencio.
 *
 * Alternativas descartadas:
 *
 *  - **Añadir `p_tipo_destino` al RPC.** No aporta nada sobre el filtro de
 *    PostgREST (se resuelve en la base igual) y cuesta DDL: `CREATE OR
 *    REPLACE` no admite añadir un parámetro, haría falta `DROP FUNCTION` y
 *    una ventana en la que el código desplegado y la base no concuerdan. Y
 *    sobre todo **no resuelve el problema por sí sola**: sólo baja el techo
 *    de «1000 pares (deuda, tipo)» a «1000 deudas», y la lista de deudas es
 *    justo lo que ya hubo que paginar. Seguiría haciendo falta este mismo
 *    código encima.
 *  - **Paginar por la clave compuesta `(deuda_id, tipo_destino)`.** Exige una
 *    comparación de tuplas que PostgREST no sabe expresar, o una columna
 *    cursor sintética en el RPC (otra vez DDL). Y resuelve un problema que no
 *    tenemos: el cron consume un solo tipo; traer los demás para tirarlos es
 *    lo que consume el cupo.
 *  - **Trocear `deudaIds` y llamar al RPC por bloques.** Deja fuera el
 *    contraste contra el conteo exacto, que es la defensa que de verdad
 *    importa: un bloque corto por recorte es indistinguible de un bloque en
 *    el que varias deudas no tienen ningún envío.
 */

import {
    leerTodasLasFilas, encadenable, comoLote, comoConteo,
    type ConsultaEncadenable,
} from './paginacion'

/** Los valores que admite `envios_log.tipo_destino` (CHECK del esquema). */
export type TipoDestino = 'cliente' | 'referencia'

/**
 * Lo mínimo que se necesita de un cliente de Supabase para llamar al RPC.
 *
 * No se usa `SupabaseClient` por lo mismo que en `ultimo-pago.ts`: encadenar
 * los genéricos de `postgrest-js` a través de un helper dispara TS2589.
 */
export interface ClienteRpc {
    rpc(
        nombre: string,
        args: Record<string, unknown>,
        opciones?: { count?: 'exact' },
    ): unknown
}

interface FilaUltimoEnvio {
    deuda_id: string
    tipo_destino: string
    ultimo_sent_at: string
}

/**
 * `deuda_id` → `sent_at` del último envío de ese `tipoDestino`.
 *
 * Las deudas a las que nunca se les envió nada de ese tipo no aparecen en el
 * mapa. Lanza si la lectura no se puede completar: un mapa corto aquí no
 * produce un error visible, produce un segundo WhatsApp a gente que ya fue
 * notificada.
 */
export async function leerUltimoEnvioPorDeuda(
    cliente: ClienteRpc,
    deudaIds: readonly string[],
    tipoDestino: TipoDestino,
): Promise<Map<string, string>> {
    const mapa = new Map<string, string>()
    if (deudaIds.length === 0) return mapa

    const args = { p_deuda_ids: deudaIds }

    // El mismo filtro para el lote y para el conteo de control, escrito una
    // sola vez: si no fueran idénticos, la comprobación de completitud de
    // `leerTodasLasFilas` no comprobaría nada. Es además el filtro que hace
    // único a `deuda_id` y por tanto válido como cursor.
    const filtrar = (consulta: ConsultaEncadenable) =>
        consulta.eq('tipo_destino', tipoDestino)

    const filas = await leerTodasLasFilas<FilaUltimoEnvio>({
        etiqueta: `los últimos envíos a '${tipoDestino}' de las deudas consultadas`,
        clave: 'deuda_id',
        lote: (cursor, limite) => {
            const base = filtrar(encadenable(
                cliente.rpc('ultimos_envios_por_deuda', args),
            ))
            return comoLote<FilaUltimoEnvio>(
                (cursor ? base.gt('deuda_id', cursor) : base).order('deuda_id').limit(limite),
            )
        },
        // `head: true` no vale aquí: el endpoint de un RPC no responde a
        // HEAD (404 comprobado contra producción). Se pide `count: 'exact'`
        // con `limit(1)`, que devuelve el total real en `Content-Range` con
        // una sola fila de carga útil. El conteo lo calcula Postgres y NO
        // está sujeto a `max-rows` — esa asimetría es lo único que permite
        // distinguir «no hay más filas» de «el servidor recortó».
        contar: () => comoConteo(
            filtrar(encadenable(
                cliente.rpc('ultimos_envios_por_deuda', args, { count: 'exact' }),
            )).limit(1),
        ),
    })

    for (const fila of filas) {
        if (typeof fila.ultimo_sent_at === 'string' && fila.ultimo_sent_at !== '') {
            mapa.set(fila.deuda_id, fila.ultimo_sent_at)
        }
    }

    return mapa
}
