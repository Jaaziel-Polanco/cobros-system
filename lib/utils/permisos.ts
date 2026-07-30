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
    return { ...DEFAULT_PERMISOS_AGENTE, ...(profile.permisos ?? {}) }
}

export function tienePermiso(
    profile: PerfilMinimo,
    permiso: keyof PermisosAgente,
): boolean {
    return getPermisos(profile)[permiso] === true
}
