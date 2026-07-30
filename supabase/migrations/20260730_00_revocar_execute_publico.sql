-- ══════════════════════════════════════════════════════════════
-- Migración de SEGURIDAD: revocar EXECUTE público de los RPC
--
-- HALLAZGO (verificado contra la base de producción el 2026-07-30):
-- PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, y este
-- proyecto nunca lo revocó. Todas las funciones del esquema `public`
-- eran invocables con la clave anónima, que es pública y viaja dentro
-- del bundle de JavaScript que sirve la aplicación al navegador.
--
-- Las tres que importan de verdad, todas SECURITY DEFINER (ignoran RLS):
--
--   · registrar_pago_atomico  — permitía saldar la deuda de un cliente
--                               a cualquiera que conociera un deuda_id.
--   · limpiar_envios_antiguos — llamada con p_dias_retencion = 0 vacía
--                               la tabla envios_log entera.
--   · emitir_ticket           — permitía emitir boletos y leer el
--                               snapshot, que incluye la cédula (dni_ruc).
--
-- Es un problema PREEXISTENTE, anterior al módulo de boletería.
--
-- ─── QUÉ NO SE TOCA Y POR QUÉ ─────────────────────────────────
-- get_my_rol(), tiene_permiso() y calcular_etapa_cobranza() se dejan
-- intactas a propósito. Las dos primeras se invocan DENTRO de las
-- policies de RLS, y una policy ejecuta sus funciones con el rol de
-- quien consulta: revocarles EXECUTE haría que toda evaluación de RLS
-- lanzara un error en vez de devolver falso, y dejaría a los usuarios
-- fuera de sus propias tablas. Además ninguna expone nada: sin sesión
-- devuelven NULL, y calcular_etapa_cobranza es una función pura sobre
-- un entero.
--
-- Ejecutar en: Supabase Studio → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── Escritura de dinero ──────────────────────────────────────
-- Las Server Actions la invocan con el cliente de sesión, que corre
-- como `authenticated`; el cron y los procesos internos, con service_role.
REVOKE ALL ON FUNCTION public.registrar_pago_atomico(UUID, NUMERIC, TEXT, TEXT, UUID, BOOLEAN)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_atomico(UUID, NUMERIC, TEXT, TEXT, UUID, BOOLEAN)
  TO authenticated, service_role;

-- ─── Emisión de boletos ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.emitir_ticket(UUID, UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.emitir_ticket(UUID, UUID, UUID, TEXT, TEXT, UUID)
  TO authenticated, service_role;

-- ─── Borrado del historial de envíos ──────────────────────────
-- Solo service_role: es destructiva y ningún agente debería poder
-- vaciar la bitácora de cobranza desde el navegador.
REVOKE ALL ON FUNCTION public.limpiar_envios_antiguos(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpiar_envios_antiguos(INTEGER) TO service_role;

-- ─── Recálculo masivo de días de atraso ───────────────────────
-- La dispara el cron. Un agente autenticado no gana nada llamándola,
-- pero un anónimo no tiene por qué poder mutar todas las deudas.
REVOKE ALL ON FUNCTION public.actualizar_dias_atraso() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_dias_atraso() TO authenticated, service_role;

-- ─── Utilidad de fechas quincenales (solo lectura, pero innecesaria) ──
REVOKE ALL ON FUNCTION public.proxima_fecha_quincenal(DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proxima_fecha_quincenal(DATE, INTEGER, INTEGER)
  TO authenticated, service_role;

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN posterior. Debe devolver una fila por función, y la
-- columna `permisos` NO debe estar vacía ni contener "=X/" suelto
-- (que es lo que representa el privilegio concedido a PUBLIC).
--
--   SELECT p.proname, array_to_string(p.proacl, E'\n') AS permisos
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('registrar_pago_atomico','emitir_ticket',
--                       'limpiar_envios_antiguos','actualizar_dias_atraso',
--                       'proxima_fecha_quincenal');
-- ══════════════════════════════════════════════════════════════
