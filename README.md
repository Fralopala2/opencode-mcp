<div align="center">
  <img src="resources/logo.png" alt="OpenCode Panel Logo" width="300" />
</div>

# OpenCode Panel (VS Code / Antigravity)

Extensión de VS Code / Antigravity (+ todos los IDE que soporten instalacion via .vsix) que integra un **panel lateral de chat** con tu instancia local de **OpenCode**, permitiendo interactuar con tus **agents**, **skills**, **MCP** y **providers** configurados en `~/.config/opencode/opencode.jsonc`.

<div align="center">
  <img src="resources/1.png" alt="Panel de Chat 1" height="300" style="vertical-align: middle; margin: 0 10px;" />
  <img src="resources/2.png" alt="Panel de Chat 2" height="300" style="vertical-align: middle; margin: 0 10px;" />
  <img src="resources/3.png" alt="Panel de Chat 3" height="300" style="vertical-align: middle; margin: 0 10px;" />
</div>


## Características

- **Conexión directa** con tu servidor local de OpenCode.
- **Interfaz de chat** integrada en el panel lateral de VS Code.
- **Gestión de contexto**: añade archivos, selecciones o todos los archivos abiertos al contexto de la conversación.
- **Autenticación básica** para servidores protegidos.
- **Auto-inicio del servidor** si no está en ejecución.
- **Soporte para múltiples sesiones** de chat.
- **Historial persistente**: las sesiones se guardan y asocian automáticamente al workspace (proyecto) actual, manteniéndose entre reinicios.
- **Gestión de errores detallada**: los mensajes de error de los proveedores (ej. cuota excedida, saldo insuficiente) se parsean y muestran nativamente en el chat.
- **Adaptador MCP** (`opencode-adapter.mjs`) para acceder a OpenCode desde otros clientes MCP mediante la herramienta `ask_opencode`.
- **Agente de Failover y Balanceo API** (`FailoverAgent`) para rotar llaves de API automáticamente al detectar fallos o límites de cuota (429), con persistencia del modelo de respaldo sin mutar la selección original del usuario.
- **Panel de costos acumulativos**: seguimiento en tiempo real del costo por sesión agrupado por fecha y modelo, con soporte multi-moneda (USD/EUR) y persistencia en `costData.json`.
- **Seguridad reforzada**: CSP restrictiva en el webview, sanitización de salida HTML, comandos sin shell (`execFile`), y rutas de auth configurables vía `OPENCODE_AUTH_PATH`.
- **Robustez y estabilidad**: Timeout de 3 minutos con cancelación automática, reconexión automática (hasta 3 intentos con backoff exponencial), failover de API keys con rotación entre proveedores, parsing SSE tolerante a CRLF/LF, y detección de caídas de conexión SSE para no dejar el chat colgado.

## Requisitos

