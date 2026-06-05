const FailoverAgent = require('./agent/failoverAgent');

const agent = new FailoverAgent();
agent.callAPI("openai", {})
  .then(response => console.log("Respuesta final:", response))
  .catch(err => console.error("Error final:", err));