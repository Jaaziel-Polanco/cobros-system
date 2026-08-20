import {
    DEFAULT_PERMISOS_AGENTE,
    type PermisosAgente,
    type Rol,
} from '@/lib/types'

type PerfilMinimo = {
    rol: Rol
    permisos?: Partial<PermisosAgente> | null
}

/**
 * Devuelve los permisos efectivos de un perfil.
 *
 * El admin siempre los tiene todos. Para agentes, los valores guardados se
 * fusionan SOBRE los valores por defecto: así, al añadir un permiso nuevo al
 * sistema, los agentes ya existentes lo heredan en vez de quedar bloqueados.
 */
export function getPermisos(profile: PerfilMinimo): PermisosAgente {
    if (profile.rol === 'admin') {
        const todos = {} as PermisosAgente
        for (const clave of Object.keys(DEFAULT_PERMISOS_AGENTE) as (keyof PermisosAgente)[]) {
            todos[clave] = true
        }
        return todos
    }

    const guardados = profile.permisos ?? {}
    const efectivos = { ...DEFAULT_PERMISOS_AGENTE, ...guardados }

    /**
     * `anular_ticket` se separó de `generar_ticket_manual`, que antes
     * gateaba las dos acciones. Un perfil guardado antes del cambio no
     * tiene la clave nueva.
     *
     * La fusión de arriba le daría el valor por defecto (`true`), y eso
     * sería un regalo silencioso: un agente al que le habían QUITADO
     * `generar_ticket_manual` —o sea, alguien a quien deliberadamente se le
     * negó anular boletos— amanecería pudiendo anularlos. Un permiso que
     * aparece solo porque se desplegó una versión no lo concedió nadie.
     *
     * Así que, mientras la clave nueva no exista, se hereda del permiso
     * viejo. Solo cuando estaba explícitamente guardado: si el perfil no
     * dice nada de ninguno de los dos, el valor por defecto es correcto.
     *
     * Esto convive con la migración que rellena la columna
     * (20260807_01_separar_permiso_anular_ticket.sql): una vez rellenada,
     * la clave existe y esta rama deja de tocar nada. Está aquí para que
     * el orden entre despliegue y migración deje de importar — sea cual
     * sea, nadie gana ni pierde permisos.
     */
    if (guardados.anular_ticket === undefined
        && guardados.generar_ticket_manual !== undefined) {
        efectivos.anular_ticket = guardados.generar_ticket_manual
    }

    return efectivos
}

export function tienePermiso(
    profile: PerfilMinimo,
    permiso: keyof PermisosAgente,
): boolean {
    return getPermisos(profile)[permiso] === true
}
