-- ══════════════════════════════════════════════════════════════
-- Verificación manual de registrar_pago_atomico v2
-- Ejecutar completo en Supabase Studio → SQL Editor.
-- Todo ocurre dentro de una transacción que termina en ROLLBACK.
--
-- 4 casos: pago con montos (1), marcar pagado sin montos (2), pago que
-- excede el saldo (3), y marcar período pagado en una deuda CON montos
-- pero SIN cuota_mensual usando p_avanzar_sin_monto (4) — este último
-- cubre la regresión encontrada en revisión: el botón "Pagó" del panel
-- de pendientes fallaba el 100% de las veces para ese tipo de cuenta.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente UUID;
  v_deuda   UUID;
  v_res     JSONB;
  v_pagos   INTEGER;
  v_pago    public.pagos%ROWTYPE;
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

  -- Contenido de la fila insertada, no solo su existencia: un bug que
  -- insertara monto = saldo_pendiente (u otro valor) en vez de
  -- p_monto_pago pasaría inadvertido si solo contamos filas.
  SELECT * INTO v_pago FROM public.pagos WHERE deuda_id = v_deuda LIMIT 1;
  ASSERT v_pago.id = (v_res ->> 'pago_id')::UUID,
         'Caso 1: el id de la fila insertada debió coincidir con pago_id devuelto';
  ASSERT v_pago.monto = 2000,
         'Caso 1: el monto insertado debió ser p_monto_pago (2000), no el saldo u otro valor';
  ASSERT v_pago.cliente_id = v_cliente,
         'Caso 1: cliente_id insertado debió ser el de la deuda';
  ASSERT v_pago.periodo = '2026-07',
         'Caso 1: periodo insertado debió ser el que se pasó (2026-07)';
  ASSERT v_pago.nota = 'prueba',
         'Caso 1: nota insertada debió ser la que se pasó (prueba)';

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

  -- Caso 4: marcar período pagado en deuda CON montos pero SIN cuota_mensual
  -- (pago único, deuda-form.tsx lo permite explícitamente). Regresión real
  -- encontrada en revisión: el botón "Pagó" del panel de pendientes llamaba
  -- a marcarPagoPeriodo(), que sin la bandera pasaba monto 0 y el RPC lo
  -- rechazaba siempre. p_avanzar_sin_monto corrige esto.
  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente,
                             fecha_corte, frecuencia_pago)
  VALUES (v_cliente, 7000, 7000, CURRENT_DATE, 'quincenal')
  RETURNING id INTO v_deuda;

  -- Sin la bandera: debe comportarse como un pago normal y rechazar monto 0.
  v_res := public.registrar_pago_atomico(v_deuda, 0, '2026-07-29', NULL, NULL, FALSE);

  ASSERT NOT (v_res ->> 'ok')::BOOLEAN,
         'Caso 4: sin p_avanzar_sin_monto, un pago de 0 sobre deuda con monto debió rechazarse';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 0, 'Caso 4: la llamada rechazada no debió dejar fila en pagos';

  -- Con la bandera: debe aceptar, avanzar fecha_corte y NO tocar el saldo.
  v_res := public.registrar_pago_atomico(v_deuda, 0, '2026-07-29', NULL, NULL, TRUE);

  ASSERT (v_res ->> 'ok')::BOOLEAN,
         'Caso 4: con p_avanzar_sin_monto, debió aceptar el pago de 0';

  SELECT count(*) INTO v_pagos FROM public.pagos WHERE deuda_id = v_deuda;
  ASSERT v_pagos = 1, 'Caso 4: debió crearse la fila en pagos aunque el monto sea 0';

  ASSERT (SELECT saldo_pendiente FROM public.deudas WHERE id = v_deuda) = 7000,
         'Caso 4: el saldo no debió cambiar (marcar período pagado no mueve dinero)';

  ASSERT (SELECT fecha_corte FROM public.deudas WHERE id = v_deuda)
         = CURRENT_DATE + INTERVAL '15 days',
         'Caso 4: fecha_corte debió avanzar 15 días (frecuencia quincenal)';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
