-- ══════════════════════════════════════════════════════════════
-- Migración: Fix anti-duplicado del cron de recordatorios
--
-- Problema: el cron cargaba los envíos recientes con
--   .limit(deudaIds.length * 5)   ← límite GLOBAL, no por grupo.
-- Con varias deudas activas, las deudas más "chatty" (mora/recup)
-- acaparaban el top N*5 por sent_at DESC y el último envío de
-- deudas tranquilas quedaba fuera del resultado → el motor asumía
-- que no había envío previo y reenviaba aunque ya hubiera mandado
-- horas antes. Efecto visible: 2–3 notificaciones al cliente por día.
--
-- Fix: RPC que devuelve exactamente el último envío por
-- (deuda_id, tipo_destino) vía DISTINCT ON — resuelto en SQL,
-- sin depender de límites de PostgREST.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ultimos_envios_por_deuda(
    p_deuda_ids UUID[]
)
RETURNS TABLE (
    deuda_id       UUID,
    tipo_destino   TEXT,
    ultimo_sent_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (el.deuda_id, el.tipo_destino)
        el.deuda_id,
        el.tipo_destino,
        el.sent_at AS ultimo_sent_at
    FROM public.envios_log el
    WHERE el.deuda_id = ANY(p_deuda_ids)
    ORDER BY el.deuda_id, el.tipo_destino, el.sent_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.ultimos_envios_por_deuda(UUID[])
    TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
