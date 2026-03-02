-- ══════════════════════════════════════════════════════════════
-- Migración: Agregar columna `permisos` a profiles
-- Ejecutar en: Supabase Studio → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Agregar columna permisos (JSONB, nullable — NULL = sin permisos extra)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS permisos jsonb DEFAULT NULL;

-- 2. Comentario para documentar la columna
COMMENT ON COLUMN profiles.permisos IS
'Permisos granulares para agentes. Solo aplica cuando rol=agente.
Estructura: { ver_webhooks, ver_plantillas, ver_logs, ver_referencias,
              ver_simulador, editar_clientes, eliminar_cuentas }
NULL = usar permisos por defecto (ver lib/types/index.ts DEFAULT_PERMISOS_AGENTE)';

-- 3. Verificar que se agregó correctamente
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'permisos';
