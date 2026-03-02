-- ══════════════════════════════════════════════════════════════
-- Migración: Optimización de Índices (Rendimiento Cron)
-- Ejecutar en: Supabase Studio → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Índice para acelerar la consulta principal del Cron Job
-- El cron busca constantemente: eq('estado', 'activo').eq('pausado', false).neq('etapa', 'saldado')
CREATE INDEX IF NOT EXISTS idx_deudas_cron 
ON deudas(estado, pausado, etapa);

-- 2. Índice para filtrado de clientes inactivos en la UI (Tabla principal)
CREATE INDEX IF NOT EXISTS idx_clientes_activo 
ON clientes(activo);

-- 3. Índice mixto para acelerar la carga de "Cuentas" en la UI (Dashboard)
CREATE INDEX IF NOT EXISTS idx_deudas_cliente_estado 
ON deudas(cliente_id, estado);

COMMENT ON INDEX idx_deudas_cron IS
'Índice compuesto para optimizar masivamente el cron job diario, evitando Seq Scans al buscar deudas activas.';
