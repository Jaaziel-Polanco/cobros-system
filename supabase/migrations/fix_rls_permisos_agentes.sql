-- ══════════════════════════════════════════════════════════════
-- Migración: Corregir RLS para respetar permisos granulares de agentes
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─── Helper: verificar si el usuario actual tiene un permiso ──
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
          "crear_cuentas": true
        }'::jsonb))->>p_permiso)::boolean,
        FALSE
      )
    END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ─── Alinear default de permisos en DB con el frontend ─────────
-- Si el agente no tiene `permisos` (NULL), asumimos el default del sistema.
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
    "crear_cuentas": true
  }'::jsonb;

UPDATE public.profiles
SET permisos = COALESCE(permisos, '{
  "ver_webhooks": false,
  "ver_plantillas": false,
  "ver_logs": true,
  "ver_referencias": true,
  "ver_simulador": false,
  "ver_tiendas_referidas": false,
  "editar_clientes": true,
  "eliminar_cuentas": false,
  "registrar_pagos": true,
  "crear_cuentas": true
}'::jsonb)
WHERE rol = 'agente' AND permisos IS NULL;


-- ══════════════════════════════════════════════════════════════
-- 1. CONFIGURACION_RECORDATORIO
--    Problema: solo admin podía INSERT → agentes con crear_cuentas bloqueados
-- ══════════════════════════════════════════════════════════════

-- Borrar policies anteriores
DROP POLICY IF EXISTS "config_rec: admin full access" ON public.configuracion_recordatorio;
DROP POLICY IF EXISTS "config_rec: agente ve sus configuraciones" ON public.configuracion_recordatorio;
DROP POLICY IF EXISTS "config_rec: select" ON public.configuracion_recordatorio;
DROP POLICY IF EXISTS "config_rec: insert" ON public.configuracion_recordatorio;
DROP POLICY IF EXISTS "config_rec: update" ON public.configuracion_recordatorio;
DROP POLICY IF EXISTS "config_rec: delete" ON public.configuracion_recordatorio;

-- SELECT: admin ve todo, agente ve las de sus deudas asignadas
CREATE POLICY "config_rec: select"
  ON public.configuracion_recordatorio FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.deudas d
      WHERE d.id = deuda_id AND d.agente_id = auth.uid()
    )
  );

-- INSERT: admin o agente con permiso crear_cuentas
CREATE POLICY "config_rec: insert"
  ON public.configuracion_recordatorio FOR INSERT
  WITH CHECK (
    public.tiene_permiso('crear_cuentas')
  );

-- UPDATE: admin o agente dueño de la deuda vinculada
CREATE POLICY "config_rec: update"
  ON public.configuracion_recordatorio FOR UPDATE
  USING (
    public.get_my_rol() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.deudas d
      WHERE d.id = deuda_id AND d.agente_id = auth.uid()
    )
  );

-- DELETE: solo admin
CREATE POLICY "config_rec: delete"
  ON public.configuracion_recordatorio FOR DELETE
  USING (public.get_my_rol() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 2. DEUDAS
--    Refinar: INSERT requiere crear_cuentas, UPDATE limitado al agente asignado
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "deudas: admin full access" ON public.deudas;
DROP POLICY IF EXISTS "deudas: agente ve sus deudas" ON public.deudas;
DROP POLICY IF EXISTS "deudas: agente puede crear/actualizar" ON public.deudas;
DROP POLICY IF EXISTS "deudas: agente actualiza sus deudas" ON public.deudas;
DROP POLICY IF EXISTS "deudas: select" ON public.deudas;
DROP POLICY IF EXISTS "deudas: insert" ON public.deudas;
DROP POLICY IF EXISTS "deudas: update" ON public.deudas;
DROP POLICY IF EXISTS "deudas: delete" ON public.deudas;

-- SELECT: admin ve todo, agente ve las que tiene asignadas
CREATE POLICY "deudas: select"
  ON public.deudas FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR agente_id = auth.uid()
  );

-- INSERT: admin o agente con permiso crear_cuentas
CREATE POLICY "deudas: insert"
  ON public.deudas FOR INSERT
  WITH CHECK (
    public.tiene_permiso('crear_cuentas')
  );

-- UPDATE: admin, o agente asignado a esa deuda
CREATE POLICY "deudas: update"
  ON public.deudas FOR UPDATE
  USING (
    public.get_my_rol() = 'admin'
    OR agente_id = auth.uid()
  );

-- DELETE: admin, o agente con permiso eliminar_cuentas y asignado a la deuda
CREATE POLICY "deudas: delete"
  ON public.deudas FOR DELETE
  USING (
    public.get_my_rol() = 'admin'
    OR (public.tiene_permiso('eliminar_cuentas') AND agente_id = auth.uid())
  );


-- ══════════════════════════════════════════════════════════════
-- 3. CLIENTES
--    Refinar: agente con editar_clientes puede UPDATE sus asignados
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "clientes: admin full access" ON public.clientes;
DROP POLICY IF EXISTS "clientes: agente ve sus asignados" ON public.clientes;
DROP POLICY IF EXISTS "clientes: agente puede crear" ON public.clientes;
DROP POLICY IF EXISTS "clientes: agente actualiza sus asignados" ON public.clientes;
DROP POLICY IF EXISTS "clientes: select" ON public.clientes;
DROP POLICY IF EXISTS "clientes: insert" ON public.clientes;
DROP POLICY IF EXISTS "clientes: update" ON public.clientes;
DROP POLICY IF EXISTS "clientes: delete" ON public.clientes;

