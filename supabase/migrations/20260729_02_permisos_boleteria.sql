-- ══════════════════════════════════════════════════════════════
-- Migración: Permisos de boletería, helper SQL y policies RLS
-- ══════════════════════════════════════════════════════════════

-- ─── Helper: consultar un permiso granular ────────────────────
-- NOTA: Reemplaza la función anterior para incluir los 5 permisos nuevos
-- del módulo de boletería. El JSONB de fallback contiene todos los
-- 15 permisos: cuando profiles.permisos es NULL (agentes creados antes de
-- esta migración o por lib/actions/usuarios.ts), se heredan estos valores
-- por defecto. Esto evita que agentes nuevos queden bloqueados por RLS
-- mientras getPermisos() en TypeScript los autoriza.
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
          "imprimir_ticket": true,
          "ver_sorteos": false,
          "realizar_sorteo": false
        }'::jsonb))->>p_permiso)::boolean,
        FALSE
      )
    END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- ─── Alinear default de permisos en DB con el frontend ─────────
-- Si el agente no tiene `permisos` (NULL), asumimos el default del
-- sistema con todos los 15 permisos. Esto garantiza que agentes creados
-- por lib/actions/usuarios.ts hereden los mismos valores que getPermisos()
-- les daría en TypeScript.
ALTER TABLE public.profiles
  ALTER COLUMN permisos SET DEFAULT '{
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
    "imprimir_ticket": true,
    "ver_sorteos": false,
    "realizar_sorteo": false
  }'::jsonb;

-- ─── Rellenar los permisos nuevos en los perfiles existentes ──
-- Los agentes que ya tienen objeto de permisos reciben los defaults del
-- módulo de boletos; sin esto, las policies los bloquearían aunque la capa
-- de aplicación (getPermisos) sí se los conceda.
UPDATE public.profiles
SET permisos = COALESCE(permisos, '{}'::jsonb) || jsonb_build_object(
      'ver_tickets',           COALESCE((permisos ->> 'ver_tickets')::BOOLEAN, TRUE),
      'generar_ticket_manual', COALESCE((permisos ->> 'generar_ticket_manual')::BOOLEAN, TRUE),
      'imprimir_ticket',       COALESCE((permisos ->> 'imprimir_ticket')::BOOLEAN, TRUE),
      'ver_sorteos',           COALESCE((permisos ->> 'ver_sorteos')::BOOLEAN, FALSE),
      'realizar_sorteo',       COALESCE((permisos ->> 'realizar_sorteo')::BOOLEAN, FALSE)
    )
WHERE rol = 'agente';

-- ─── Policies: sucursales ─────────────────────────────────────
DROP POLICY IF EXISTS "sucursales: lectura autenticados" ON public.sucursales;
CREATE POLICY "sucursales: lectura autenticados"
  ON public.sucursales FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "sucursales: escritura admin" ON public.sucursales;
CREATE POLICY "sucursales: escritura admin"
  ON public.sucursales FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: estaciones_impresion ───────────────────────────
DROP POLICY IF EXISTS "estaciones: lectura autenticados" ON public.estaciones_impresion;
CREATE POLICY "estaciones: lectura autenticados"
  ON public.estaciones_impresion FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "estaciones: escritura admin" ON public.estaciones_impresion;
CREATE POLICY "estaciones: escritura admin"
  ON public.estaciones_impresion FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: configuracion_ticket ───────────────────────────
DROP POLICY IF EXISTS "config_ticket: lectura autenticados" ON public.configuracion_ticket;
CREATE POLICY "config_ticket: lectura autenticados"
  ON public.configuracion_ticket FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "config_ticket: escritura admin" ON public.configuracion_ticket;
CREATE POLICY "config_ticket: escritura admin"
  ON public.configuracion_ticket FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: sorteos ────────────────────────────────────────
DROP POLICY IF EXISTS "sorteos: lectura con permiso" ON public.sorteos;
CREATE POLICY "sorteos: lectura con permiso"
  ON public.sorteos FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

DROP POLICY IF EXISTS "sorteos: escritura con permiso" ON public.sorteos;
CREATE POLICY "sorteos: escritura con permiso"
  ON public.sorteos FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

