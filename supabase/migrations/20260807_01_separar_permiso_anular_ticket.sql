-- ══════════════════════════════════════════════════════════════
-- Migración: separar «anular boletos» de «generar boletos»
--
-- `generar_ticket_manual` gateaba DOS acciones que no se parecen:
--
--   · emitirTicketManual() -- crear un boleto de cortesía, con motivo; y
--   · anularTicket()       -- invalidar un boleto que el cliente ya tiene
--                             en la mano.
--
-- Conceder la primera obligaba a conceder la segunda. Ahora la anulación
-- tiene su propio permiso, `anular_ticket`.
--
-- ── QUE NADIE GANE NI PIERDA NADA ─────────────────────────────
--
-- El riesgo de un cambio así no es romper: es CONCEDER en silencio. Si el
-- permiso nuevo se limitara a heredar su valor por defecto (TRUE), un
-- agente al que se le hubiera QUITADO `generar_ticket_manual` --es decir,
-- alguien a quien deliberadamente se le negó anular boletos-- amanecería
-- pudiendo anularlos. Un permiso que aparece solo porque se desplegó una
-- versión no lo concedió nadie, y no dejaría rastro en ninguna parte.
--
-- Por eso el relleno de abajo copia el valor que cada perfil tuviera en
-- `generar_ticket_manual`, no el valor por defecto. Hoy en producción son
-- 7 agentes, los 7 con el permiso en TRUE, así que en la práctica nadie
-- cambia; pero la migración tiene que ser correcta también para el perfil
-- que se cree mañana con el permiso quitado.
--
-- El mismo criterio está replicado en `getPermisos()` (lib/utils/permisos.ts)
-- para los perfiles que todavía no tengan la clave: así el orden entre el
-- despliegue del código y esta migración deja de importar. Con la clave ya
-- rellenada, esa rama de TypeScript no vuelve a tocar nada.
-- ══════════════════════════════════════════════════════════════

-- ─── 1. Rellenar la clave nueva heredando el valor de la vieja ──
--
-- Solo donde `permisos` no es NULL: un perfil sin permisos guardados usa
-- los valores por defecto de `tiene_permiso`, que se actualizan más abajo.
-- Y solo donde la clave nueva no existe ya, para que volver a ejecutar la
-- migración no pise una decisión posterior de un administrador.
UPDATE public.profiles
   SET permisos = permisos || jsonb_build_object(
         'anular_ticket',
         COALESCE((permisos ->> 'generar_ticket_manual')::BOOLEAN, TRUE)
       )
 WHERE permisos IS NOT NULL
   AND NOT (permisos ? 'anular_ticket');

-- ─── 2. El valor por defecto de tiene_permiso ───────────────────
--
-- Sin añadir la clave aquí, `tiene_permiso('anular_ticket')` devolvería
-- FALSE para cualquier perfil con `permisos` NULL: el `->>` no encuentra
-- la clave, da NULL, y el COALESCE lo convierte en FALSE. Falla cerrado,
-- que es lo correcto, pero dejaría sin poder anular a quien sí debe.
CREATE OR REPLACE FUNCTION public.tiene_permiso(p_permiso TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    CASE
      WHEN p.rol = 'admin' THEN TRUE
      ELSE COALESCE(
        ((COALESCE(p.permisos, '{
          "ver_webhooks": false,
          "ver_plantillas": false,
          "ver_logs": true,
          "ver_referencias": true,
          "ver_simulador": false,
          "ver_tiendas_referidas": false,
          "editar_clientes": true,
          "eliminar_cuentas": false,
          "registrar_pagos": true,
          "crear_cuentas": true,
          "ver_tickets": true,
          "generar_ticket_manual": true,
          "anular_ticket": true,
          "imprimir_ticket": true,
          "ver_sorteos": false,
          "realizar_sorteo": false
        }'::jsonb))->>p_permiso)::boolean,
        FALSE
      )
    END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- ─── 3. La policy de UPDATE de tickets ──────────────────────────
--
-- Es la única policy del esquema que usaba `generar_ticket_manual`, y
-- existe solo para anularTicket(): la emisión va por `emitir_ticket`
-- (SECURITY DEFINER, no pasa por RLS) y el incremento de envíos por
-- `incrementar_envio_ticket` (igual). Así que cambiarla a `anular_ticket`
-- no afecta a ningún otro flujo.
--
-- El WITH CHECK repite la condición del USING, igual que antes, para que
-- el agente no pueda aprovechar el mismo UPDATE para reasignar el boleto
-- (cambiando cliente_id) a un cliente que no es suyo.
DROP POLICY IF EXISTS "tickets: agente anula los de sus clientes" ON public.tickets;
CREATE POLICY "tickets: agente anula los de sus clientes"
  ON public.tickets FOR UPDATE
  USING (
    public.tiene_permiso('anular_ticket')
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  )
  WITH CHECK (
    public.tiene_permiso('anular_ticket')
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  );
