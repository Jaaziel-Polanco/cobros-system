-- ────────────────────────────────────────────────────────────────
-- Último pago por deuda, agregado en la base.
--
-- ESTADO: ESCRITA Y **NO APLICADA**. El código de hoy no la usa y funciona
-- sin ella (pagina la lectura desde `lib/supabase/ultimo-pago.ts`). Esto es
-- la mejora, no el arreglo: aplicarla es decisión del dueño del sistema.
--
-- POR QUÉ
--
-- `leerUltimoPagoPorDeuda()` trae hoy todos los pagos de las deudas
-- consultadas (1905 filas en producción para 741 deudas activas) sólo para
-- quedarse con el más reciente de cada una: 513 filas útiles. La agregación
-- corresponde a la base, no al servidor de Node.
--
-- No se hace con agregados de PostgREST (`select=deuda_id,created_at.max()`)
-- porque este proyecto los tiene desactivados: responde
-- `400 PGRST123 "Use of aggregate functions is not allowed"`. Comprobado.
--
-- Es el hermano exacto de `ultimos_envios_por_deuda`, que ya existe para
-- `envios_log` y se creó por un motivo emparentado (un `.limit()` global que
-- no era por grupo). Misma forma, mismas garantías.
--
-- QUÉ CAMBIA EN EL CÓDIGO CUANDO SE APLIQUE
--
-- `leerUltimoPagoPorDeuda()` pasaría de paginar `pagos` a una sola llamada:
--
--   const { data, error } = await cliente.rpc('ultimos_pagos_por_deuda',
--                                             { p_deuda_ids: deudaIds })
--
-- Ojo: al hacerlo se pierde la red de seguridad de `leerTodasLasFilas`
-- (contraste contra el conteo exacto). El resultado del RPC sí está sujeto
-- al `max-rows` de PostgREST, así que sólo es seguro mientras el número de
-- DEUDAS consultadas se mantenga por debajo de 1000 — hoy son 741. Al
-- acercarse a ese tope habría que volver a paginar, ahora sobre un resultado
-- ya agregado, o comparar contra `count(distinct deuda_id)`.
--
-- SECURITY DEFINER, igual que `ultimos_envios_por_deuda`: el cron llama con
-- la service role, pero `getDeudasConPagosPendientes()` llama con la sesión
-- del agente, y ahí RLS sobre `pagos` recortaría el mapa en silencio — que
-- es la misma familia de defecto que esto viene a cerrar. El filtro por
-- `p_deuda_ids` es lo que acota lo que cada llamante puede ver.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ultimos_pagos_por_deuda(p_deuda_ids uuid[])
RETURNS TABLE(deuda_id uuid, ultimo_created_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT DISTINCT ON (p.deuda_id)
        p.deuda_id,
        p.created_at AS ultimo_created_at
    FROM public.pagos p
    WHERE p.deuda_id = ANY(p_deuda_ids)
    ORDER BY p.deuda_id, p.created_at DESC;
$function$;

-- Mismo criterio que `20260730_00_revocar_execute_publico.sql`: nada de
-- EXECUTE para `anon`.
REVOKE ALL ON FUNCTION public.ultimos_pagos_por_deuda(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ultimos_pagos_por_deuda(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.ultimos_pagos_por_deuda(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ultimos_pagos_por_deuda(uuid[]) TO service_role;

-- ── Comprobación, en BEGIN/ROLLBACK ─────────────────────────────
-- Debe devolver una fila por deuda con pagos, y `ultimo_created_at` debe
-- coincidir con `max(created_at)`. `discrepancias` tiene que salir 0.
--
-- BEGIN;
--   WITH ids AS (
--     SELECT array_agg(id) a FROM deudas
--     WHERE estado = 'activo' AND pausado = false AND etapa <> 'saldado'
--   ),
--   rpc AS (SELECT * FROM ids, LATERAL ultimos_pagos_por_deuda(ids.a)),
--   esperado AS (
--     SELECT p.deuda_id, max(p.created_at) m
--     FROM pagos p, ids WHERE p.deuda_id = ANY(ids.a) GROUP BY p.deuda_id
--   )
--   SELECT (SELECT count(*) FROM rpc)      AS filas_rpc,
--          (SELECT count(*) FROM esperado) AS filas_esperadas,
--          (SELECT count(*) FROM rpc JOIN esperado USING (deuda_id)
--             WHERE rpc.ultimo_created_at IS DISTINCT FROM esperado.m)
--                                          AS discrepancias;
-- ROLLBACK;
