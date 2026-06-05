# OpenCode Panel (VS Code)

Extensión de VS Code que integra un **panel lateral de chat** con tu instancia local de **OpenCode**, permitiendo interactuar con tus **agents**, **skills**, **MCP** y **providers** configurados en `~/.config/opencode/opencode.jsonc`.

Inspirada en [OpenCode UX+](https://marketplace.visualstudio.com/items?itemName=paviko.opencode-ux-plus), pero sin incluir un binario adicional. Utiliza directamente la CLI `opencode` disponible en tu `PATH`.

## Características

- **Conexión directa** con tu servidor local de OpenCode.
- **Interfaz de chat** integrada en el panel lateral de VS Code.
- **Gestión de contexto**: añade archivos, selecciones o todos los archivos abiertos al contexto de la conversación.
- **Autenticación básica** para servidores protegidos.
- **Auto-inicio del servidor** si no está en ejecución.
- **Soporte para múltiples sesiones** de chat.

## Requisitos

- [OpenCode CLI](https://opencode.ai/) instalado y disponible en el `PATH`.
- VS Code 1.85 o superior.
- Carpeta de workspace abierta (recomendado).

## Instalación y uso

### Instalación

1. Clona este repositorio.
2. Ejecuta `npm install` para instalar las dependencias.
3. Compila la extensión con `npm run compile`.

### Uso

1. Abre el proyecto en VS Code.
2. Pulsa **F5** para iniciar el **Extension Development Host** o empaqueta la extensión con `npm run package` e instálala manualmente.
3. Abre el panel de OpenCode desde la barra de actividad (icono de OpenCode) o usando el atajo `Ctrl+Alt+O`.
4. Escribe tu consulta en el panel de chat y envíala con **Enviar** o `Ctrl+Enter`.

Si el servidor de OpenCode no está en ejecución y la opción `opencode.autoStartServer` está activada (valor por defecto), la extensión iniciará automáticamente el servidor con `opencode serve` en el puerto configurado.

## Gestión de contexto

Puedes añadir contenido al contexto de la conversación para que OpenCode lo tenga en cuenta al responder:

| Acción | Atajo | Comando |
|--------|-------|---------|
| Añadir archivo actual | `Ctrl+Alt+Shift+F` | OpenCode: Añadir archivo actual al contexto |
| Añadir selección | `Ctrl+Alt+Shift+S` | OpenCode: Añadir selección al contexto |
| Añadir todos los abiertos | — | OpenCode: Añadir archivos abiertos al contexto |

También puedes acceder a estas opciones desde el **menú contextual** del editor o del explorador de archivos.

## Configuración

La extensión ofrece las siguientes opciones de configuración:

| Configuración | Valor por defecto | Descripción |
|---------------|-------------------|-------------|
| `opencode.serverUrl` | `http://127.0.0.1:4096` | URL del servidor OpenCode. |
| `opencode.serverPort` | `4096` | Puerto utilizado al iniciar el servidor automáticamente. |
| `opencode.autoStartServer` | `true` | Iniciar el servidor automáticamente si no está en ejecución. |
| `opencode.serverUsername` | `opencode` | Usuario para autenticación básica HTTP (si se usa contraseña). |
| `opencode.serverPassword` | `""` | Contraseña para autenticación básica HTTP (definida en `OPENCODE_SERVER_PASSWORD`). |
| `opencode.defaultAgent` | `""` | Nombre del agente por defecto (según tu configuración de OpenCode). |
| `opencode.autoApprovePermissions` | `false` | Aprobar automáticamente permisos para comandos bash o edición de archivos. |
| `opencode.bin` | `""` | Ruta al ejecutable de OpenCode (vacío = auto-detección en Windows/npm). |

## Conexión con OpenCode

La extensión se comunica con el servidor de OpenCode a través de su [HTTP API](https://opencode.ai/docs/server/):

- `GET /global/health`: Comprueba el estado del servidor.
- `POST /session`: Inicia una sesión de chat por workspace.
- `POST /session/:id/prompt_async`: Envía un mensaje al servidor (utiliza tus agents/MCP configurados).
- `GET /event`: Recibe el streaming de respuestas.
- `GET /agent`: Lista los agents disponibles en tu configuración.

Los **MCP** (Micro-Core Protocols) se gestionan directamente desde tu configuración de OpenCode, por lo que no es necesario configurarlos en la extensión.

## Comandos disponibles

| Comando | Descripción |
|--------|-------------|
| `opencode.ask` | Abre el panel de chat de OpenCode. |
| `opencode.reconnect` | Reconocta al servidor de OpenCode. |
| `opencode.newSession` | Inicia una nueva sesión de chat. |
| `opencode.addFileToContext` | Añade el archivo actual al contexto. |
| `opencode.addSelectionToContext` | Añade la selección actual al contexto. |
| `opencode.addOpenFilesToContext` | Añade todos los archivos abiertos al contexto. |

## Desarrollo

Para contribuir al desarrollo de la extensión:

1. Instala las dependencias:
   ```bash
   npm install
   ```

2. Compila el proyecto:
   ```bash
   npm run compile
   ```

3. Durante el desarrollo, usa el modo watch para compilar automáticamente los cambios:
   ```bash
   npm run watch
   ```

4. Ejecuta las pruebas (si están disponibles):
   ```bash
   npm test
   ```

5. Para empaquetar la extensión:
   ```bash
   npm run package
   ```

## Estructura del proyecto

- **`src/`**: Contiene el código fuente de la extensión.
  - `extension.ts`: Punto de entrada principal.
  - `opencodeService.ts`: Lógica para la comunicación con el servidor de OpenCode.
  - `chatViewProvider.ts`: Implementación del panel de chat.
  - `serverProcess.ts`: Gestión del proceso del servidor de OpenCode.
  - `httpClient.ts`: Cliente HTTP para las solicitudes al servidor.
  - `contextAttachments.ts`: Lógica para manejar el contexto de archivos y selecciones.
  - `settings.ts`: Gestión de la configuración de la extensión.
  - `types.ts`: Definiciones de tipos TypeScript.

- **`package.json`**: Configuración del proyecto y dependencias.

## Solución de problemas

- **OpenCode no responde:** Verifica que `opencode.autoStartServer` esté activo o ejecuta `opencode serve`.
- **Error de conexión (Timeout):** Asegúrate de que el puerto de `opencode.serverPort` esté libre.
- **Error de autenticación:** Ingresa la contraseña en `opencode.serverPassword` si tu servidor la requiere.
- **Bloqueo por permisos:** Activa `opencode.autoApprovePermissions` o aprueba manualmente si el chat se cuelga.

## Licencia

MIT
