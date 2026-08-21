-- ==============================================================
-- Correccion puntual de datos: 15 deudas con fecha_corte adelantada de mas
--
-- QUE PASO
--
-- `marcarPagoPeriodo()` no es idempotente: inserta en `pagos` y avanza
-- `fecha_corte` un periodo, sin comprobar si ese periodo ya estaba marcado.
-- Cuando la respuesta del Server Action se pierde, el pago YA quedo escrito;
-- el personal ve el error y vuelve a pulsar. Cada pulsacion extra avanza la
-- fecha otro periodo.
--
-- Los 18 pagos sobrantes de abajo se registraron entre 5 y 33 segundos
-- despues del primero, todos con monto 0 y la misma nota automatica
-- ("Pago registrado desde cuentas"). Un cliente no paga dos quincenas con
-- siete segundos de diferencia: son reintentos.
--
-- Efecto: 15 clientes quincenales con la fecha de corte corrida 15, 30 o 45
-- dias de mas. No se les estaba cobrando lo que deben.
--
-- ALCANCE DELIBERADAMENTE ACOTADO
--
-- En toda la base hay 120 deudas con este patron desde el 25 de marzo (204
-- periodos). NO se corrigen aqui, y no por pereza:
--
--   * 48 estan ya SALDADAS. Retroceder su fecha las resucitaria como deuda
--     viva. Eso no es corregir, es romper.
--   * Hay pares separados por horas, y uno con 25 periodos seguidos. Eso no
--     tiene firma de reintento: parece alguien poniendo al dia a un cliente
--     que pago varias quincenas juntas. Retroceder eso seria cobrar dos
--     veces lo mismo.
--   * Un retroceso en bloque moveria 28 clientes que hoy figuran al dia a
--     mora, y el cron les mandaria WhatsApps de cobro.
--
-- Distinguir bug de accion deliberada en los 105 restantes necesita a
-- alguien que conozca a esos clientes. Queda para decision humana.
--
-- POR QUE ESTO SI ES SEGURO APLICARLO HOY
--
-- Las 15 tienen envios previos (entre 8 y 63), asi que no entran por la rama
-- de "primer envio" del cron, y todas pagaron hace menos de 12 dias, que es
-- el umbral quincenal. El cron las omite. La correccion no dispara ningun
-- mensaje ahora; los recordatorios volveran cuando toque de verdad.
--
-- LOS PAGOS SOBRANTES NO SE BORRAN
--
-- Se anotan. Su monto es 0, asi que no mueven dinero, y borrar registros de
-- pago para tapar un fallo del sistema es peor que dejar constancia.
-- ==============================================================

BEGIN;

-- ---- Guarda: que no se aplique dos veces ----------------------
-- Aplicarla de nuevo restaria otros 15 dias a cada fecha, en silencio.
DO $guarda$
DECLARE ya INTEGER;
BEGIN
    SELECT count(*) INTO ya
      FROM public.pagos
     WHERE nota LIKE '[DUPLICADO 2026-08-21]%';
    IF ya > 0 THEN
        RAISE EXCEPTION 'Ya aplicada: % pagos ya estan marcados', ya;
    END IF;
END
$guarda$;

