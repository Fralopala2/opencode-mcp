const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');

class FailoverAgent {
  constructor() {
    this.config = JSON.parse(fs.readFileSync('config/apis.json'));
  }

  async callAPI(providerName, requestData) {
    const providerList = this.config.providers[providerName];
    let currentIndex = 0;

    while (currentIndex < providerList.length) {
      const api = providerList[currentIndex];
      try {
        console.log(`Intentando con ${api.id} (${api.endpoint})...`);
        const response = await axios({
          method: 'GET',
          url: api.endpoint,
          headers: { Authorization: `Bearer ${api.api_key}` },
          data: requestData
        });
        console.log(`Éxito con ${api.id}!`);
        return response.data;
      } catch (error) {
        console.error(`Error con ${api.id}:`, error.response?.data || error.message);
        if (currentIndex < providerList.length - 1) {
          const nextApi = providerList[currentIndex + 1];
          console.log(`Cambiaré a ${nextApi.id}...`);
          // Ejecutar comando /connect en OpenCode
          exec(`opencode /connect ${providerName} --api ${nextApi.id}`, (err) => {
            if (err) console.error("Error al ejecutar /connect:", err);
          });
        } else {
          throw new Error("Todas las APIs fallaron");
        }
        currentIndex++;
      }
    }
  }
}

module.exports = FailoverAgent;