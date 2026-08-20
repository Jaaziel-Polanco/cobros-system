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
})