- [OpenCode CLI](https://opencode.ai/) instalado y disponible en el `PATH`.
- Node.js (para la ejecución del adaptador MCP y scripts de Failover).
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

## Herramientas y Agentes

Al estar conectado directamente a OpenCode, el panel hereda todas sus herramientas (Tools/MCP) permitiendo al LLM interactuar con tu entorno:

### Herramientas Nativas (Tools)
- **Sistema y archivos**: Ejecución de comandos (`bash`), búsqueda (`glob`, `grep`), lectura (`read`), edición (`edit`) y escritura (`write`).
- **Memoria persistente**: Gestión de contexto a largo plazo (`mem_save`, `mem_search`, `mem_context`, `mem_update`).
- **Tareas complejas**: Delegación de subtareas (`task`) y listas de TODOs (`todowrite`).
- **Web y UI**: Acceso a internet (`webfetch`) y preguntas interactivas (`question`).
- **Skills**: Habilidades especializadas personalizadas (`skill`).

### Adaptador MCP (OpenCode MCP Server)
El archivo `opencode-adapter.mjs` funciona como un servidor [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) que permite a clientes MCP comunicarse con tu servidor OpenCode local.
- Expone la tool `ask_opencode` para el envío de consultas de manera estructurada.
- Se comunica por `stdio`, arranca automáticamente `opencode serve` si no está encendido, y devuelve respuestas de los agentes y herramientas de OpenCode.

### Agente Failover y Balanceo de API (`FailoverAgent`)
Ubicado en `src/agent/failoverAgent.js`, es una solución local para garantizar resiliencia en llamadas al LLM.
- **Configuración:** Define listas de llaves API en `config/apis.json` por proveedor (ej. `openai`).
- **Rotación Automática:** Si la API devuelve error HTTP 429 (Rate Limit) o > 500, el agente cambia dinámicamente a la siguiente llave usando el comando `opencode /connect <provider> --key <next-key>` y reintenta la petición.

## Gestión de contexto

Puedes añadir contenido al contexto de la conversación para que OpenCode lo tenga en cuenta al responder utilizando los botones de la interfaz del chat o los siguientes atajos:

| Acción | Atajo | Comando |
|--------|-------|---------|
| Añadir archivo actual | `Ctrl+Alt+Shift+F` | OpenCode: Añadir archivo actual al contexto |
| Añadir selección | `Ctrl+Alt+Shift+S` | OpenCode: Añadir selección al contexto |
| Añadir todos los abiertos | — | OpenCode: Añadir archivos abiertos al contexto |
| Adjuntar carpeta | — | *(Desde el botón en la interfaz de chat)* |

También puedes acceder a estas opciones desde el **menú contextual** del editor o del explorador de archivos.

## Panel de Costos Acumulativos

El panel de costos muestra el gasto acumulado de tus interacciones con los LLMs, agrupado por fecha y modelo.

### Características
- **Cálculo automático**: cada respuesta del asistente registra los tokens de entrada y salida y calcula el costo según el modelo utilizado.
- **Agrupación por fecha y modelo**: los costos se organizan por día y por modelo de LLM.
- **Multi-moneda**: muestra el costo en USD y EUR (tasa fija EUR = USD × 0.92).
- **Persistencia**: los datos se guardan en `costData.json` en la raíz del proyecto y se cargan automáticamente al abrir el chat.
- **Panel ocultable**: botón de mostrar/ocultar en la barra superior del chat.

### Precios por modelo

| Modelo | Precio Input (por 1M tokens) | Precio Output (por 1M tokens) |
|--------|------------------------------|-------------------------------|
| `mistral-medium-latest` | $2.00 | $6.00 |
| Default (otros) | $2.00 | $6.00 |

### Funcionamiento
1. Al abrir el chat, el panel carga los costos históricos desde `costData.json`.
2. Cada respuesta del asistente acumula el costo automáticamente (tanto en el frontend como en el backend).
3. El backend persiste los costos en `costData.json` tras cada interacción.
4. Puedes ocultar/mostrar el panel con el botón `$` en la barra superior.

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
| `opencode.quickActions` | `[...]` | Acciones rápidas personalizadas en la pantalla de bienvenida. |

## Conexión con OpenCode LOCAL

La extensión se comunica con tu **instancia local de OpenCode** (que se inicia con `opencode serve`) a través de su HTTP API local (por defecto en `http://127.0.0.1:4096`):

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
| `opencode.reconnect` | Reconecta al servidor de OpenCode. |
| `opencode.newSession` | Inicia una nueva sesión de chat (equivalente al botón **Limpiar chat** de la interfaz). |
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
  - `agent/failoverAgent.js`: Lógica de balanceo de API y rotación de keys.
  - `opencode-adapter.mjs`: Servidor MCP que expone OpenCode.
  - `config/apis.json`: Configuración de llaves maestras para Failover.
  - `costData.json`: Archivo de persistencia de costos acumulativos (generado automáticamente).
  - `resources/webview/`: Contiene los assets del frontend del chat.
    - `index.html`: Estructura HTML del panel de chat (incluye el panel de costos).
    - `main.js`: Lógica del frontend (manejo de mensajes, renderizado, cálculo de costos).
    - `styles.css`: Estilos del panel de chat.
  - `package.json`: Configuración del proyecto y dependencias.

## Solución de problemas

- **OpenCode no responde:** Verifica que `opencode.autoStartServer` esté activo o ejecuta `opencode serve`.
- **Error de conexión (Timeout):** Asegúrate de que el puerto de `opencode.serverPort` esté libre.
- **Error de autenticación:** Ingresa la contraseña en `opencode.serverPassword` si tu servidor la requiere.
- **Bloqueo por permisos:** Activa `opencode.autoApprovePermissions` o aprueba manualmente si el chat se cuelga.

## Licencia

MIT
