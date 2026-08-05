/**
 * Descodifica una cadena que debería ser base64, validando de verdad que
 * lo es. `Buffer.from(x, 'base64')` no valida nada: ante una cadena
 * corrupta (un byte perdido en tránsito, un campo truncado) descodifica
 * silenciosamente cualquier basura que pueda, y esa basura se manda tal
 * cual a la impresora mientras el agente reporta éxito.
 *
 * La validación real es la ida y vuelta: si volver a codificar en base64
 * lo descodificado no reproduce la cadena original, no era base64 válido.
 */
export function decodificarBase64Estricto(texto: unknown): Buffer | null {
    if (typeof texto !== 'string' || texto.length === 0) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(texto)) return null
    if (texto.length % 4 !== 0) return null

    const bytes = Buffer.from(texto, 'base64')
    if (bytes.toString('base64') !== texto) return null

    return bytes
}
