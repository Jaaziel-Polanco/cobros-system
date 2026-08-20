/**
 * Decide si la página `/terminos` debe redirigir a unas bases alojadas fuera
 * de esta aplicación, o mostrar las suyas propias.
 *
 * Vive aquí y no dentro de `app/terminos/page.tsx` porque un `page.tsx` del
 * App Router no puede exportar nada que no sea el componente y sus opciones
 * de ruta: ahí dentro esta lógica no se podría probar sin levantar la app.
 */

/** Ruta de las bases que sirve esta misma aplicación. */
const RUTA_PROPIA = '/terminos'

/**
 * Devuelve la URL a la que hay que redirigir, o `null` para quedarse en la
 * página propia.
 *
 * Se queda en la página propia en tres casos:
 *
 *  1. No hay nada configurado.
 *  2. Lo configurado no es una URL que se pueda parsear. Redirigir a una
 *     cadena rota deja al cliente en una pantalla de error del navegador;
 *     enseñarle las bases de la casa es siempre mejor que eso.
 *  3. Apunta a esta misma ruta. Este es el importante: el campo «URL de
 *     términos» del panel invita a escribir la dirección pública del
 *     negocio, y si alguien pega ahí la de ESTA página, `redirect()` se
 *     llama a sí mismo en bucle hasta que el navegador corta. El cliente
 *     que escanea el QR de su boleto ve un error, y la causa —un campo de
 *     configuración escrito hace semanas— no se parece en nada al síntoma.
 */
export function resolverRedireccionTerminos(
    configurada: string | null | undefined,
    appPublicUrl: string | undefined,
): string | null {
    const valor = configurada?.trim()
    if (!valor) return null

    let destino: URL
    try {
        destino = new URL(valor)
    } catch {
        return null
    }

    // Solo http(s). Un `javascript:` o un `data:` guardado en la base
    // llegaría hasta el navegador del cliente a través de una cabecera
    // Location; el resto de la validación no lo frena porque `new URL()`
    // los parsea sin queja.
    if (destino.protocol !== 'http:' && destino.protocol !== 'https:') return null

    try {
        const propia = new URL(RUTA_PROPIA, appPublicUrl ?? 'http://localhost:3000')
        const mismaRuta = destino.pathname.replace(/\/+$/, '') === RUTA_PROPIA
        if (destino.origin === propia.origin && mismaRuta) return null
    } catch {
        // APP_PUBLIC_URL mal escrita: no se puede comparar el origen, pero
        // eso no es motivo para dejar de redirigir a una URL que sí es
        // válida. El bucle solo puede darse si los dos orígenes coinciden.
    }

    return destino.toString()
}
