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

  -- Caso 3: un trabajo colgado hace más de 90 s vuelve a la cola, y deja
  -- rastro en ticket_eventos (Importante 4 de la revisión del Plan 2: un
  -- 401 en el ack de éxito, p. ej. token regenerado, deja el trabajo
  -- 'reclamado' sin confirmar; cuando el servidor lo recupera pasados
  -- 90 s, si se reentrega y se reimprime, el papel sale sin marca COPIA
  -- porque veces_impreso nunca se incrementó. El evento en el historial
  -- del cliente es lo único que avisa de eso antes de que alguien
  -- reimprima a ciegas).
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes'
   WHERE id = v_job1;

  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);
  ASSERT v_conteo = 1, 'Caso 3: debió recuperar el trabajo colgado';

  SELECT intentos INTO v_conteo FROM public.print_jobs WHERE id = v_job1;
  ASSERT v_conteo = 2, 'Caso 3: el reintento debió incrementar el contador';

  SELECT count(*) INTO v_conteo
  FROM public.ticket_eventos
  WHERE ticket_id = v_ticket AND tipo = 'impreso' AND estado = 'error';
  ASSERT v_conteo = 1, 'Caso 3: la recuperación debió dejar un evento en el historial del boleto';

  -- Caso 4: agotados los intentos, el colgado pasa a error y no se reintenta
  UPDATE public.print_jobs
     SET claimed_at = NOW() - INTERVAL '2 minutes', intentos = 3
   WHERE id = v_job1;

  PERFORM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);

  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job1) = 'error',
         'Caso 4: agotados los intentos el trabajo debe quedar en error';

  SELECT count(*) INTO v_conteo
  FROM public.ticket_eventos
  WHERE ticket_id = v_ticket AND tipo = 'impreso' AND estado = 'error';
  ASSERT v_conteo = 2, 'Caso 4: la recuperación por intentos agotados debió sumar otro evento';

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

  -- Caso 6: un ack duplicado o tardío no debe reimprimir un boleto que ya
  -- salió. v_job2 ya quedó en 'impreso' en el Caso 5. app/api/print/ack/
  -- route.ts condiciona su UPDATE a `estado = 'reclamado'`: reproducimos
  -- exactamente esa guarda aquí. Si dos confirmaciones se cruzan (un
  -- reintento de red, un agente que se reconecta y reenvía su cola
  -- pendiente), la segunda ya no encuentra el trabajo en 'reclamado' y no
  -- debe mutar nada -- ni siquiera si trae {ok:false}.
  UPDATE public.print_jobs
     SET estado        = 'pendiente',
         estacion_id   = NULL,
         claimed_at    = NULL,
         error_mensaje = 'ack duplicado simulado'
   WHERE id = v_job2
     AND estado = 'reclamado';

  ASSERT (SELECT estado FROM public.print_jobs WHERE id = v_job2) = 'impreso',
         'Caso 6: un ack duplicado con ok:false no debe sacar el trabajo de impreso';

  -- Y por lo tanto un poll posterior no debe volver a entregarlo: solo
  -- reclama trabajos en 'pendiente', y v_job2 sigue en 'impreso'.
  SELECT count(*) INTO v_conteo
  FROM public.reclamar_print_jobs(v_estacion, v_sucursal, 10)
  WHERE id = v_job2;
  ASSERT v_conteo = 0, 'Caso 6: un boleto ya impreso no debe reentregarse por poll';

  -- Caso 7: un trabajo de prueba (CRÍTICO de la revisión del Plan 2) no
  -- toca ningún boleto real. Requiere 20260730_07_print_jobs_prueba.sql
  -- (ticket_id nullable + es_prueba + ck_print_jobs_prueba_sin_ticket).
  DECLARE
    v_ticket_impresiones_antes INTEGER;
    v_ticket_impresiones_despues INTEGER;
    v_job_prueba_1 UUID;
    v_job_prueba_2 UUID;
  BEGIN
    SELECT veces_impreso INTO v_ticket_impresiones_antes
    FROM public.tickets WHERE id = v_ticket;

    INSERT INTO public.print_jobs (ticket_id, es_prueba, sucursal_id, payload_escpos)
    VALUES (NULL, TRUE, v_sucursal, 'PRUEBA-1') RETURNING id INTO v_job_prueba_1;

    -- Dos pruebas simultáneas para la MISMA sucursal no deben chocar entre
    -- sí: uq_print_jobs_ticket_en_vuelo es sobre (ticket_id), y en
    -- PostgreSQL ningún NULL es igual a otro NULL a efectos de un índice
    -- único, así que ambas filas con ticket_id NULL conviven sin problema.
    INSERT INTO public.print_jobs (ticket_id, es_prueba, sucursal_id, payload_escpos)
    VALUES (NULL, TRUE, v_sucursal, 'PRUEBA-2') RETURNING id INTO v_job_prueba_2;

    -- No se puede insertar un trabajo de prueba con ticket_id, ni un
    -- trabajo "real" sin ticket_id: ck_print_jobs_prueba_sin_ticket lo
    -- impide en los dos sentidos.
    BEGIN
      INSERT INTO public.print_jobs (ticket_id, es_prueba, sucursal_id, payload_escpos)
      VALUES (v_ticket, TRUE, v_sucursal, 'X');
      ASSERT FALSE, 'Caso 7: una prueba con ticket_id debió rechazarse';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.print_jobs (ticket_id, es_prueba, sucursal_id, payload_escpos)
      VALUES (NULL, FALSE, v_sucursal, 'X');
      ASSERT FALSE, 'Caso 7: un trabajo real sin ticket_id debió rechazarse';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    PERFORM public.reclamar_print_jobs(v_estacion, v_sucursal, 10);

    UPDATE public.print_jobs SET estado = 'impreso', impreso_at = NOW()
     WHERE id IN (v_job_prueba_1, v_job_prueba_2);

    SELECT veces_impreso INTO v_ticket_impresiones_despues
    FROM public.tickets WHERE id = v_ticket;

    ASSERT v_ticket_impresiones_antes = v_ticket_impresiones_despues,
           'Caso 7: un trabajo de prueba jamás debe tocar veces_impreso de un boleto real';

    ASSERT (SELECT count(*) FROM public.ticket_eventos WHERE ticket_id = v_ticket AND detalle LIKE '%PRUEBA%') = 0,
           'Caso 7: un trabajo de prueba no debe dejar rastro en el historial de ningún boleto';
  END;

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
