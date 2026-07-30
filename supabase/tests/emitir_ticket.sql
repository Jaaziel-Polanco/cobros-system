-- ══════════════════════════════════════════════════════════════
-- Verificación manual de emitir_ticket
-- Todo dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente  UUID;
  v_deuda    UUID;
  v_pago     UUID;
  v_sorteo   UUID;
  v_res      JSONB;
  v_res2     JSONB;
  v_tickets  INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono, dni_ruc)
  VALUES ('PruebaBoleto', 'Muñoz', '8091112222', '001-1234567-8')
  RETURNING id INTO v_cliente;

  INSERT INTO public.deudas (cliente_id, monto_original, saldo_pendiente, fecha_corte)
  VALUES (v_cliente, 0, 0, CURRENT_DATE)
  RETURNING id INTO v_deuda;

  INSERT INTO public.pagos (deuda_id, cliente_id, monto, periodo)
  VALUES (v_deuda, v_cliente, 0, '2026-07-29')
  RETURNING id INTO v_pago;

  -- Caso 1: sin sorteo activo → boleto huérfano con infijo -SN-
  v_res := public.emitir_ticket(v_cliente, v_pago, v_deuda, 'automatico', NULL, NULL);

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: debió emitir';
  ASSERT NOT (v_res ->> 'ya_existia')::BOOLEAN, 'Caso 1: no debía existir antes';
  ASSERT (v_res -> 'ticket' ->> 'numero_formateado') LIKE '%-SN-%',
         'Caso 1: sin sorteo activo el número lleva el infijo -SN-';
  ASSERT (v_res -> 'ticket' ->> 'sorteo_id') IS NULL, 'Caso 1: sorteo_id debe ser NULL';
  ASSERT length(v_res -> 'ticket' ->> 'token_publico') >= 40,
         'Caso 1: el token público debe ser largo';
  ASSERT (v_res -> 'ticket' -> 'snapshot' -> 'cliente' ->> 'apellido') = 'Muñoz',
         'Caso 1: el snapshot debe conservar el apellido con eñe';

  -- Caso 2: idempotencia — el mismo pago devuelve el mismo boleto
  v_res2 := public.emitir_ticket(v_cliente, v_pago, v_deuda, 'automatico', NULL, NULL);

  ASSERT (v_res2 ->> 'ya_existia')::BOOLEAN, 'Caso 2: debió reconocer el boleto existente';
  ASSERT (v_res2 -> 'ticket' ->> 'id') = (v_res -> 'ticket' ->> 'id'),
         'Caso 2: debió devolver el mismo boleto';

  SELECT count(*) INTO v_tickets FROM public.tickets WHERE pago_id = v_pago;
  ASSERT v_tickets = 1, 'Caso 2: no debió duplicarse el boleto';

  -- Caso 3: boleto manual sin motivo → rechazado
  v_res := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', NULL, NULL);
  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: el motivo es obligatorio en manual';

  -- Caso 4: con sorteo activo → numeración correlativa con el prefijo del sorteo
  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('Sorteo de prueba', CURRENT_DATE, CURRENT_DATE + 30, 'activo', 'TSTPRU')
  RETURNING id INTO v_sorteo;

  v_res  := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', 'Promoción', NULL);
  v_res2 := public.emitir_ticket(v_cliente, NULL, NULL, 'manual', 'Promoción', NULL);

  ASSERT (v_res  -> 'ticket' ->> 'numero_formateado') = 'TSTPRU-000001',
         'Caso 4: el primer boleto del sorteo debe ser 000001';
  ASSERT (v_res2 -> 'ticket' ->> 'numero_formateado') = 'TSTPRU-000002',
         'Caso 4: el segundo debe ser 000002';
  ASSERT (v_res -> 'ticket' -> 'snapshot' -> 'sorteo' ->> 'nombre') = 'Sorteo de prueba',
         'Caso 4: el snapshot debe incluir el sorteo';

  -- Caso 5: cada emisión registra su evento
  SELECT count(*) INTO v_tickets
  FROM public.ticket_eventos WHERE tipo = 'emitido';
  ASSERT v_tickets = 4, 'Caso 5: debieron registrarse 4 eventos de emisión';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
