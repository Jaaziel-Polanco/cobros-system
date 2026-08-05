-- ══════════════════════════════════════════════════════════════
-- Verificación manual de guardar_ejecucion_sorteo
-- Todo dentro de una transacción que termina en ROLLBACK.
--
-- NOTA: este guion corre sin sesión (auth.uid() IS NULL dentro del RPC),
-- así que ejercita la rama "llamada interna" -- respeta p_ejecutado_por tal
-- cual y no exige tiene_permiso('realizar_sorteo'). La rama de permiso
-- (auth.uid() IS NOT NULL) no se puede ejercitar desde el SQL Editor sin
-- una sesión JWT real; queda cubierta por inspección de código, igual que
-- las comprobaciones equivalentes de emitir_ticket y registrar_pago_atomico.
-- ══════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_cliente1 UUID;
  v_cliente2 UUID;
  v_sorteo   UUID;
  v_t1       UUID;
  v_t2       UUID;
  v_res      JSONB;
  v_ejec1    UUID;
  v_conteo   INTEGER;
BEGIN
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('SorteoUno', 'Prueba', '8090000001') RETURNING id INTO v_cliente1;
  INSERT INTO public.clientes (nombre, apellido, telefono)
  VALUES ('SorteoDos', 'Prueba', '8090000002') RETURNING id INTO v_cliente2;

  INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, estado, prefijo)
  VALUES ('Sorteo Verificacion', CURRENT_DATE - 10, CURRENT_DATE + 10, 'borrador', 'TSTVER')
  RETURNING id INTO v_sorteo;

  -- ck_ticket_motivo_manual (añadida después de este brief) exige motivo
  -- no vacío para origen = 'manual'. Boletos de prueba: se les da un motivo
  -- cualquiera, no relevante para lo que este guion verifica.
  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, motivo, token_publico, snapshot)
  VALUES (1, 'TSTVER-000001', v_sorteo, v_cliente1, 'manual', 'Prueba de verificación', 'tok-ver-1', '{}'::jsonb)
  RETURNING id INTO v_t1;

  INSERT INTO public.tickets
    (numero, numero_formateado, sorteo_id, cliente_id, origen, motivo, token_publico, snapshot)
  VALUES (2, 'TSTVER-000002', v_sorteo, v_cliente2, 'manual', 'Prueba de verificación', 'tok-ver-2', '{}'::jsonb)
  RETURNING id INTO v_t2;

  -- Caso 1: primera ejecución
  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-uno', 'mulberry32-fisher-yates-v1', 'hash-uno', 2,
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t1, 'orden', 0),
      jsonb_build_object('ticket_id', v_t2, 'orden', 1)
    ),
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t1, 'cliente_id', v_cliente1,
                         'posicion', 1, 'premio', 'Primer premio',
                         'snapshot', '{}'::jsonb)
    ),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 1: debió guardar la ejecución';
  v_ejec1 := (v_res ->> 'ejecucion_id')::UUID;

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_participantes WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 2, 'Caso 1: debieron guardarse 2 participantes';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ganadores WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 1, 'Caso 1: debió guardarse 1 ganador';

  ASSERT (SELECT vigente FROM public.sorteo_ejecuciones WHERE id = v_ejec1),
         'Caso 1: la ejecución debe quedar vigente';

  -- Caso 2: re-ejecutar desplaza la anterior sin borrarla
  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-dos', 'mulberry32-fisher-yates-v1', 'hash-dos', 2,
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t2, 'orden', 0),
      jsonb_build_object('ticket_id', v_t1, 'orden', 1)
    ),
    jsonb_build_array(
      jsonb_build_object('ticket_id', v_t2, 'cliente_id', v_cliente2,
                         'posicion', 1, 'premio', 'Primer premio',
                         'snapshot', '{}'::jsonb)
    ),
    NULL
  );

  ASSERT (v_res ->> 'ok')::BOOLEAN, 'Caso 2: debió guardar la segunda ejecución';

  ASSERT NOT (SELECT vigente FROM public.sorteo_ejecuciones WHERE id = v_ejec1),
         'Caso 2: la ejecución anterior debe dejar de ser vigente';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ejecuciones WHERE sorteo_id = v_sorteo;
  ASSERT v_conteo = 2, 'Caso 2: ambas ejecuciones deben conservarse';

  SELECT count(*) INTO v_conteo
  FROM public.sorteo_ganadores WHERE ejecucion_id = v_ejec1;
  ASSERT v_conteo = 1, 'Caso 2: los ganadores antiguos se conservan para auditoría';

  -- Caso 3: un sorteo cerrado no admite ejecuciones
  UPDATE public.sorteos SET estado = 'cerrado' WHERE id = v_sorteo;

  v_res := public.guardar_ejecucion_sorteo(
    v_sorteo, CURRENT_DATE - 10, CURRENT_DATE + 10, 1,
    'semilla-tres', 'mulberry32-fisher-yates-v1', 'hash-tres', 2,
    '[]'::jsonb, '[]'::jsonb, NULL
  );

  ASSERT NOT (v_res ->> 'ok')::BOOLEAN, 'Caso 3: un sorteo cerrado debe rechazarse';

  RAISE NOTICE 'TODAS LAS VERIFICACIONES PASARON';
END $$;

ROLLBACK;
