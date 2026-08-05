-- ══════════════════════════════════════════════════════════════
-- Migración: separar los webhooks de cobranza y de boletos
--
-- Sin esta separación, el `.maybeSingle()` de lib/actions/envios.ts
-- lanzaría "multiple rows returned" en cuanto exista un segundo webhook
-- activo, dejando la cobranza sin enviar. (Defecto L1 del diseño.)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.webhooks
  ADD COLUMN IF NOT EXISTS evento TEXT NOT NULL DEFAULT 'cobranza'
  CHECK (evento IN ('cobranza','ticket'));

COMMENT ON COLUMN public.webhooks.evento IS
'Flujo al que pertenece el webhook. cobranza = recordatorios de deuda; ticket = envío de boletos.';

CREATE INDEX IF NOT EXISTS idx_webhooks_evento_activo
  ON public.webhooks(evento) WHERE activo;

-- ─── Permitir la etapa 'ticket' en las plantillas ─────────────
ALTER TABLE public.plantillas_mensaje
  DROP CONSTRAINT IF EXISTS plantillas_mensaje_etapa_check;

ALTER TABLE public.plantillas_mensaje
  ADD CONSTRAINT plantillas_mensaje_etapa_check
  CHECK (etapa IN ('preventivo','mora_temprana','mora_alta',
                   'recuperacion','referencia','ticket'));

-- ─── Plantilla por defecto del boleto ─────────────────────────
INSERT INTO public.plantillas_mensaje (nombre, etapa, contenido)
SELECT
  'Boleto de Sorteo',
  'ticket',
  '¡Gracias {{nombre}}! 🎟️' || chr(10) || chr(10) ||
  'Tu boleto para *{{sorteo}}* es el número *{{ticket_numero}}*.' || chr(10) ||
  'Emitido el {{fecha}}.' || chr(10) || chr(10) ||
  'Guarda este comprobante. Consulta los términos y condiciones aquí: {{url_terminos}}' || chr(10) ||
  '— Inversiones Cordero'
WHERE NOT EXISTS (
  SELECT 1 FROM public.plantillas_mensaje WHERE etapa = 'ticket'
);
