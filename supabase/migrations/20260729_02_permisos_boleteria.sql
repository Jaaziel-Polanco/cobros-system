-- ══════════════════════════════════════════════════════════════
-- Migración: Permisos de boletería, helper SQL y policies RLS
-- ══════════════════════════════════════════════════════════════

-- ─── Helper: consultar un permiso granular ────────────────────
CREATE OR REPLACE FUNCTION public.tiene_permiso(p_permiso TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT rol = 'admin' OR COALESCE((permisos ->> p_permiso)::BOOLEAN, FALSE)
       FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

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
CREATE POLICY "sucursales: lectura autenticados"
  ON public.sucursales FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "sucursales: escritura admin"
  ON public.sucursales FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: estaciones_impresion ───────────────────────────
CREATE POLICY "estaciones: lectura autenticados"
  ON public.estaciones_impresion FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "estaciones: escritura admin"
  ON public.estaciones_impresion FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: configuracion_ticket ───────────────────────────
CREATE POLICY "config_ticket: lectura autenticados"
  ON public.configuracion_ticket FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "config_ticket: escritura admin"
  ON public.configuracion_ticket FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- ─── Policies: sorteos ────────────────────────────────────────
CREATE POLICY "sorteos: lectura con permiso"
  ON public.sorteos FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteos: escritura con permiso"
  ON public.sorteos FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

-- ─── Policies: tickets ────────────────────────────────────────
-- Mismo criterio de visibilidad que `pagos`: el agente ve los boletos de los
-- clientes que tiene asignados.
CREATE POLICY "tickets: admin acceso total"
  ON public.tickets FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

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
CREATE POLICY "ticket_eventos: admin acceso total"
  ON public.ticket_eventos FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "ticket_eventos: sigue la visibilidad del boleto"
  ON public.ticket_eventos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.clientes c ON c.id = t.cliente_id
      WHERE t.id = ticket_id AND c.agente_id = auth.uid()
    )
  );

-- ─── Policies: print_jobs ─────────────────────────────────────
-- El ciclo de vida (reclamo, ack, reintentos) lo maneja la API /api/print/*
-- con el cliente admin. Las sesiones de usuario solo encolan y leen.
CREATE POLICY "print_jobs: admin acceso total"
  ON public.print_jobs FOR ALL
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "print_jobs: encolar con permiso"
  ON public.print_jobs FOR INSERT
  WITH CHECK (public.tiene_permiso('imprimir_ticket'));

CREATE POLICY "print_jobs: ver los propios"
  ON public.print_jobs FOR SELECT
  USING (solicitado_por = auth.uid());

-- ─── Policies: sorteo_ejecuciones / participantes / ganadores ─
CREATE POLICY "sorteo_ejecuciones: lectura con permiso"
  ON public.sorteo_ejecuciones FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_ejecuciones: escritura con permiso"
  ON public.sorteo_ejecuciones FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

CREATE POLICY "sorteo_participantes: lectura con permiso"
  ON public.sorteo_participantes FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_participantes: escritura con permiso"
  ON public.sorteo_participantes FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));

CREATE POLICY "sorteo_ganadores: lectura con permiso"
  ON public.sorteo_ganadores FOR SELECT
  USING (public.tiene_permiso('ver_sorteos'));

CREATE POLICY "sorteo_ganadores: escritura con permiso"
  ON public.sorteo_ganadores FOR ALL
  USING (public.tiene_permiso('realizar_sorteo'))
  WITH CHECK (public.tiene_permiso('realizar_sorteo'));
