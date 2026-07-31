-- ══════════════════════════════════════════════════════════════
-- Migración: falta una policy de SELECT para que la asignación de
-- huérfanos funcione de verdad entre agentes distintos
--
-- HALLAZGO (al verificar 20260730_14 impersonando un agente real con
-- SET LOCAL ROLE authenticated + request.jwt.claims): Postgres exige que,
-- para un UPDATE o DELETE, la fila objetivo sea visible también a través
-- de alguna policy de SELECT aplicable -- no basta con que la policy de
-- UPDATE/ALL la autorice. Sin una policy de SELECT que cubra "huérfanos
-- para quien tiene realizar_sorteo", la única policy de SELECT no-admin
-- sobre `tickets` sigue siendo "tickets: agente ve los de sus clientes"
-- (exige ser dueño del cliente). Resultado comprobado en producción con
-- datos ZZTEST_ (creados y borrados en la misma sesión de verificación):
-- un agente con realizar_sorteo (y SIN ser dueño del cliente del boleto)
-- intentó asignar un huérfano válido, SIN choque de número, de OTRO
-- agente -- el UPDATE afectó 0 filas, sin error. La policy de
-- 20260730_14 en sí es correcta (USING/WITH CHECK bien formados y
-- confirmados en la misma sesión con un huérfano de un cliente PROPIO),
-- pero es letra muerta para el caso que la motivó: "el boleto huérfano a
-- asignar puede pertenecer a un cliente de OTRO agente" (comentario
-- original de 20260730_14) -- ese caso, tal como estaba, no funcionaba.
--
-- CORRECCIÓN: policy de SELECT gemela, con el mismo alcance que el USING
-- de la policy de UPDATE (huérfanos con permiso realizar_sorteo). No se
-- exige estado = 'valido' aquí a propósito: ver un huérfano anulado no es
-- peligroso (no se puede escribir sobre él por esta vía, ver 20260730_14)
-- y de todos modos facilita depurar/auditar qué boletos existen antes de
-- decidir a qué sorteo asignar cada uno.
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tickets: ver huerfanos con permiso de sorteo" ON public.tickets;
CREATE POLICY "tickets: ver huerfanos con permiso de sorteo"
  ON public.tickets FOR SELECT
  USING (
    sorteo_id IS NULL
    AND public.tiene_permiso('realizar_sorteo')
  );