-- SELECT: admin ve todo, agente ve sus asignados
CREATE POLICY "clientes: select"
  ON public.clientes FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR agente_id = auth.uid()
  );

-- INSERT: admin o cualquier agente autenticado (crear clientes)
CREATE POLICY "clientes: insert"
  ON public.clientes FOR INSERT
  WITH CHECK (
    public.get_my_rol() IN ('admin', 'agente')
  );

-- UPDATE: admin, o agente con editar_clientes y asignado al cliente
CREATE POLICY "clientes: update"
  ON public.clientes FOR UPDATE
  USING (
    public.get_my_rol() = 'admin'
    OR (public.tiene_permiso('editar_clientes') AND agente_id = auth.uid())
  );

-- DELETE: solo admin
CREATE POLICY "clientes: delete"
  ON public.clientes FOR DELETE
  USING (public.get_my_rol() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 4. PAGOS
--    Agente con registrar_pagos puede insertar pagos de sus deudas
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "pagos: admin full access" ON public.pagos;
DROP POLICY IF EXISTS "pagos: agente ve pagos de sus deudas" ON public.pagos;
DROP POLICY IF EXISTS "pagos: agente puede insertar" ON public.pagos;
DROP POLICY IF EXISTS "pagos: select" ON public.pagos;
DROP POLICY IF EXISTS "pagos: insert" ON public.pagos;
DROP POLICY IF EXISTS "pagos: update" ON public.pagos;
DROP POLICY IF EXISTS "pagos: delete" ON public.pagos;

-- SELECT: admin ve todo, agente ve pagos de sus deudas
CREATE POLICY "pagos: select"
  ON public.pagos FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.deudas d
      WHERE d.id = deuda_id AND d.agente_id = auth.uid()
    )
  );

-- INSERT: admin, o agente con registrar_pagos
CREATE POLICY "pagos: insert"
  ON public.pagos FOR INSERT
  WITH CHECK (
    public.tiene_permiso('registrar_pagos')
  );

-- UPDATE/DELETE: solo admin
CREATE POLICY "pagos: update"
  ON public.pagos FOR UPDATE
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "pagos: delete"
  ON public.pagos FOR DELETE
  USING (public.get_my_rol() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 5. ENVIOS_LOG
--    Agente puede insertar logs de envío para sus deudas
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "envios_log: admin full access" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: agente ve sus envíos" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: agente puede insertar" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: select" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: insert" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: update" ON public.envios_log;
DROP POLICY IF EXISTS "envios_log: delete" ON public.envios_log;

-- SELECT: admin ve todo, agente ve los de sus deudas
CREATE POLICY "envios_log: select"
  ON public.envios_log FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR agente_id = auth.uid()
  );

-- INSERT: admin o agente autenticado
CREATE POLICY "envios_log: insert"
  ON public.envios_log FOR INSERT
  WITH CHECK (
    public.get_my_rol() IN ('admin', 'agente')
  );

-- UPDATE/DELETE: solo admin
CREATE POLICY "envios_log: update"
  ON public.envios_log FOR UPDATE
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "envios_log: delete"
  ON public.envios_log FOR DELETE
  USING (public.get_my_rol() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 6. REFERENCIAS_CLIENTE
--    Agente con ver_referencias puede gestionar refs de sus clientes
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "referencias: admin full access" ON public.referencias_cliente;
DROP POLICY IF EXISTS "referencias: agente ve y gestiona sus clientes" ON public.referencias_cliente;
DROP POLICY IF EXISTS "referencias: select" ON public.referencias_cliente;
DROP POLICY IF EXISTS "referencias: insert" ON public.referencias_cliente;
DROP POLICY IF EXISTS "referencias: update" ON public.referencias_cliente;
DROP POLICY IF EXISTS "referencias: delete" ON public.referencias_cliente;

-- SELECT: admin o agente del cliente
CREATE POLICY "referencias: select"
  ON public.referencias_cliente FOR SELECT
  USING (
    public.get_my_rol() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  );

-- INSERT: admin, o agente con ver_referencias
CREATE POLICY "referencias: insert"
  ON public.referencias_cliente FOR INSERT
  WITH CHECK (
    public.tiene_permiso('ver_referencias')
  );

-- UPDATE: admin, o agente del cliente vinculado
CREATE POLICY "referencias: update"
  ON public.referencias_cliente FOR UPDATE
  USING (
    public.get_my_rol() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = cliente_id AND c.agente_id = auth.uid()
    )
  );

-- DELETE: solo admin
CREATE POLICY "referencias: delete"
  ON public.referencias_cliente FOR DELETE
  USING (public.get_my_rol() = 'admin');


-- ══════════════════════════════════════════════════════════════
-- 7. PLANTILLAS_MENSAJE (sin cambios sustanciales)
-- ══════════════════════════════════════════════════════════════

-- Mantener: admin full, agente solo lectura (ya existentes, no tocar)


-- ══════════════════════════════════════════════════════════════
-- 8. WEBHOOKS (sin cambios sustanciales)
-- ══════════════════════════════════════════════════════════════

-- Mantener: admin full (ya existente, no tocar)


-- ══════════════════════════════════════════════════════════════
-- FIN DE MIGRACIÓN
-- ══════════════════════════════════════════════════════════════
