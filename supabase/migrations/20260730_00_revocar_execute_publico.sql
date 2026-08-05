-- ══════════════════════════════════════════════════════════════
-- Migración de SEGURIDAD: revocar EXECUTE público de los RPC
--
-- APLICADA Y VERIFICADA contra producción el 2026-07-30.
--
-- HALLAZGO: PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, y
-- Supabase añade además un ALTER DEFAULT PRIVILEGES que concede EXECUTE a
-- anon, authenticated y service_role. Este proyecto nunca revocó ninguno
-- de los dos, así que todas las funciones del esquema `public` eran
-- invocables con la clave anónima, que viaja dentro del bundle de
-- JavaScript que la aplicación sirve al navegador.
--
-- Comprobado ejecutándolas de verdad con la clave anónima. Las que
-- importaban, todas SECURITY DEFINER (ignoran RLS):
--
--   · registrar_pago_atomico   — permitía saldar la deuda de un cliente
--                                a quien conociera un deuda_id.
--   · limpiar_envios_antiguos  — con p_dias_retencion = 0 vacía la tabla
--                                envios_log entera.
--   · emitir_ticket            — emitir boletos y leer el snapshot, que
--                                incluye la cédula (dni_ruc).
--   · ultimos_envios_por_deuda — historial de cobranza saltándose RLS.
--
-- Problema PREEXISTENTE, anterior al módulo de boletería.
--
-- ─── POR QUÉ HACEN FALTA LOS DOS REVOKE ───────────────────────
-- Revocar solo de PUBLIC no basta: el grant explícito a `anon` que crea
-- el ALTER DEFAULT PRIVILEGES de Supabase sobrevive. Y revocar solo de
-- `anon` tampoco basta: lo hereda de nuevo por PUBLIC. Hay que revocar de
-- ambos y volver a conceder a los roles que sí deben poder llamarlas.
--
-- ─── QUÉ NO SE TOCA Y POR QUÉ ─────────────────────────────────
-- get_my_rol() y tiene_permiso() se dejan accesibles a propósito, pese a
-- que el linter de Supabase las reporta. Ambas se invocan DENTRO de las
-- policies de RLS, y una policy ejecuta sus funciones con el rol de quien
-- consulta: si se les revoca EXECUTE, cualquier consulta contra una tabla
-- con RLS lanzaría un error en vez de devolver cero filas, y dejaría a los
-- usuarios fuera de sus propias tablas. Ninguna filtra nada: sin sesión
-- auth.uid() es NULL y ambas devuelven NULL.
--
-- Ejecutar en: Supabase Studio → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── Escritura de dinero ──────────────────────────────────────
-- Las Server Actions la invocan con el cliente de sesión, que corre como
-- `authenticated`; el cron y los procesos internos, con service_role.
REVOKE ALL ON FUNCTION public.registrar_pago_atomico(UUID, NUMERIC, TEXT, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_atomico(UUID, NUMERIC, TEXT, TEXT, UUID, BOOLEAN)
  TO authenticated, service_role;

-- ─── Emisión de boletos ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.emitir_ticket(UUID, UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_ticket(UUID, UUID, UUID, TEXT, TEXT, UUID)
  TO authenticated, service_role;

-- ─── Borrado del historial de envíos ──────────────────────────
-- Destructiva. Ni siquiera un agente autenticado debería poder vaciar la
-- bitácora de cobranza desde el navegador.
REVOKE ALL ON FUNCTION public.limpiar_envios_antiguos(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpiar_envios_antiguos(INTEGER) TO service_role;

-- ─── Recálculo masivo de días de atraso ───────────────────────
REVOKE ALL ON FUNCTION public.actualizar_dias_atraso() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_dias_atraso() TO authenticated, service_role;

-- ─── Utilidad de fechas quincenales ───────────────────────────
REVOKE ALL ON FUNCTION public.proxima_fecha_quincenal(DATE, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proxima_fecha_quincenal(DATE, INTEGER, INTEGER)
  TO authenticated, service_role;

-- ─── Historial de envíos por deuda ────────────────────────────
-- Solo la llama el cron (app/api/cron/recordatorios/route.ts).
REVOKE ALL ON FUNCTION public.ultimos_envios_por_deuda(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ultimos_envios_por_deuda(uuid[]) TO authenticated, service_role;

-- ─── Función de trigger ───────────────────────────────────────
-- La ejecuta el motor como dueño de la tabla: ningún rol de la API
-- necesita EXECUTE sobre ella.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN. Todas deben dar anon = false.
--
--   SELECT p.proname,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('registrar_pago_atomico','emitir_ticket',
--                       'limpiar_envios_antiguos','actualizar_dias_atraso',
--                       'proxima_fecha_quincenal','ultimos_envios_por_deuda',
--                       'handle_new_user');
-- ══════════════════════════════════════════════════════════════
