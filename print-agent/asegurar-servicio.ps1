# ==================================================================
#  Deja el agente de impresion encendido para siempre.
#
#  Que arregla, y por que hace falta cada cosa:
#
#   1. Arranque automatico  -> vuelve solo tras apagar, reiniciar o
#                              Windows Update. Sin sesion iniciada.
#   2. Reinicio ante caidas -> el Administrador de servicios lo revive.
#                              Si ademas hay NSSM, se configura tambien
#                              su propio reinicio: son dos redes, y con
#                              una sola queda un hueco.
#   3. Energia              -> una PC dormida no imprime. Es el fallo mas
#                              comun y el que peor se ve, porque la
#                              maquina parece encendida.
#   4. USB sin suspension   -> Windows apaga los puertos USB "para
#                              ahorrar" y la impresora deja de responder
#                              hasta que alguien la desconecta.
#
#  NSSM es OPCIONAL. Todo lo importante se hace con herramientas que ya
#  trae Windows, asi que funciona sin importar como se creo el servicio.
#  Si NSSM esta, se aprovecha para un par de extras.
#
#  COMO SE USA: clic derecho sobre PowerShell -> "Ejecutar como
#  administrador", y desde ahi:
#
#      cd C:\agente-impresion
#      powershell -ExecutionPolicy Bypass -File .\asegurar-servicio.ps1
#
#  Es idempotente: se puede volver a correr las veces que haga falta.
#  No cambia nada del agente ni de su configuracion, solo como lo trata
#  Windows. Al final imprime un resumen con lo que quedo bien y lo que no.
# ==================================================================

param(
    [string]$Servicio = "",
    [string]$Nssm = ""
)

$ErrorActionPreference = "Stop"
$fallos = @()
$hechos = @()

function Bien($t) { Write-Host "  [OK]    $t" -ForegroundColor Green; $script:hechos += $t }
function Mal($t)  { Write-Host "  [FALLO] $t" -ForegroundColor Red;   $script:fallos += $t }
function Nota($t) { Write-Host "  [nota]  $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Asegurar el agente de impresion de boletos" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# -- 0. Somos administrador? ---------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host ""
    Write-Host "Hay que ejecutarlo como administrador." -ForegroundColor Red
    Write-Host "Clic derecho en PowerShell -> 'Ejecutar como administrador'." -ForegroundColor Red
    exit 1
}

# -- 1. Encontrar el servicio, se llame como se llame --------------
# Antes esto buscaba nssm.exe primero y se rendia si no lo encontraba.
# Era el orden equivocado: lo que importa es el SERVICIO, y NSSM es solo
# una de las formas de haberlo creado. Ahora se busca el servicio y de
# ahi se deduce con que se instalo.
Write-Host ""
Write-Host "1) Buscando el servicio del agente" -ForegroundColor White

$svcWmi = $null
if ($Servicio) {
    $svcWmi = Get-CimInstance Win32_Service -Filter "Name='$Servicio'" -ErrorAction SilentlyContinue
    if (-not $svcWmi) { Mal "No existe ningun servicio llamado '$Servicio'"; exit 1 }
} else {
    # Por nombre habitual primero
    foreach ($n in @("AgenteImpresionBoletos","AgenteImpresion","PrintAgent")) {
        $c = Get-CimInstance Win32_Service -Filter "Name='$n'" -ErrorAction SilentlyContinue
        if ($c) { $svcWmi = $c; break }
    }
    # Si no, por lo que ejecuta. El patron es estrecho a proposito
    # ("dist\index.js", que es el argumento exacto del agente): con algo
    # mas laxo este script podria "arreglar" el servicio equivocado, y el
    # dueno de esta PC no tendria por que enterarse.
    if (-not $svcWmi) {
        $svcWmi = Get-CimInstance Win32_Service |
            Where-Object { $_.PathName -match "dist[\\/]index\.js" } |
            Select-Object -First 1
    }
}

