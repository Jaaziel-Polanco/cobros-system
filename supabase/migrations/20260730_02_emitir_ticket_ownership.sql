-- ══════════════════════════════════════════════════════════════
-- Migración: emitir_ticket -- comprobación de propiedad dentro del RPC
--
-- CONTEXTO (I5): verificarPropiedadCliente() en lib/actions/tickets.ts
-- comprueba que el agente pueda operar sobre el cliente, pero solo vive en
-- TypeScript. emitir_ticket es SECURITY DEFINER con GRANT EXECUTE TO
-- authenticated, y el navegador de cada agente lleva la clave anónima más
-- su JWT (lib/supabase/client.ts): cualquier agente puede invocar el RPC
-- directamente desde la consola del navegador, saltándose por completo la
-- comprobación de TypeScript, y emitir boletos a nombre de clientes ajenos
-- -- quemando números del sorteo activo compartido y leyendo su dni_ruc en
-- el snapshot devuelto.
--
-- Además, p_emitido_por lo elegía el llamante: el rastro de auditoría era
-- falsificable por cualquiera que invocara el RPC directamente.
--
-- CORRECCIÓN: si auth.uid() no es NULL (la llamada viene de un usuario real
-- vía cliente de sesión, no de un proceso interno con service_role):
--   · se exige que el usuario sea admin o que sea el agente asignado al
--     cliente (clientes.agente_id = auth.uid()); si no, se devuelve el
--     mismo tipo de error JSON ('ok': false) que ya usa el resto de la
--     función, en vez de una excepción -- consistente con el resto del
--     contrato de esta función.
--   · se ignora p_emitido_por y se usa auth.uid() para el registro de
--     auditoría (columna emitido_por de tickets y ticket_eventos).
-- Si auth.uid() es NULL (llamadas internas con service_role: crons,
-- scripts), el comportamiento es exactamente el mismo de antes: se
-- respetan los parámetros tal cual se reciben.
--
-- La comprobación de TypeScript (verificarPropiedadCliente) NO se retira:
-- sigue dando mejores mensajes de error y es defensa en profundidad. Esta
-- migración es la que cierra el hueco real -- el RPC ya no confía en que
-- el llamante haya pasado por esa capa.
--
-- Ningún otro comportamiento de la función cambia: la numeración, el
-- snapshot, la idempotencia por pago y el manejo de la carrera de
-- unique_violation quedan exactamente igual que en 20260729_04_emitir_ticket.sql.
--
-- CORRECCIÓN POSTERIOR A REVISIÓN (antes de aplicar, nunca llegó a
-- ejecutarse contra producción): la primera versión de esta comprobación
-- usaba `v_cliente.agente_id <> auth.uid()`. clientes.agente_id es
-- NULLABLE -- hay clientes reales sin agente asignado --, y en SQL
-- `NULL <> <uuid>` no da TRUE ni FALSE, da NULL; el AND completo se
-- evaluaba a NULL, el IF nunca entraba, y CUALQUIER agente pasaba la
-- comprobación para un cliente sin asignar. Corregido a
-- `agente_id IS DISTINCT FROM auth.uid()`, que sí trata NULL como un valor
-- comparable (NULL IS DISTINCT FROM <uuid> = TRUE), igual que el operador
-- `!==` de JavaScript en verificarPropiedadCliente. Se revisó el resto de
-- migraciones de esta oleada y el TypeScript de lib/actions/tickets.ts:
-- no aparece el mismo patrón en ningún otro sitio.
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
    v_cliente     public.clientes%ROWTYPE;
    v_sorteo      public.sorteos%ROWTYPE;
    v_cfg         public.configuracion_ticket%ROWTYPE;
    v_ticket      public.tickets%ROWTYPE;
    v_existente   public.tickets%ROWTYPE;
    v_numero      INTEGER;
    v_fmt         TEXT;
    v_token       TEXT;
    v_snapshot    JSONB;
    v_emitido_por UUID := p_emitido_por;
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

    -- I5: comprobación de propiedad dentro del RPC. auth.uid() es NULL para
    -- llamadas internas con service_role (crons, scripts): ahí se respetan
    -- los parámetros del llamante, igual que antes. Cuando SÍ hay un
    -- usuario real detrás, el RPC deja de confiar en verificarPropiedadCliente
    -- (TypeScript) como única barrera, y el emitido_por deja de ser elegible
    -- por el llamante.
    IF auth.uid() IS NOT NULL THEN
        -- IS DISTINCT FROM, no <>: agente_id es NULLABLE (clientes sin
        -- agente asignado existen en producción). Con <>, NULL <> auth.uid()
        -- da NULL -- ni TRUE ni FALSE -- y el AND completo se evalúa a NULL,
        -- así que el IF nunca entra y CUALQUIER agente pasaría la
        -- comprobación para un cliente sin asignar. IS DISTINCT FROM trata
        -- NULL como un valor comparable más: NULL IS DISTINCT FROM <uuid>
        -- da TRUE, así que un cliente sin agente queda bloqueado para
        -- agentes (solo el admin puede operar sobre él), igual que hace
        -- verificarPropiedadCliente en TypeScript con `!==`.
        IF public.get_my_rol() <> 'admin'
           AND v_cliente.agente_id IS DISTINCT FROM auth.uid() THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'No tienes permiso para operar sobre este cliente');
        END IF;
        v_emitido_por := auth.uid();
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
            p_origen, p_motivo, v_token, v_snapshot, v_emitido_por
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
        v_emitido_por
    );

    RETURN jsonb_build_object('ok', true, 'ya_existia', false,
                              'ticket', to_jsonb(v_ticket));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- El REVOKE/GRANT de 20260729_04_emitir_ticket.sql (reafirmado en
-- 20260730_00_revocar_execute_publico.sql) sigue vigente: CREATE OR REPLACE
-- no toca privilegios. No hace falta repetirlo aquí.
