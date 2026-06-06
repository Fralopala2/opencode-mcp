const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const path = require('path');
const execPromise = util.promisify(exec);

class FailoverAgent {
  constructor(env = 'prod') {
    this.env = env;
    this.config = JSON.parse(fs.readFileSync('config/apis.json'));
    // Si es prod usa OpenCode local, si es test usa el mock
    this.opencodeEndpoint = env === 'test' ? 'http://localhost:3002/mock-api' : 'http://127.0.0.1:4096/v1/chat/completions';
  }

  async callAPI(providerName, requestData) {
    let currentProvider = providerName;
    let currentRequestData = { ...requestData };
    const getKeyStr = (item) => (typeof item === 'string' ? item : item?.key);
    const isKeyFailed = (item) => (typeof item === 'string' ? false : !!item?.failed);
    
    // Intentamos hasta que encontremos una clave exitosa o se agoten todos los proveedores
    while (true) {
      const keys = this.config[currentProvider] || [];
      
      // 1. Obtener la clave activa actual desde auth.json
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
      let activeKey;
      if (fs.existsSync(authPath)) {
        try {
          const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
          activeKey = auth[currentProvider]?.key;
        } catch (e) {
          console.error('[FailoverAgent] Error leyendo auth.json:', e.message);
        }
      }

      // 2. Determinar el siguiente índice de clave
      let nextIndex = 0;
      if (activeKey) {
        const idx = keys.findIndex(item => getKeyStr(item) === activeKey);
        if (idx !== -1) {
          nextIndex = idx + 1;
        }
      }

      let nextApiKey;
      let foundIdx = -1;
      for (let i = nextIndex; i < keys.length; i++) {
        if (!isKeyFailed(keys[i])) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx !== -1) {
        nextApiKey = getKeyStr(keys[foundIdx]);
      } else {
        // Rotar al siguiente proveedor
        const providers = Object.keys(this.config);
        const currentProvIdx = providers.indexOf(currentProvider);
        let found = false;

        for (let i = 1; i <= providers.length; i++) {
          const nextProvIdx = (currentProvIdx + i) % providers.length;
          const prov = providers[nextProvIdx];
          const provKeys = this.config[prov] || [];
          const activeKeyItem = provKeys.find(item => !isKeyFailed(item));
          if (activeKeyItem) {
            currentProvider = prov;
            nextApiKey = getKeyStr(activeKeyItem);
            found = true;
            break;
          }
        }

        if (!found || !nextApiKey) {
          throw new Error(`Todas las keys de todos los proveedores han fallado.`);
        }
      }

      try {
        console.log(`[FailoverAgent] Enviando petición a OpenCode local... (Proveedor: ${currentProvider})`);
        
        const response = await axios({
          method: 'POST',
          url: this.opencodeEndpoint,
          data: currentRequestData,
          timeout: 10000
        });
        
        console.log(`[FailoverAgent] ¡Éxito! OpenCode procesó la petición.`);
        return response.data;

      } catch (error) {
        const errorObj = error.response?.data || error;
        let errMsg = '';
        if (errorObj && typeof errorObj.error === 'string') {
          errMsg = errorObj.error;
        } else if (errorObj && errorObj.error && typeof errorObj.error.message === 'string') {
          errMsg = errorObj.error.message;
        } else if (errorObj && typeof errorObj.message === 'string') {
          errMsg = errorObj.message;
        } else {
          errMsg = typeof errorObj === 'string' ? errorObj : JSON.stringify(errorObj);
        }
        console.error(`[FailoverAgent] OpenCode devolvió un error:`, errMsg);
        
        console.log(`[FailoverAgent] Cambiando OpenCode a la siguiente key/proveedor...`);
        
        // Marcar la clave fallida en config/apis.json
        if (activeKey) {
          const keysList = this.config[currentProvider] || [];
          const keyIdx = keysList.findIndex(item => getKeyStr(item) === activeKey);
          if (keyIdx !== -1) {
            keysList[keyIdx] = {
              key: activeKey,
              failed: true,
              error: errMsg,
              failedAt: new Date().toISOString()
            };
            try {
              fs.writeFileSync('config/apis.json', JSON.stringify(this.config, null, 2), 'utf8');
              console.log(`[FailoverAgent] Llave fallida marcada en apis.json.`);
            } catch (err) {
              console.error("[FailoverAgent] Error al escribir apis.json:", err.message);
            }
          }
        }

        // 3. Escribir la nueva clave en auth.json
        if (fs.existsSync(authPath)) {
          try {
            const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (!auth[currentProvider]) {
              auth[currentProvider] = { type: 'api' };
            }
            auth[currentProvider].key = nextApiKey;
            fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
            console.log(`[FailoverAgent] Clave actualizada en auth.json.`);
          } catch (err) {
            console.error("[FailoverAgent] Error al escribir en auth.json:", err.message);
          }
        }

        // 4. Si es prod, reiniciar el servidor local de OpenCode para cargar cambios
        if (this.env !== 'test') {
          console.log(`[FailoverAgent] Reiniciando servidor local de OpenCode...`);
          try {
            if (process.platform === 'win32') {
              await execPromise('taskkill /F /IM opencode.exe').catch(() => {});
              await execPromise('taskkill /F /IM node.exe /FI "WINDOWTITLE eq opencode*"').catch(() => {});
            } else {
              await execPromise('pkill -f "opencode serve"').catch(() => {});
            }
            await new Promise(r => setTimeout(r, 1000));
            const { spawn } = require('child_process');
            const proc = spawn('opencode', ['serve', '--port=4096'], {
              shell: true,
              detached: true,
              stdio: 'ignore'
            });
            proc.unref();
            await new Promise(r => setTimeout(r, 2000));
            console.log(`[FailoverAgent] Servidor de OpenCode reiniciado.`);
          } catch (err) {
            console.error("[FailoverAgent] Error al reiniciar OpenCode:", err.message);
          }
        } else {
          // En test, solo esperamos un momento para simular
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }
}

module.exports = FailoverAgent;