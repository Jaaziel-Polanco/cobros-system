-- ══════════════════════════════════════════════════════════════
-- Verificación manual de la cola de impresión
-- Todo dentro de una transacción que termina en ROLLBACK.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_sucursal UUID;
  v_estacion UUID;
  v_cliente  UUID;
  v_ticket   UUID;
  v_job1     UUID;
  v_job2     UUID;
  v_conteo   INTEGER;
BEGIN
  INSERT INTO public.sucursales (nombre) VALUES ('Sucursal Prueba')
  RETURNING id INTO v_sucursal;

  INSERT INTO public.estaciones_impresion
    (sucursal_id, nombre, token_hash, token_prefijo, impresora_ip)
  VALUES (v_sucursal, 'Caja Prueba', 'hash-falso', 'abcd1234', '10.0.0.99')
  RETURNING id INTO v_estacion;

  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('PruebaCola', 'Temporal', '8090000000')
  RETURNING id INTO v_cliente;

  INSERT INTO public.tickets
    (numero, numero_formateado, cliente_id, origen, token_publico, snapshot)
  VALUES (1, 'TST-COLA-01', v_cliente, 'manual', 'tok-prueba-cola', '{}'::jsonb)
  RETURNING id INTO v_ticket;

  INSERT INTO public.print_jobs (ticket_id, sucursal_id, payload_escpos)
  VALUES (v_ticket, v_sucursal, 'AAAA') RETURNING id INTO v_job1;

  INSERT INTO public.print_jobs (ticket_id, sucursal_id, payload_escpos)
  VALUES (v_ticket, v_sucursal, 'BBBB') RETURNING id INTO v_job2;

  -- Caso 1: reclamar devuelve los pendientes y los marca
  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 2, 'Caso 1: debió reclamar los 2 trabajos pendientes';

  SELECT count(*) INTO v_conteo
  FROM public.print_jobs
  WHERE sucursal_id = v_sucursal AND estado = 'reclamado' AND intentos = 1;
  ASSERT v_conteo = 2, 'Caso 1: ambos debieron quedar reclamados con 1 intento';

  -- Caso 2: reclamar de nuevo no devuelve nada (no hay pendientes)
  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 0, 'Caso 2: no debió reclamar trabajos ya reclamados';

  -- Caso 3: un trabajo colgado hace más de 90 s vuelve a la cola
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes'
   WHERE id = v_job1;

  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 1, 'Caso 3: debió recuperar el trabajo colgado';

  SELECT intentos INTO v_conteo FROM public.print_jobs WHERE id = v_job1;
  ASSERT v_conteo = 2, 'Caso 3: el reintento debió incrementar el contador';

  -- Caso 4: agotados los intentos, el colgado pasa a error y no se reintenta
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes', intentos = 3
   WHERE id = v_job1;

  PERFORM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);

  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job1) = 'error',
         'Caso 4: agotados los intentos el trabajo debe quedar en error';

  -- Caso 5: la purga limpia el payload de los impresos antiguos
  UPDATE public.print_jobs
     SET estado = 'impreso', impreso_at = NOW() - INTERVAL '30 days'
   WHERE id = v_job2;

  SELECT public.purgar_payloads_impresos(7) INTO v_conteo;
  ASSERT v_conteo >= 1, 'Caso 5: debió purgar al menos un payload';
  ASSERT (SELECT payload_escpos FROM public.print_jobs WHERE id = v_job2) IS NULL,
         'Caso 5: el payload debió quedar en NULL';
  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job2) = 'impreso',
         'Caso 5: la fila se conserva para auditoría';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
