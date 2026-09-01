import { describe, it, expect } from 'vitest'
import { resolverRedireccionTerminos } from './terminos'

const APP = 'https://negocio.example.com'

describe('resolverRedireccionTerminos', () => {

    describe('cuando no hay nada que hacer', () => {
        it('se queda en la página propia si no hay URL configurada', () => {
            expect(resolverRedireccionTerminos(null, APP)).toBeNull()
            expect(resolverRedireccionTerminos(undefined, APP)).toBeNull()
            expect(resolverRedireccionTerminos('', APP)).toBeNull()
            expect(resolverRedireccionTerminos('   ', APP)).toBeNull()
        })
    })

    describe('el bucle de redirección', () => {
        /**
         * El caso que motivó esta función. El campo «URL de términos» del
         * panel invita a escribir la dirección pública del negocio, y la de
         * esta misma página es una respuesta perfectamente razonable de dar.
         * Sin esta comprobación, `redirect()` se llama a sí mismo hasta que
         * el navegador corta, y el cliente que escanea el QR de su boleto ve
         * una pantalla de error.
         */
        it('NO redirige si la URL configurada es esta misma página', () => {
            expect(resolverRedireccionTerminos(`${APP}/terminos`, APP)).toBeNull()
        })

        it('tampoco con barra final, que es como la copia un navegador', () => {
            expect(resolverRedireccionTerminos(`${APP}/terminos/`, APP)).toBeNull()
            expect(resolverRedireccionTerminos(`${APP}/terminos///`, APP)).toBeNull()
        })

        it('ignora la query y el fragmento al comparar la ruta', () => {
            expect(resolverRedireccionTerminos(`${APP}/terminos?v=2`, APP)).toBeNull()
            expect(resolverRedireccionTerminos(`${APP}/terminos#premios`, APP)).toBeNull()
        })

        it('sí redirige a otra ruta del mismo dominio', () => {
            // Una landing propia en /bases no es un bucle: es una decisión
            // legítima y hay que respetarla.
            expect(resolverRedireccionTerminos(`${APP}/bases`, APP))
                .toBe(`${APP}/bases`)
        })

        it('sí redirige a /terminos de OTRO dominio', () => {
            expect(resolverRedireccionTerminos('https://otra-empresa.do/terminos', APP))
                .toBe('https://otra-empresa.do/terminos')
        })
    })

    describe('URLs que no se pueden usar', () => {
        it('se queda en la página propia si no es una URL parseable', () => {
            // El panel valida con Zod, pero la fila puede venir de una
            // migración, de un script o de un INSERT a mano.
            expect(resolverRedireccionTerminos('inversioneshectorcordero.com', APP)).toBeNull()
            expect(resolverRedireccionTerminos('esto no es una url', APP)).toBeNull()
        })

        it('rechaza esquemas que no sean http o https', () => {
            // `new URL()` los parsea sin quejarse, así que sin esta
            // comprobación acabarían en una cabecera Location, en el
            // navegador de un cliente, desde un campo de configuración.
            expect(resolverRedireccionTerminos('javascript:alert(1)', APP)).toBeNull()
            expect(resolverRedireccionTerminos('data:text/html,<h1>hola', APP)).toBeNull()
            expect(resolverRedireccionTerminos('file:///C:/bases.pdf', APP)).toBeNull()
        })
    })

    describe('cuando APP_PUBLIC_URL no ayuda', () => {
        it('sigue redirigiendo a una URL externa válida aunque falte', () => {
            expect(resolverRedireccionTerminos('https://otra.do/bases', undefined))
                .toBe('https://otra.do/bases')
        })

        it('sigue redirigiendo aunque APP_PUBLIC_URL esté mal escrita', () => {
            // Comparar orígenes deja de ser posible, pero el bucle solo
            // puede darse si los dos coinciden: no redirigir aquí sería
            // romper un caso bueno por un dato ajeno mal puesto.
            expect(resolverRedireccionTerminos('https://otra.do/bases', 'no-es-una-url'))
                .toBe('https://otra.do/bases')
        })

        it('detecta el bucle contra el localhost por defecto', () => {
            expect(resolverRedireccionTerminos('http://localhost:3000/terminos', undefined))
                .toBeNull()
        })
    })

    /**
     * EL CASO REAL DEL 2026-09-01, que la versión de un solo origen no
     * atrapaba. Medido contra producción antes de la corrección:
     *
     *   $ curl -I https://sorteo.inversioneshectorcordero.com/terminos
     *   307 -> https://sorteo.inversioneshectorcordero.com/terminos
     *
     * La app se servía desde el dominio nuevo, `APP_PUBLIC_URL` seguía
     * apuntando al host de Easypanel y `url_terminos` era la del dominio
     * nuevo: la guarda comparaba contra el origen que no era.
     */
    describe('el bucle que sí ocurrió: varios orígenes propios', () => {
        const EASYPANEL = 'https://negocio-ia-cuentas-por-cobrar.bkrj0h.easypanel.host'
        const SORTEO = 'https://sorteo.inversioneshectorcordero.com'

        it('corta el bucle si el dominio de la petición coincide, aunque APP_PUBLIC_URL no', () => {
            expect(resolverRedireccionTerminos(`${SORTEO}/terminos`, [EASYPANEL, SORTEO]))
                .toBeNull()
        })

        it('reproduce el fallo: con solo APP_PUBLIC_URL, redirigía a sí misma', () => {
            // Esto es lo que hacía la versión anterior. Se deja escrito para
            // que se vea que el defecto era real y cuál era su forma.
            expect(resolverRedireccionTerminos(`${SORTEO}/terminos`, EASYPANEL))
                .toBe(`${SORTEO}/terminos`)
        })

        it('basta con que coincida UNO de los orígenes, en cualquier posición', () => {
            expect(resolverRedireccionTerminos(`${SORTEO}/terminos`, [SORTEO, EASYPANEL]))
                .toBeNull()
            expect(resolverRedireccionTerminos(`${EASYPANEL}/terminos`, [EASYPANEL, SORTEO]))
                .toBeNull()
        })

        it('ignora los huecos y las bases mal escritas de la lista', () => {
            expect(resolverRedireccionTerminos(
                `${SORTEO}/terminos`, [undefined, 'no-es-una-url', null, SORTEO],
            )).toBeNull()
        })

        it('sigue redirigiendo a los términos de OTRO dominio', () => {
            expect(resolverRedireccionTerminos(
                'https://otra-empresa.do/terminos', [EASYPANEL, SORTEO],
            )).toBe('https://otra-empresa.do/terminos')
        })

        it('una lista vacía cae al localhost, no deja de comprobar', () => {
            expect(resolverRedireccionTerminos('http://localhost:3000/terminos', []))
                .toBeNull()
        })

        /**
         * Medido al reproducirlo en local con el Host del dominio real: la
         * petición llega al contenedor por http aunque el navegador hable
         * https, así que comparar el ORIGEN entero dejaba pasar el bucle.
         *
         *   host = sorteo.inversioneshectorcordero.com, protocolo = http
         *   url_terminos = https://sorteo.inversioneshectorcordero.com/terminos
         *
         * Dos orígenes distintos, el mismo sitio, bucle igual. Se compara
         * el host.
         */
        it('corta el bucle aunque el esquema no coincida (proxy: http dentro, https fuera)', () => {
            expect(resolverRedireccionTerminos(
                `${SORTEO}/terminos`,
                ['http://sorteo.inversioneshectorcordero.com'],
            )).toBeNull()
        })

        it('el puerto sí cuenta: otro puerto es otro sitio', () => {
            expect(resolverRedireccionTerminos(
                'http://localhost:3000/terminos', ['http://localhost:4000'],
            )).toBe('http://localhost:3000/terminos')
        })
    })
})
