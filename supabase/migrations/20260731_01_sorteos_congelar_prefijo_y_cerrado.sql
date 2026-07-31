-- ══════════════════════════════════════════════════════════════
-- Migración: congelar el prefijo de un sorteo con boletos emitidos y
-- sellar los sorteos cerrados — tercera capa (base de datos)
--
-- PENDIENTE DE APLICAR. No la ejecutes junto con otra cosa: cambia el
-- comportamiento de cualquier UPDATE sobre `sorteos`, incluido el manual.
--
-- CONTEXTO (H2 de review-plan3-report.md): las dos reglas vivían SOLO en el
-- formulario — el `disabled` del campo de prefijo en
-- components/sorteos/sorteo-form-dialog.tsx:160 y el hecho de que el botón
-- "Editar" no se pinte para un sorteo cerrado. Un `disabled` no protege
-- nada: `actualizarSorteo()` es una Server Action, o sea un endpoint HTTP
-- que acepta el payload que le manden, y sobre `sorteos` no había ningún
-- trigger ni CHECK (el único trigger era trg_sorteos_updated_at).
--
-- La capa 2 (la Server Action) ya está corregida en
-- lib/actions/sorteos.ts::actualizarSorteo. Esta migración es la capa 3, la
-- que protege también al SQL manual, a cualquier RPC futuro y a cualquier
-- código que reutilice la tabla sin pasar por esa función.
--
-- POR QUÉ UN TRIGGER Y NO UN CHECK: las dos reglas comparan la fila NUEVA
-- con la ANTERIOR (`prefijo` cambió / la fila ya estaba cerrada). Un CHECK
-- solo ve la fila nueva, así que no puede expresarlas.
--
-- POR QUÉ `ultimo_numero > 0` Y NO "existen boletos": `ultimo_numero` es el
-- correlativo que emitir_ticket consume, y no vuelve atrás ni siquiera si el
-- boleto se anula después. Es exactamente la condición que interesa: "este
-- prefijo ya salió impreso en algún numero_formateado". Contar filas de
-- `tickets` daría falsos negativos con boletos borrados.
--
-- QUÉ NO BLOQUEA, A PROPÓSITO:
--   - Reabrir un sorteo cerrado por SQL sigue siendo posible en un solo
--     UPDATE que cambie `estado` de 'cerrado' a otra cosa. Sellar eso del
--     todo dejaría un sorteo cerrado por error irrecuperable sin
--     desactivar el trigger. Lo que se impide es editar los DEMÁS campos
--     mientras está cerrado, que es el caso real (renombrarlo, moverle las
--     fechas después de publicar ganadores).
--   - `ultimo_numero` lo sigue tocando emitir_ticket con normalidad.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sorteos_proteger_campos_sellados()
RETURNS TRIGGER AS $$
BEGIN
    -- 1) Prefijo congelado en cuanto se ha emitido un boleto.
    IF OLD.ultimo_numero > 0 AND NEW.prefijo IS DISTINCT FROM OLD.prefijo THEN
        RAISE EXCEPTION
            'El prefijo del sorteo "%" no se puede cambiar: ya emitió % boleto(s) y su número está impreso o enviado tal cual al cliente',
            OLD.nombre, OLD.ultimo_numero
            USING ERRCODE = 'check_violation';
    END IF;

    -- 2) Un sorteo cerrado está sellado, salvo el propio `estado` (para poder
    --    deshacer un cierre por error) y `updated_at` (lo pone el trigger).
    IF OLD.estado = 'cerrado' AND NEW.estado = 'cerrado' AND (
           NEW.nombre                     IS DISTINCT FROM OLD.nombre
        OR NEW.descripcion                IS DISTINCT FROM OLD.descripcion
        OR NEW.premio                     IS DISTINCT FROM OLD.premio
        OR NEW.fecha_inicio               IS DISTINCT FROM OLD.fecha_inicio
        OR NEW.fecha_fin                  IS DISTINCT FROM OLD.fecha_fin
        OR NEW.prefijo                    IS DISTINCT FROM OLD.prefijo
        OR NEW.cantidad_ganadores_default IS DISTINCT FROM OLD.cantidad_ganadores_default
    ) THEN
        RAISE EXCEPTION
            'El sorteo "%" está cerrado y no se puede editar. Reábrelo antes si de verdad hace falta cambiarlo',
            OLD.nombre
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sorteos_proteger_sellados ON public.sorteos;

-- BEFORE UPDATE, antes que trg_sorteos_updated_at por orden alfabético del
-- nombre ('trg_sorteos_proteger_sellados' < 'trg_sorteos_updated_at'), que es
-- como Postgres desempata triggers del mismo evento. Da igual para el
-- resultado (este solo lanza o deja pasar), pero conviene saberlo.
CREATE TRIGGER trg_sorteos_proteger_sellados
    BEFORE UPDATE ON public.sorteos
    FOR EACH ROW
    EXECUTE FUNCTION public.sorteos_proteger_campos_sellados();

-- ─── Comprobación manual sugerida antes de dar por buena la migración ───
-- Todo dentro de BEGIN/ROLLBACK, sin dejar rastro:
--
--   BEGIN;
--   INSERT INTO public.sorteos (nombre, fecha_inicio, fecha_fin, prefijo, ultimo_numero)
--        VALUES ('ZZTEST_congelacion', CURRENT_DATE, CURRENT_DATE, 'ZZTESTA', 5);
--   -- debe fallar (prefijo con boletos emitidos):
--   UPDATE public.sorteos SET prefijo = 'ZZTESTB' WHERE nombre = 'ZZTEST_congelacion';
--   -- debe pasar (nombre sí es editable mientras no esté cerrado):
--   UPDATE public.sorteos SET nombre = 'ZZTEST_congelacion_2' WHERE prefijo = 'ZZTESTA';
--   -- debe pasar (cerrar) y luego fallar (editar cerrado):
--   UPDATE public.sorteos SET estado = 'cerrado' WHERE prefijo = 'ZZTESTA';
--   UPDATE public.sorteos SET nombre = 'ZZTEST_3' WHERE prefijo = 'ZZTESTA';
--   ROLLBACK;
