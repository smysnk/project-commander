const runtimeManager = require('../../runtimeManager');

const createJSRuntimeBackend = () => ({
  name: 'js',
  async getBackendInfo() {
    return {
      name: 'js',
      displayName: 'JavaScript Runtime Manager',
      masterAgent: null,
    };
  },
  async listRegisteredHosts() {
    return [];
  },

  async listDiscoveredProjects() {
    return [];
  },

  async checkoutHostProject() {
    throw new Error('Host checkout is only supported in go-master mode.');
  },

  async toggleProjectRuntime(args) {
    return runtimeManager.toggleProjectRuntime(args);
  },

  async toggleServiceRuntime(args) {
    return runtimeManager.toggleServiceRuntime(args);
  },

  async getProjectRuntime(projectPath) {
    return runtimeManager.getProjectRuntime(projectPath);
  },

  async getProjectLogs(args) {
    return runtimeManager.getProjectLogs(args);
  },

  async getSlaveLogs() {
    return [];
  },

  async getManagedProcessLogs() {
    return [];
  },

  async getProjectLaunchEnvironment(projectPath) {
    return runtimeManager.getProjectLaunchEnvironment(projectPath);
  },

  async getProjectPortRangeSettings(projectPath) {
    return runtimeManager.getProjectPortRangeSettings(projectPath);
  },

  async setProjectPortRangeSettings(args) {
    return runtimeManager.setProjectPortRangeSettings(args);
  },

  async getProjectProcessStats(projectPath) {
    return runtimeManager.getProjectProcessStats(projectPath);
  },

  setRuntimeEventSink(sink) {
    runtimeManager.setRuntimeEventSink(sink);
  },

  start() {
    runtimeManager.startPidMonitor();
  },

  async stopServiceByProcessId(processId) {
    return runtimeManager.stopServiceByProcessId(processId);
  },
});

module.exports = {
  createJSRuntimeBackend,
};
