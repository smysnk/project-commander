const { createGoMasterRuntimeBackend } = require('./backends/goMasterRuntimeBackend');

const GO_MASTER_RUNTIME_BACKEND = 'go-master';

const normalizeBackendName = () => GO_MASTER_RUNTIME_BACKEND;

const createRuntimeBackend = () => createGoMasterRuntimeBackend();

module.exports = {
  createRuntimeBackend,
  normalizeBackendName,
};
