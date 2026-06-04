# OpenCode Panel (VS Code)

Extensión de VS Code que conecta un **panel lateral de chat** con tu **OpenCode local** — la misma instancia donde tienes configurados agents, skills, MCP y providers en `~/.config/opencode/opencode.jsonc`.

Inspirada en [OpenCode UX+](https://marketplace.visualstudio.com/items?itemName=paviko.opencode-ux-plus), pero sin empaquetar otro binario: usa **tu** CLI `opencode` del PATH.

## Requisitos

- [OpenCode CLI](https://opencode.ai/) instalado y en el `PATH`
- VS Code 1.85+
- Carpeta de workspace abierta (recomendado)

## Uso rápido

1. Compila: `npm run compile`
2. Pulsa **F5** (Extension Development Host) o instala el `.vsix` con `npm run package`
3. Abre el icono **OpenCode** en la barra de actividad, o `Ctrl+Alt+O`
4. Escribe en el panel y envía con **Enviar** o **Ctrl+Enter**

Si no hay servidor en marcha y `opencode.autoStartServer` está activo (por defecto), la extensión ejecuta `opencode serve` en el puerto configurado.

## Contexto (como UX+)

| Acción | Atajo | Comando |
|--------|-------|---------|
| Añadir archivo actual | `Ctrl+Alt+Shift+F` | OpenCode: Añadir archivo actual al contexto |
| Añadir selección | `Ctrl+Alt+Shift+S` | OpenCode: Añadir selección al contexto |
| Añadir todos los abiertos | — | OpenCode: Añadir archivos abiertos al contexto |

También desde el menú contextual del editor o del explorador de archivos.

## Configuración

| Setting | Default | Descripción |
|---------|---------|-------------|
| `opencode.serverUrl` | `http://127.0.0.1:4096` | URL del servidor OpenCode |
| `opencode.serverPort` | `4096` | Puerto al auto-arrancar `opencode serve` |
| `opencode.autoStartServer` | `true` | Arrancar servidor si no responde |
| `opencode.serverUsername` | `opencode` | Basic auth (si usas contraseña) |
| `opencode.serverPassword` | `""` | Basic auth (`OPENCODE_SERVER_PASSWORD`) |
| `opencode.defaultAgent` | `""` | Agente por defecto (nombre en tu config) |
| `opencode.autoApprovePermissions` | `false` | Aprobar permisos bash/edición sin preguntar |

## Cómo se conecta

La extensión habla con la [HTTP API de OpenCode](https://opencode.ai/docs/server/):

- `GET /global/health` — comprobar servidor
- `POST /session` — conversación por workspace
- `POST /session/:id/prompt_async` — enviar mensaje (usa tus agents/MCP)
- `GET /event` — streaming de respuesta
- `GET /agent` — listar agents de tu configuración

Los **MCP** los gestiona OpenCode en tu config; no hace falta configurarlos en la extensión.

## Desarrollo

```bash
npm install
npm run compile
npm run watch   # durante desarrollo
```

## Licencia

MIT
