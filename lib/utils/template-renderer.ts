/**
 * Renderiza una plantilla de mensaje reemplazando variables {{variable}} con valores reales.
 */
export function renderTemplate(
    template: string,
    variables: Record<string, string | number | undefined | null>
): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = variables[key]
        if (value === undefined || value === null) return `{{${key}}}`
        return String(value)
    })
}

/**
 * Formatea un monto numérico a Pesos Dominicanos (RD$).
 */
export function formatMonto(monto: number, currency = 'DOP'): string {
    return new Intl.NumberFormat('es-DO', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
    }).format(monto)
}

/**
 * Formatea una fecha a formato legible en español (Rep. Dominicana).
 */
export function formatFecha(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-DO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}
