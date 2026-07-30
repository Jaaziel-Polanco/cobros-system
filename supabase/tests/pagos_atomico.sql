-- ══════════════════════════════════════════════════════════════
-- Verificación manual de registrar_pago_atomico v2
-- Ejecutar completo en Supabase Studio → SQL Editor.
-- Todo ocurre dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente UUID;
  v_deuda   UUID;
  v_res     JSONB;
  v_pagos   INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('PruebaPago', 'Temporal', '8090000000')
  RETURNING id INTO v_cliente;

  -- Caso 1: deuda con montos
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             cuota_mensual, fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 10000, 10000, 2000, CURRENT_DATE, 'mensual')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 2000, '2026-07', 'prueba', NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: el RPC debió devolver ok';
  ASSERT (v_res ->> 'pago_id') IS NOT NULL, 'Caso 1: debió devolver pago_id';
  ASSERT (v_res ->> 'nuevo_saldo')::NUMERIC = 8000, 'Caso 1: saldo debió bajar a 8000';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 1, 'Caso 1: debió crearse exactamente 1 fila en pagos';

  ASSERT (SELECT fecha_corte FROM public.deudas WHERE id = v_deuda)
         = CURRENT_DATE + INTERVAL '1 month',
         'Caso 1: fecha_corte debió avanzar un mes';

  -- Caso 2: deuda sin montos (marcar como pagado)
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 0, 0, CURRENT_DATE, 'semanal')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 0, '2026-07-29', NULL, NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 2: el RPC debió devolver ok con monto 0';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 1, 'Caso 2: debió crearse fila en pagos aunque el monto sea 0';

  ASSERT (SELECT fecha_corte FROM public.deudas WHERE id = v_deuda)
         = CURRENT_DATE + INTERVAL '7 days',
         'Caso 2: fecha_corte debió avanzar 7 días';

  -- Caso 3: pago que excede el saldo
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             cuota_mensual, fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 5000, 5000, 1000, CURRENT_DATE, 'mensual')
  RETURNING id INTO v_deuda;

  v_res := public.registrar_pago_atomico(v_deuda, 9999, '2026-07', NULL, NULL);

  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: debió rechazar el pago excesivo';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 0, 'Caso 3: no debió quedar fila de pago huérfana';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
