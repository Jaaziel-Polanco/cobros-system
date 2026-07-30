-- ══════════════════════════════════════════════════════════════
-- Migración: RPC de emisión de boletos
--   · Numeración serializada por bloqueo de fila del sorteo
--   · Idempotente respecto al pago (ver índice único uq_tickets_pago,
--     creado en 20260729_01_boleteria_base.sql)
--   · Congela el snapshot de los datos impresos
--
-- NOTA search_path: este proyecto instala pgcrypto en el esquema
-- `extensions` (no en `public`), por eso se llama explícitamente a
-- extensions.gen_random_bytes(32) y el search_path incluye ambos
-- esquemas. No cambiar a public.gen_random_bytes: no existe ahí.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.emitir_ticket(
    p_cliente_id  UUID,
    p_pago_id     UUID  DEFAULT NULL,
    p_deuda_id    UUID  DEFAULT NULL,
    p_origen      TEXT  DEFAULT 'automatico',
    p_motivo      TEXT  DEFAULT NULL,
    p_emitido_por UUID  DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_cliente   public.clientes%ROWTYPE;
    v_sorteo    public.sorteos%ROWTYPE;
    v_cfg       public.configuracion_ticket%ROWTYPE;
    v_ticket    public.tickets%ROWTYPE;
    v_existente public.tickets%ROWTYPE;
    v_numero    INTEGER;
    v_fmt       TEXT;
    v_token     TEXT;
    v_snapshot  JSONB;
BEGIN
    IF p_origen NOT IN ('automatico','manual') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Origen inválido');
    END IF;

    IF p_origen = 'manual' AND (p_motivo IS NULL OR btrim(p_motivo) = '') THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'El motivo es obligatorio para boletos manuales');
    END IF;

    SELECT * INTO v_cliente FROM public.clientes WHERE id = p_cliente_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Cliente no encontrado');
    END IF;

    -- Idempotencia: un pago ya boletado devuelve su boleto
    IF p_pago_id IS NOT NULL THEN
        SELECT * INTO v_existente FROM public.tickets
        WHERE pago_id = p_pago_id AND estado <> 'anulado';
        IF FOUND THEN
            RETURN jsonb_build_object('ok', true, 'ya_existia', true,
                                      'ticket', to_jsonb(v_existente));
        END IF;
    END IF;

    SELECT * INTO v_cfg FROM public.configuracion_ticket WHERE id = TRUE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Falta configurar el módulo de boletos');
    END IF;

    -- Correlativo del sorteo activo. El UPDATE bloquea la fila, lo que
    -- serializa las emisiones concurrentes sin necesidad de secuencia.
    UPDATE public.sorteos
       SET ultimo_numero = ultimo_numero + 1,
           updated_at    = NOW()
     WHERE estado = 'activo'
    RETURNING * INTO v_sorteo;

    IF FOUND THEN
        v_numero := v_sorteo.ultimo_numero;
        v_fmt    := v_sorteo.prefijo || '-' || lpad(v_numero::TEXT, 6, '0');
    ELSE
        v_numero := nextval('public.tickets_numero_huerfano_seq');
        v_fmt    := v_cfg.prefijo_numeracion || '-SN-' || lpad(v_numero::TEXT, 6, '0');
    END IF;

    -- Token público: 32 bytes aleatorios en base64url, no enumerable
    v_token := rtrim(
        replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'),
        '='
    );

    v_snapshot := jsonb_build_object(
        'cliente', jsonb_build_object(
            'id',       v_cliente.id,
            'nombre',   v_cliente.nombre,
            'apellido', v_cliente.apellido,
            'telefono', v_cliente.telefono,
            'dni_ruc',  v_cliente.dni_ruc
        ),
        'sorteo', CASE WHEN v_sorteo.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id',        v_sorteo.id,
            'nombre',    v_sorteo.nombre,
            'premio',    v_sorteo.premio,
            'fecha_fin', v_sorteo.fecha_fin
        ) END,
        'negocio', jsonb_build_object(
            'nombre_comercial', v_cfg.nombre_comercial,
            'rnc',              v_cfg.rnc,
            'direccion',        v_cfg.direccion,
            'telefono',         v_cfg.telefono,
            'texto_legal',      v_cfg.texto_legal,
            'url_terminos',     v_cfg.url_terminos,
            'pie_impresion',    v_cfg.pie_impresion,
            'logo_url',         v_cfg.logo_url
        ),
        'emitido_at_rd', to_char(
            NOW() AT TIME ZONE 'America/Santo_Domingo', 'DD/MM/YYYY HH12:MI AM'),
        'origen', p_origen,
        'version_snapshot', 1
    );

    BEGIN
        INSERT INTO public.tickets (
            numero, numero_formateado, sorteo_id, cliente_id, pago_id, deuda_id,
            origen, motivo, token_publico, snapshot, emitido_por
        ) VALUES (
            v_numero, v_fmt, v_sorteo.id, p_cliente_id, p_pago_id, p_deuda_id,
            p_origen, p_motivo, v_token, v_snapshot, p_emitido_por
        ) RETURNING * INTO v_ticket;
    EXCEPTION WHEN unique_violation THEN
        -- Carrera: otra petición boletó el mismo pago entre la comprobación
        -- y el insert. Devolvemos el boleto ganador.
        IF p_pago_id IS NOT NULL THEN
            SELECT * INTO v_existente FROM public.tickets
            WHERE pago_id = p_pago_id AND estado <> 'anulado';
            IF FOUND THEN
                RETURN jsonb_build_object('ok', true, 'ya_existia', true,
                                          'ticket', to_jsonb(v_existente));
            END IF;
        END IF;
        RAISE;
    END;

    INSERT INTO public.ticket_eventos (ticket_id, tipo, estado, detalle, usuario_id)
    VALUES (
        v_ticket.id, 'emitido', 'ok',
        CASE WHEN p_origen = 'manual'
             THEN 'Manual: ' || p_motivo
             ELSE 'Automático por pago' END,
        p_emitido_por
    );

    RETURN jsonb_build_object('ok', true, 'ya_existia', false,
                              'ticket', to_jsonb(v_ticket));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