if (-not $svcWmi) {
    Write-Host ""
    Mal "No hay ningun servicio del agente instalado en esta PC."
    Write-Host ""
    Write-Host "  Lo que tengas corriendo ahora NO es un servicio de Windows:" -ForegroundColor Yellow
    Write-Host "  probablemente sea una ventana de terminal, o un acceso directo" -ForegroundColor Yellow
    Write-Host "  en la carpeta Inicio. Las dos cosas se mueren al cerrar sesion" -ForegroundColor Yellow
    Write-Host "  y ninguna arranca sin que alguien entre a Windows." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Node no puede ser un servicio por si solo (Windows lo mataria" -ForegroundColor Yellow
    Write-Host "  por no responder a las ordenes del sistema). Hace falta un" -ForegroundColor Yellow
    Write-Host "  envoltorio. El mas simple es NSSM:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    1. Bajalo de https://nssm.cc/download (zip 'nssm 2.24')" -ForegroundColor Cyan
    Write-Host "    2. Saca nssm.exe de la carpeta win64\ a C:\nssm\" -ForegroundColor Cyan
    Write-Host "    3. En esta misma ventana de administrador:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "       C:\nssm\nssm.exe install AgenteImpresionBoletos" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    4. En la ventana que se abre:" -ForegroundColor Cyan
    Write-Host "         Path:              C:\Program Files\nodejs\node.exe" -ForegroundColor Cyan
    Write-Host "         Startup directory: la carpeta del agente" -ForegroundColor Cyan
    Write-Host "         Arguments:         dist\index.js" -ForegroundColor Cyan
    Write-Host "       Pestana 'Log on': si la impresora la instalo el cajero," -ForegroundColor Cyan
    Write-Host "       elige 'This account' y pon ESE usuario y su clave." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    5. Vuelve a correr este script." -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$Servicio = $svcWmi.Name
Bien "Servicio encontrado: '$Servicio'"
Write-Host "          ejecuta: $($svcWmi.PathName)"

# -- 2. Deducir si hay NSSM detras ---------------------------------
Write-Host ""
Write-Host "2) Envoltorio del servicio" -ForegroundColor White
$hayNssm = $false
if (-not $Nssm) {
    # La ruta real sale del propio servicio: es infalible y no depende de
    # que nssm.exe este en una carpeta "tipica" ni en el PATH.
    if ($svcWmi.PathName -match '^"?([^"]*nssm\.exe)"?') {
        $Nssm = $Matches[1]
    } else {
        foreach ($c in @("C:\nssm\nssm.exe","C:\nssm\win64\nssm.exe",".\nssm.exe")) {
            if (Test-Path $c) { $Nssm = (Resolve-Path $c).Path; break }
        }
        $enPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
        if (-not $Nssm -and $enPath) { $Nssm = $enPath.Source }
    }
}
if ($Nssm -and (Test-Path $Nssm)) {
    $hayNssm = $true
    Bien "NSSM disponible en $Nssm"
} else {
    Nota "Sin NSSM. No pasa nada: lo esencial se hace con las herramientas"
    Nota "de Windows. Solo se pierden dos extras (reinicio propio de NSSM y"
    Nota "rotacion de su log de arranque)."
}

# -- 3. Arranque automatico ----------------------------------------
Write-Host ""
Write-Host "3) Arranque automatico con la PC" -ForegroundColor White
& sc.exe config $Servicio start= auto | Out-Null
if ($LASTEXITCODE -eq 0) {
    Bien "Arranca solo al encender (sin que nadie inicie sesion)"
} else {
    Mal "No se pudo poner en automatico (codigo $LASTEXITCODE)"
}

# -- 4. Que Windows lo reviva si falla -----------------------------
Write-Host ""
Write-Host "4) Reinicio automatico si falla" -ForegroundColor White
# Ojo: sc.exe con extension. 'sc' a secas es un alias de Set-Content.
& sc.exe failure $Servicio reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Windows lo reintenta a los 5 s, 5 s y 1 min" }
else { Mal "No se pudieron fijar las acciones de recuperacion (codigo $LASTEXITCODE)" }

# Por defecto Windows solo actua si el servicio "se estrella". Con esto
# tambien actua cuando termina con un codigo de error, que es como muere
# un proceso Node que aborta al arrancar (token mal, .env ilegible).
& sc.exe failureflag $Servicio 1 | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Tambien se recupera si termina con error, no solo si se estrella" }
else { Mal "No se pudo activar failureflag (codigo $LASTEXITCODE)" }

if ($hayNssm) {
    & $Nssm set $Servicio AppExit Default Restart | Out-Null
    & $Nssm set $Servicio AppRestartDelay 5000    | Out-Null
    # Si vuelve a morir antes de estos segundos, NSSM lo considera un ciclo
    # de arranques rapidos y espacia los intentos en vez de quemar la CPU.
    & $Nssm set $Servicio AppThrottle 10000       | Out-Null
    Bien "NSSM revive el proceso node a los 5 s (segunda red)"

    & $Nssm set $Servicio AppRotateFiles 1        | Out-Null
    & $Nssm set $Servicio AppRotateOnline 1       | Out-Null
    & $Nssm set $Servicio AppRotateBytes 5242880  | Out-Null
    Bien "Log de arranque de NSSM rotado cada 5 MB"

    # Sin consola para el proceso hijo.
    #
    # NSSM por defecto le asigna una consola. Los servicios corren en la
    # Sesion 0, donde esa asignacion puede fallar -- y cuando falla, node
    # muere cargando sus DLLs, ANTES de ejecutar una sola linea de codigo.
    # Se ve como exit code 3221225794 (0xC0000142, STATUS_DLL_INIT_FAILED),
    # con AppStdout y AppStderr vacios (no hubo proceso que escribiera) y
    # el servicio en PAUSED. Diagnosticarlo cuesta una hora larga.
    #
    # El agente no necesita consola en ninguna parte, asi que se quita
    # siempre y no solo en las maquinas donde falla. Se aplica en el
    # siguiente arranque; si el servicio ya funciona, no se rompe nada.
    & $Nssm set $Servicio AppNoConsole 1          | Out-Null
    Bien "Sin consola en Sesion 0 (evita el fallo 0xC0000142 al arrancar)"
}

# -- 5. Energia: que la PC no se duerma ----------------------------
Write-Host ""
Write-Host "5) Energia" -ForegroundColor White
& powercfg /change standby-timeout-ac 0    | Out-Null
& powercfg /change hibernate-timeout-ac 0  | Out-Null
& powercfg /change disk-timeout-ac 0       | Out-Null
Bien "La PC ya no se suspende ni hiberna estando enchufada"

& powercfg /change monitor-timeout-ac 15   | Out-Null
Bien "La pantalla si se apaga a los 15 min (eso no afecta la impresion)"

# Suspension selectiva de USB: Windows apaga el puerto y la impresora
# deja de responder hasta que alguien la desenchufa.
$SUB_USB = "2a737441-1930-4402-8d77-b2bebba308a3"
$SETTING = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226"
& powercfg /setacvalueindex SCHEME_CURRENT $SUB_USB $SETTING 0 | Out-Null
& powercfg /setactive SCHEME_CURRENT | Out-Null
if ($LASTEXITCODE -eq 0) { Bien "Suspension selectiva de USB desactivada" }
else { Mal "No se pudo desactivar la suspension selectiva de USB" }

# -- 6. Arrancarlo si esta parado ----------------------------------
Write-Host ""
Write-Host "6) Estado actual" -ForegroundColor White
$svc = Get-Service -Name $Servicio

# PAUSED no es "alguien lo pauso": es NSSM estrangulando reintentos porque
# el programa muere nada mas arrancar. Y sobre un servicio pausado
# Start-Service NO dice eso -- falla con "no pudo iniciarse" o con el
# error 1056 ("ya se esta ejecutando"), que apunta justo al reves. Hay que
# sacarlo del estado con nssm, que es quien lo entiende.
if ($svc.Status -eq "Paused") {
    Nota "El servicio esta en PAUSA. No lo pauso nadie: es NSSM conteniendo"
    Nota "reintentos porque el programa se muere nada mas arrancar."
    if ($hayNssm) {
        & $Nssm stop $Servicio | Out-Null
        Start-Sleep -Seconds 2
        $svc.Refresh()
    }
}

if ($svc.Status -ne "Running") {
    Nota "Estaba en '$($svc.Status)'. Arrancando..."
    try {
        Start-Service -Name $Servicio
        Start-Sleep -Seconds 3
        $svc.Refresh()
    } catch {
        Mal "No arranco: $($_.Exception.Message)"
    }
}
if ($svc.Status -eq "Running") {
    Bien "Corriendo ahora mismo"
} else {
    Mal "No esta corriendo (estado: $($svc.Status))"

    # "No arranco" a secas no sirve de nada a las 8 de la manana en un
    # mostrador. Casi siempre el motivo es una ruta que no existe -- la
    # carpeta se dejo con otro nombre, o Node esta en Program Files (x86)
    # y se copio la ruta de 64 bits -- y eso se puede comprobar aqui
    # mismo. Ademas, cuando AppDirectory no existe NSSM tampoco puede
    # crear su log de errores, asi que el fallo no deja NINGUN rastro:
    # sin esta comprobacion no hay ni por donde empezar.
    Write-Host ""
    Write-Host "  Revisando las causas mas comunes:" -ForegroundColor Yellow

    # Todo el diagnostico va dentro de un try: si algo aqui explota, se
    # pierde la unica pista que tiene quien esta delante de la maquina.
    # Un diagnostico que se cae es peor que no tener diagnostico.
    try {
    if ($hayNssm) {
        # Ojo con el nombre: $args es una variable automatica de PowerShell
        # (los argumentos de la funcion actual). Pisarla funciona por
        # casualidad hasta que deja de funcionar.
        #
        # Y el Trim de nulos no es paranoia: nssm devuelve las cadenas
        # terminadas en \0 y sin quitarlos el Test-Path falla sobre una
        # ruta que SI existe -- justo el diagnostico al reves.
        $limpiar = [char[]]@([char]0, ' ', '"')
        $app        = ((& $Nssm get $Servicio Application)   -join "").Trim($limpiar)
        $dir        = ((& $Nssm get $Servicio AppDirectory)  -join "").Trim($limpiar)
        $parametros = ((& $Nssm get $Servicio AppParameters) -join "").Trim($limpiar)

        Write-Host "    Programa:  $app"
        if ($app -and -not (Test-Path $app)) {
            Mal "Ese node.exe NO existe. Busca el bueno con: (Get-Command node).Source"
        }

        Write-Host "    Carpeta:   $dir"
        if ($dir -and -not (Test-Path $dir)) {
            Mal "Esa carpeta NO existe. Es la causa numero uno."
            Write-Host "      Renombra la carpeta del agente a '$dir', o corrige el" -ForegroundColor Yellow
            Write-Host "      servicio con:" -ForegroundColor Yellow
            Write-Host "        $Nssm set $Servicio AppDirectory `"<carpeta real>`"" -ForegroundColor Cyan
        }

        Write-Host "    Argumento: $parametros"
        if ($dir -and (Test-Path $dir) -and $parametros) {
            $entrada = Join-Path $dir $parametros
            if (-not (Test-Path $entrada)) {
                Mal "No existe $entrada (falta la carpeta dist?)"
            }
        }

        if ($dir -and (Test-Path $dir)) {
            if (-not (Test-Path (Join-Path $dir ".env"))) {
                Mal "Falta el archivo .env en $dir"
                Write-Host "      Copia env.example a .env y pon API_URL y ESTACION_TOKEN." -ForegroundColor Yellow
            }
        }
    }

    # El registro de eventos de Aplicacion, que es donde escribe NSSM.
    #
    # Esto va ANTES de mirar los .log a proposito. AppStdout y AppStderr
    # solo capturan lo que escribe el proceso HIJO: si el hijo no llega a
    # nacer, quedan vacios -- y un archivo vacio se lee como "no pasa
    # nada" cuando significa exactamente lo contrario. Los errores del
    # propio NSSM (por que no pudo lanzar el programa, con que codigo
    # murio) viven aqui y en ningun otro sitio.
    $eventos = @(Get-EventLog -LogName Application -Newest 80 -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -match "nssm" -and $_.Message -match [regex]::Escape($Servicio) } |
        Select-Object -First 6)

    if ($eventos.Count -gt 0) {
        Write-Host ""
        Write-Host "  Lo que dice NSSM en el registro de eventos:" -ForegroundColor Yellow
        foreach ($ev in $eventos) {
            foreach ($linea in ($ev.Message -split "`r?`n")) {
                if ($linea.Trim()) { Write-Host "    $($linea.Trim())" }
            }
        }

        # Traduccion de los codigos que de verdad aparecen. En crudo son
        # numeros de diez digitos que no le dicen nada a nadie.
        $conocidos = @{
            "3221225794" = "0xC0000142 STATUS_DLL_INIT_FAILED: el proceso muere cargando sus DLLs, antes de ejecutar codigo. En un servicio suele ser la consola de la Sesion 0 -> se arregla con: nssm set $Servicio AppNoConsole 1"
            "3221225781" = "0xC0000135 STATUS_DLL_NOT_FOUND: falta una DLL. Reinstala Node."
            "1"          = "El agente aborto por configuracion: falta API_URL o ESTACION_TOKEN en el .env."
            "3"          = "ERROR_PATH_NOT_FOUND: alguna ruta del servicio no existe (ver arriba)."
        }
        foreach ($clave in $conocidos.Keys) {
            if ($eventos.Message -match "code $clave\b") {
                Write-Host ""
                Write-Host "    -> $($conocidos[$clave])" -ForegroundColor Cyan
            }
        }
    }

    foreach ($log in @("nssm-errores.log","agente.log")) {
        $ruta = Join-Path (Get-Location) $log
        if (Test-Path $ruta) {
            $contenido = @(Get-Content $ruta -Tail 8)
            Write-Host ""
            if ($contenido.Count -eq 0) {
                Write-Host "  $log existe pero esta VACIO." -ForegroundColor Yellow
                Write-Host "    Eso no es buena senal: significa que el proceso no llego a" -ForegroundColor Yellow
                Write-Host "    escribir nada. Mira el registro de eventos de arriba." -ForegroundColor Yellow
            } else {
                Write-Host "  Ultimas lineas de $log :" -ForegroundColor Yellow
                $contenido | ForEach-Object { Write-Host "    $_" }
            }
        }
    }
    } catch {
        Write-Host "  (no se pudo completar el diagnostico: $($_.Exception.Message))" -ForegroundColor Yellow
    }
}

# -- 7. Con que cuenta corre ---------------------------------------
Write-Host ""
Write-Host "7) Cuenta de Windows del servicio" -ForegroundColor White
Write-Host "  Corre como: $($svcWmi.StartName)"
if ($svcWmi.StartName -match "LocalSystem|NT AUTHORITY") {
    Nota "Es una cuenta de sistema. No ve las impresoras instaladas por un"
    Nota "usuario normal. Si la impresora es de tipo 'windows' y no imprime,"
    Nota "cambiala a la cuenta del cajero (NSSM, pestana 'Log on')."
} else {
    Nota "Es una cuenta de usuario. Si a esa cuenta le CADUCA o le cambian la"
    Nota "contrasena de Windows, el servicio deja de arrancar y no es evidente."
    Nota "Ponle contrasena que no expire."
}

# -- Resumen -------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
if ($fallos.Count -eq 0) {
    Write-Host " TODO LISTO - $($hechos.Count) comprobaciones correctas" -ForegroundColor Green
    Write-Host ""
    Write-Host " El personal no tiene que tocar nada nunca. Apagar y" -ForegroundColor Green
    Write-Host " encender la PC es suficiente." -ForegroundColor Green
} else {
    Write-Host " QUEDARON $($fallos.Count) COSAS SIN ARREGLAR:" -ForegroundColor Red
    foreach ($f in $fallos) { Write-Host "   - $f" -ForegroundColor Red }
}
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Falta una cosa que NO se puede hacer por software:" -ForegroundColor Yellow
Write-Host "si se va la luz, la PC no vuelve sola al regresar la corriente."
Write-Host "Se activa en la BIOS: 'Restore on AC Power Loss' -> Power On"
Write-Host "(a veces 'AC Back' o 'After Power Failure'). Sin eso, alguien"
Write-Host "tiene que apretar el boton - que es justo lo que se quiere evitar."
Write-Host ""
Write-Host "Para comprobarlo de verdad: reinicia la PC, no inicies sesion y,"
Write-Host "desde el sistema, mira que la estacion salga conectada en la"
Write-Host "pantalla Estaciones al cabo de un minuto."
Write-Host ""
