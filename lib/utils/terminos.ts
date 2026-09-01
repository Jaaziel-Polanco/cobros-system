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
 *
 * ── POR QUÉ SE PASAN VARIOS ORÍGENES ──────────────────────────
 *
 * La versión anterior comparaba sólo contra `APP_PUBLIC_URL`, y por eso el
 * bucle ocurrió igual en producción el 2026-09-01: la app se sirve desde
 * `sorteo.inversioneshectorcordero.com`, `APP_PUBLIC_URL` seguía apuntando
 * al host de Easypanel, y `url_terminos` era la del dominio nuevo. Tres
 * valores, dos orígenes distintos, y la guarda mirando el que no era —
 * `/terminos` devolvía un 307 hacia sí misma.
 *
 * La autoridad sobre «esta misma página» no es una variable de entorno,
 * que puede quedarse vieja sin que nadie se entere: es el host con el que
 * llegó la petición. Se pasan los dos, y basta con que UNO coincida para
 * cortar. Una variable mal puesta vuelve a ser lo que debe ser —una URL
 * fea en un QR— y no una página caída.
 */
export function resolverRedireccionTerminos(
    configurada: string | null | undefined,
    origenesPropios:
        | string
        | null
        | undefined
        | readonly (string | null | undefined)[],
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

    if (destino.pathname.replace(/\/+$/, '') !== RUTA_PROPIA) {
        // Otra ruta: una landing propia en /bases es una decisión legítima.
        return destino.toString()
    }

    const bases = (Array.isArray(origenesPropios) ? origenesPropios : [origenesPropios])
        .map(v => v?.trim())
        .filter((v): v is string => Boolean(v))

    // Sin ninguna pista de quiénes somos, el localhost de desarrollo es la
    // única suposición razonable.
    if (bases.length === 0) bases.push('http://localhost:3000')

    for (const base of bases) {
        try {
            // Se compara el HOST, no el origen entero: el esquema no cambia
            // que sea un bucle. Detrás de un proxy, la petición llega por
            // http aunque el navegador hable https, y comparar el origen
            // completo hacía que la guarda no disparara -- fue lo que se
            // midió al reproducirlo en local:
            //   host = sorteo.inversioneshectorcordero.com, protocolo = http
            //   url_terminos = https://sorteo.inversioneshectorcordero.com/terminos
            // Dos orígenes distintos, el mismo sitio, bucle igual.
            //
            // Aflojar la comparación aquí no abre nada: lo único que se
            // decide es NO redirigir. Quedarse de más en la página propia
            // es inofensivo; redirigirse a sí misma no lo es.
            if (destino.host === new URL(RUTA_PROPIA, base).host) return null
        } catch {
            // Esa base está mal escrita: se ignora ella sola, no la lista
            // entera. El bucle sólo puede darse si algún host coincide.
        }
    }

    return destino.toString()
}
