const { Project } = require('./project');
const { Service } = require('./service');
const { Technology } = require('./technology');
const { PortRange } = require('./portRange');
const { Host } = require('./host');
const { DesiredProcess } = require('./desiredProcess');
const { ProcessRun } = require('./processRun');
const { ProcessRuntimeState } = require('./processRuntimeState');
const { HostRuntimeState } = require('./hostRuntimeState');
const { HostPathMapping } = require('./hostPathMapping');
const { ProcessTemplate } = require('./processTemplate');
const { AutomationApiToken } = require('./automationApiToken');
const { RuntimeAuditEvent } = require('./runtimeAuditEvent');
const { DeploymentInstance } = require('./deploymentInstance');

const initModelAssociations = () => {
  Host.hasMany(Project, {
    as: 'projects',
    foreignKey: 'hostId',
  });
  Project.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'hostId',
  });
  DesiredProcess.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasOne(HostRuntimeState, {
    as: 'runtimeState',
    foreignKey: 'hostId',
  });
  HostRuntimeState.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasMany(HostPathMapping, {
    as: 'pathMappings',
    foreignKey: 'hostId',
  });
  HostPathMapping.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasMany(ProcessTemplate, {
    as: 'processTemplates',
    foreignKey: 'hostId',
  });
  ProcessTemplate.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Host.hasMany(DeploymentInstance, {
    as: 'deploymentInstances',
    foreignKey: 'hostId',
  });
  DeploymentInstance.belongsTo(Host, {
    as: 'host',
    foreignKey: 'hostId',
  });

  Project.hasMany(Service, {
    as: 'services',
    foreignKey: 'projectId',
  });
  Service.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'projectId',
  });
  DesiredProcess.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(ProcessRun, {
    as: 'processRuns',
    foreignKey: 'projectId',
  });
  ProcessRun.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(ProcessTemplate, {
    as: 'processTemplates',
    foreignKey: 'projectId',
  });
  ProcessTemplate.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.hasMany(DeploymentInstance, {
    as: 'deploymentInstances',
    foreignKey: 'projectId',
  });
  DeploymentInstance.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Service.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'serviceId',
  });
  DesiredProcess.belongsTo(Service, {
    as: 'service',
    foreignKey: 'serviceId',
  });

  Service.hasMany(ProcessRun, {
    as: 'processRuns',
    foreignKey: 'serviceId',
  });
  ProcessRun.belongsTo(Service, {
    as: 'service',
    foreignKey: 'serviceId',
  });

  DesiredProcess.hasMany(ProcessRun, {
    as: 'runs',
    foreignKey: 'desiredProcessId',
  });
  ProcessRun.belongsTo(DesiredProcess, {
    as: 'desiredProcess',
    foreignKey: 'desiredProcessId',
  });

  DeploymentInstance.hasMany(DesiredProcess, {
    as: 'desiredProcesses',
    foreignKey: 'deploymentId',
  });
  DesiredProcess.belongsTo(DeploymentInstance, {
    as: 'deployment',
    foreignKey: 'deploymentId',
  });

  DeploymentInstance.hasMany(ProcessRun, {
    as: 'processRuns',
    foreignKey: 'deploymentId',
  });
  ProcessRun.belongsTo(DeploymentInstance, {
    as: 'deployment',
    foreignKey: 'deploymentId',
  });

  ProcessRun.hasOne(ProcessRuntimeState, {
    as: 'runtimeState',
    foreignKey: 'processRunId',
  });
  ProcessRuntimeState.belongsTo(ProcessRun, {
    as: 'processRun',
    foreignKey: 'processRunId',
  });

  Project.hasOne(PortRange, {
    as: 'portRange',
    foreignKey: 'projectId',
  });
  PortRange.belongsTo(Project, {
    as: 'project',
    foreignKey: 'projectId',
  });

  Project.belongsToMany(Technology, {
    as: 'technologies',
    through: 'project_technologies',
    foreignKey: 'project_id',
    otherKey: 'technology_id',
  });
  Technology.belongsToMany(Project, {
    as: 'projects',
    through: 'project_technologies',
    foreignKey: 'technology_id',
    otherKey: 'project_id',
  });
};

module.exports = {
  Project,
  Host,
  Service,
  DesiredProcess,
  ProcessRun,
  ProcessRuntimeState,
  HostRuntimeState,
  HostPathMapping,
  ProcessTemplate,
  AutomationApiToken,
  RuntimeAuditEvent,
  DeploymentInstance,
  Technology,
  PortRange,
  initModelAssociations,
};
