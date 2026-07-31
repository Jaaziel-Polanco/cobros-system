-- ══════════════════════════════════════════════════════════════
-- Migración: dos tipos de conexión para estaciones de impresión
--
-- Cambio de diseño posterior a la Tarea 5 (ver
-- docs/superpowers/plans/2026-07-29-boleteria-2-impresion.md): la
-- impresora no siempre es un dispositivo de red con IP propia. Cuando
-- va conectada directamente a la PC de la sucursal, el agente debe
-- imprimir por el spooler de Windows usando el nombre con el que la
-- impresora está instalada, no una IP.
--
-- Se agregan las dos rutas, elegidas por estación:
--   - 'red':     usa impresora_ip + impresora_port (topología existente).
--   - 'windows': usa impresora_nombre, tal como aparece en «Impresoras y
--                escáneres» de Windows.
--
-- impresora_ip pasa a ser opcional porque una estación 'windows' no la
-- tiene. Las filas existentes (todas de tipo 'red' hasta ahora) quedan
-- intactas: el DEFAULT 'red' preserva su comportamiento y su IP no se
-- toca.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.estaciones_impresion
  ADD COLUMN IF NOT EXISTS tipo_conexion TEXT NOT NULL DEFAULT 'red'
    CHECK (tipo_conexion IN ('red', 'windows'));

ALTER TABLE public.estaciones_impresion
  ADD COLUMN IF NOT EXISTS impresora_nombre TEXT;

ALTER TABLE public.estaciones_impresion
  ALTER COLUMN impresora_ip DROP NOT NULL;

COMMENT ON COLUMN public.estaciones_impresion.tipo_conexion IS
'Transporte que usa el agente local para imprimir: red (TCP a impresora_ip:impresora_port) o windows (spooler local por impresora_nombre).';

COMMENT ON COLUMN public.estaciones_impresion.impresora_nombre IS
'Nombre exacto de la impresora tal como está instalada en Windows (Impresoras y escáneres). Solo aplica a tipo_conexion = windows.';

-- ─── Coherencia entre tipo_conexion y los datos de conexión ────
-- La base impide una fila incoherente: una estación 'red' necesita IP,
-- una 'windows' necesita nombre. No basta con validarlo en la interfaz
-- ni en las Server Actions.
ALTER TABLE public.estaciones_impresion
  DROP CONSTRAINT IF EXISTS ck_estacion_datos_conexion;

ALTER TABLE public.estaciones_impresion
  ADD CONSTRAINT ck_estacion_datos_conexion
  CHECK (
    (tipo_conexion = 'red' AND impresora_ip IS NOT NULL)
    OR
    (tipo_conexion = 'windows' AND impresora_nombre IS NOT NULL)
  );