-- ---- 1. Retroceder fecha_corte los periodos sobrantes ----------
-- Todas son quincenales: 15 dias por periodo sobrante.
WITH sobrantes(deuda_id, periodos) AS (VALUES
    ('ba4eb5f0-2753-42c3-80d5-aadf5645c98c'::uuid, 1),  -- ALEXANDRA RAMIREZ
    ('b714889a-1f51-4b0e-a20a-612d97acccac'::uuid, 1),  -- AURENIS JOSE LEMOS
    ('7338e62b-505e-4687-83da-0a2074e63047'::uuid, 1),  -- EMELY CASTILLO
    ('ac9f6fcb-5cbe-4c10-a63e-d639f83cff0c'::uuid, 1),  -- FRANCHESKA CASTILLO
    ('6ca0c389-2268-4b70-ac82-e64a1409da1c'::uuid, 1),  -- HECTOR MATEO
    ('6b7c3352-8bc6-4c1c-b492-ee211b2effe3'::uuid, 2),  -- JENNIFER VICENTE
    ('43482d60-d493-4fbe-8b54-f55ffcc5796d'::uuid, 1),  -- JENSY DEL ROSARIO
    ('058df6ee-7999-42e1-9391-bbc577599cd7'::uuid, 1),  -- JHASSIEL CUEVAS
    ('3e93e119-056e-4752-8f6b-0da5de79e2a2'::uuid, 3),  -- JOEL MERCEDES
    ('baac8652-f7b4-47a6-a571-35a3c4623856'::uuid, 1),  -- JOHN FABAIS
    ('8c854be0-3966-451f-a9a4-23ffe6b6964d'::uuid, 1),  -- JOSE ALBERTO MARTINEZ
    ('4f9d7e1f-1c84-44bd-836d-29666957b6ff'::uuid, 1),  -- MASSIEL LOVERA
    ('b20a9653-2d39-40ea-ae5f-d8739fe7afc6'::uuid, 1),  -- MYRIAM CHARLES
    ('449b36ad-ce98-49ff-8ec2-ec5f14c65360'::uuid, 1),  -- NATANAEL NUNEZ
    ('14bc8517-26be-4c82-872a-4df5d70b212d'::uuid, 1)   -- YOHANNY SEVERINO
)
UPDATE public.deudas d
   SET fecha_corte = d.fecha_corte - (s.periodos * 15),
       -- Mismo calculo que actualizar_dias_atraso(), pero acotado a estas 15
       -- filas: correr la funcion entera tocaria updated_at de las 765
       -- deudas activas sin motivo.
       dias_atraso = GREATEST(0, CURRENT_DATE - (d.fecha_corte - (s.periodos * 15))),
       etapa = public.calcular_etapa_cobranza(
                 GREATEST(0, CURRENT_DATE - (d.fecha_corte - (s.periodos * 15)))),
       updated_at = NOW()
  FROM sobrantes s
 WHERE d.id = s.deuda_id
   AND d.frecuencia_pago = 'quincenal'   -- cinturon: si alguna cambiara de
   AND d.estado = 'activo';              -- frecuencia o se saldara, no se toca

-- ---- 2. Dejar constancia en los pagos sobrantes ----------------
-- Se conserva la nota original detras del marcador.
UPDATE public.pagos
   SET nota = '[DUPLICADO 2026-08-21] reintento tras error de red; no cuenta como periodo. ' || COALESCE(nota, '')
 WHERE id IN (
    '9b88de32-af64-40d0-8c9c-8f003e62be3e',  -- JHASSIEL
    'a5b30061-a267-4e6a-b2c6-93d2d5e69487',  -- YOHANNY
    '51155154-7829-46e0-96c8-21a85ff4fe78',  -- JOEL 2/4
    '902ce901-7292-457e-af2c-44692a7329be',  -- JOEL 3/4
    'f3fbeba5-d5d8-4450-a2bb-a00eea8b6e14',  -- JOEL 4/4
    '0b22e79b-2753-42ef-a1c2-a5702908f0c9',  -- JENSY
    '2392ad45-be40-4d0b-ae44-9123738c7b84',  -- NATANAEL
    '6a3367af-cf25-4c97-b613-d4642608fabd',  -- MASSIEL
    '7ad2cf0d-7fe4-4d73-b885-7dcb83f29285',  -- JENNIFER 2/3
    'e7134107-1030-4954-937b-7061b90d9117',  -- JENNIFER 3/3
    '03154075-3dbd-4acc-8952-ed106a4d7510',  -- HECTOR
    'fb15818d-127b-4e9f-a51b-4f02f8a28434',  -- EMELY
    'e021cb26-030c-4932-a665-6907416cfd03',  -- JOSE ALBERTO
    '9ae2d3e6-4d1e-4821-bbc1-eefb0270c4fc',  -- FRANCHESKA
    '2bc6f16a-19ff-48e6-a032-9c0973beb73e',  -- MYRIAM
    '2caf595e-28f9-4d37-a7c8-be8211dcc375',  -- AURENIS
    'fb1b9b04-0349-4d1a-b5eb-d6b9634bdf5f',  -- ALEXANDRA
    '36bb2ad9-cdf5-4929-a44a-4014e6c7d0c5'   -- JOHN
 );

COMMIT;
