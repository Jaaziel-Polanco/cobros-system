-- ══════════════════════════════════════════════════════════════
-- Migración: valida ancho_cols y codepage en la base
--
-- lib/actions/estaciones.ts valida con cuidado la IP y el nombre de la
-- impresora, pero dejaba pasar cualquier valor de ancho_cols y codepage.
-- Reproducido en producción con datos ZZTEST_:
--   · ancho_cols = 0  → columnasEfectivas() divide por columnas 0 y
--     construirTirillaTicket() revienta con "Invalid array length" en
--     TODAS las impresiones de esa sucursal, no solo la de prueba.
--   · ancho_cols = 4  → el número del boleto (hasta 22 caracteres: ver
--     comentario de escribirNumeroBoleto() en lib/escpos/tirilla-ticket.ts)
--     no cabe ni a tamaño normal y sale recortado — rompe la invariante
--     de la Tarea 2 de que el número nunca se trunca.
--   · un codepage mal escrito cae en silencio a cp850 (selectorCodepage()
--     en lib/escpos/codificacion.ts tiene un `?? POR_DEFECTO`), así que
--     un typo no avisa a nadie hasta que alguien nota los acentos mal.
--
-- La validación en la Server Action (misma migración, ver
-- lib/actions/estaciones.ts) cubre la interfaz; este CHECK cubre
-- cualquier otra vía de escritura (SQL directo, un futuro script de
-- importación, un bug que se salte la Server Action).
--
-- Límite inferior de ancho_cols: 22, el máximo largo posible del número
-- de boleto (ver arriba) — por debajo de eso la invariante de "el número
-- nunca se trunca" ya no se puede sostener pase lo que pase en el resto
-- del código. Límite superior: 80, generoso para cualquier impresora
-- térmica real (58 mm ≈ 32 columnas, 80 mm ≈ 48 columnas en fuente
-- normal); nada de lo que existe hoy en las sucursales se acerca.
--
-- Los codepages válidos son exactamente las claves de CODEPAGES en
-- lib/escpos/codificacion.ts. Si ese archivo gana un codepage nuevo,
-- esta migración necesita una hermana que lo añada aquí también.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.estaciones_impresion
  DROP CONSTRAINT IF EXISTS ck_estacion_ancho_cols;

ALTER TABLE public.estaciones_impresion
  ADD CONSTRAINT ck_estacion_ancho_cols
  CHECK (ancho_cols BETWEEN 22 AND 80);

ALTER TABLE public.estaciones_impresion
  DROP CONSTRAINT IF EXISTS ck_estacion_codepage;

ALTER TABLE public.estaciones_impresion
  ADD CONSTRAINT ck_estacion_codepage
  CHECK (codepage IN ('cp437', 'cp850', 'cp858', 'cp1252'));

-- ══════════════════════════════════════════════════════════════
-- COMPROBACIÓN
--
--   INSERT INTO public.estaciones_impresion
--     (sucursal_id, nombre, token_hash, token_prefijo, impresora_ip, ancho_cols)
--   VALUES ('00000000-0000-0000-0000-000000000000', 'x', 'x', 'x', '1.1.1.1', 4);
--   -- debe fallar con ck_estacion_ancho_cols
--
--   INSERT INTO public.estaciones_impresion
--     (sucursal_id, nombre, token_hash, token_prefijo, impresora_ip, codepage)
--   VALUES ('00000000-0000-0000-0000-000000000000', 'x', 'x', 'x', '1.1.1.1', 'utf8');
--   -- debe fallar con ck_estacion_codepage
-- ══════════════════════════════════════════════════════════════