-- ─── Policies: tickets ────────────────────────────────────────
-- Los boletos pueden ser manuales (sin deuda) o ligados a una deuda.
-- El criterio de visibilidad es: admin ve todo, agente ve boletos de
-- sus clientes asignados (sin filtro por deuda, porque boletos manuales
-- no la tienen).
DROP POLICY IF EXISTS "tickets: admin acceso total" ON public.tickets;
CREATE POLICY "tickets: admin acceso total"
  ON public.tickets FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

DROP POLICY IF EXISTS "tickets: agente ve los de sus clientes" ON public.tickets;
CREATE POLICY "tickets: agente ve los de sus clientes"
  ON public.tickets FOR SELECT
  USING (
    public.tiene_permiso('ver_tickets')
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  );

-- ─── Policies: ticket_eventos ─────────────────────────────────
-- El historial de eventos sigue la visibilidad del boleto: solo visible
-- si el agente tiene permiso ver_tickets Y el boleto pertenece a sus clientes.
DROP POLICY IF EXISTS "ticket_eventos: admin acceso total" ON public.ticket_eventos;
CREATE POLICY "ticket_eventos: admin acceso total"
  ON public.ticket_eventos FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

DROP POLICY IF EXISTS "ticket_eventos: sigue la visibilidad del boleto" ON public.ticket_eventos;
CREATE POLICY "ticket_eventos: sigue la visibilidad del boleto"
  ON public.ticket_eventos FOR SELECT
  USING (
    public.tiene_permiso('ver_tickets')
    AND EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.clientes c ON c.id = t.cliente_id
      WHERE t.id = ticket_id AND c.agente_id = auth.uid()
    )
  );

-- ─── Policies: print_jobs ─────────────────────────────────────
-- El ciclo de vida (reclamo, ack, reintentos) lo maneja la API /api/print/*
-- con el cliente admin. Las sesiones de usuario solo encolan y leen.
DROP POLICY IF EXISTS "print_jobs: admin acceso total" ON public.print_jobs;
CREATE POLICY "print_jobs: admin acceso total"
  ON public.print_jobs FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

DROP POLICY IF EXISTS "print_jobs: encolar con permiso" ON public.print_jobs;
CREATE POLICY "print_jobs: encolar con permiso"
  ON public.print_jobs FOR INSERT
  WITH CHECK (public.tiene_permiso('imprimir_ticket'));

DROP POLICY IF EXISTS "print_jobs: ver los propios" ON public.print_jobs;
CREATE POLICY "print_jobs: ver los propios"
  ON public.print_jobs FOR SELECT
  USING (solicitado_por = auth.uid());

-- ─── Policies: sorteo_ejecuciones ────────────────────────────
DROP POLICY IF EXISTS "sorteo_ejecuciones: lectura con permiso" ON public.sorteo_ejecuciones;
CREATE POLICY "sorteo_ejecuciones: lectura con permiso"
  ON public.sorteo_ejecuciones FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

DROP POLICY IF EXISTS "sorteo_ejecuciones: escritura con permiso" ON public.sorteo_ejecuciones;
CREATE POLICY "sorteo_ejecuciones: escritura con permiso"
  ON public.sorteo_ejecuciones FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

-- ─── Policies: sorteo_participantes ──────────────────────────
DROP POLICY IF EXISTS "sorteo_participantes: lectura con permiso" ON public.sorteo_participantes;
CREATE POLICY "sorteo_participantes: lectura con permiso"
  ON public.sorteo_participantes FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

DROP POLICY IF EXISTS "sorteo_participantes: escritura con permiso" ON public.sorteo_participantes;
CREATE POLICY "sorteo_participantes: escritura con permiso"
  ON public.sorteo_participantes FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

-- ─── Policies: sorteo_ganadores ─────────────────────────────
DROP POLICY IF EXISTS "sorteo_ganadores: lectura con permiso" ON public.sorteo_ganadores;
CREATE POLICY "sorteo_ganadores: lectura con permiso"
  ON public.sorteo_ganadores FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

DROP POLICY IF EXISTS "sorteo_ganadores: escritura con permiso" ON public.sorteo_ganadores;
CREATE POLICY "sorteo_ganadores: escritura con permiso"
  ON public.sorteo_ganadores FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));
