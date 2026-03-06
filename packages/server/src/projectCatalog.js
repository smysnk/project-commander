const path = require('path');
const { Op } = require('sequelize');
const { sequelize } = require('./db');
const { Project, Service, Technology } = require('./models');

const TECHNOLOGY_LABELS = {
  'node-project': 'Node Project',
  'node-monorepo': 'Node Monorepo',
  'go-project': 'Go Project',
  'go-monorepo': 'Go Monorepo',
  'make-project': 'Makefile Project',
};

const toTechnologyLabel = (key) =>
  TECHNOLOGY_LABELS[key] || key.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');

const toServiceName = (kind) => kind[0].toUpperCase() + kind.slice(1);
const serviceIdentityKey = (service) => `${service.name}::${service.relativePath || ''}`;
const getProjectPath = (project) => project.metadata?.path || null;
const isCustomProject = (project) => Boolean(project?.metadata?.customPath);

const listCustomProjectPaths = async () => {
  const projects = await Project.findAll({
    attributes: ['metadata'],
  });

  const paths = projects
    .filter((project) => isCustomProject(project))
    .map((project) => getProjectPath(project))
    .filter((projectPath) => typeof projectPath === 'string' && projectPath.length > 0)
    .map((projectPath) => path.resolve(projectPath));

  return Array.from(new Set(paths));
};

const syncDiscoveredProjects = async (discoveryResult) => {
  const discoveredProjects = Array.isArray(discoveryResult?.projects) ? discoveryResult.projects : [];
  const discoveredPaths = new Set(discoveredProjects.map((project) => project.path));

  await sequelize.transaction(async (transaction) => {
    const existingProjects = await Project.findAll({
      attributes: ['id', 'name', 'metadata'],
      transaction,
    });
    const existingByPath = new Map(
      existingProjects
        .map((project) => [getProjectPath(project), project])
        .filter(([projectPath]) => typeof projectPath === 'string' && projectPath.length > 0),
    );

    const staleProjectIds = existingProjects
      .filter((project) => {
        const projectPath = getProjectPath(project);
        return !projectPath || !discoveredPaths.has(projectPath);
      })
      .map((project) => project.id);

    if (staleProjectIds.length > 0) {
      await Service.destroy({
        where: { projectId: { [Op.in]: staleProjectIds } },
        transaction,
      });
      await Project.destroy({
        where: { id: { [Op.in]: staleProjectIds } },
        transaction,
      });
    }

    for (const discoveredProject of discoveredProjects) {
      const discoveredCustomPath = Object.prototype.hasOwnProperty.call(discoveredProject, 'customPath')
        ? Boolean(discoveredProject.customPath)
        : Boolean(existingByPath.get(discoveredProject.path)?.metadata?.customPath);
      const discoveredHostId = Number(discoveredProject?.hostId);
      const normalizedHostId = Number.isInteger(discoveredHostId) && discoveredHostId > 0
        ? discoveredHostId
        : null;
      const discoveredHostName = String(discoveredProject?.hostName || '').trim() || null;
      const discoveredHostIp = String(discoveredProject?.hostIp || '').trim() || null;
      const discoveredHostAgentUuid = String(discoveredProject?.hostAgentUuid || '').trim().toLowerCase() || null;
      let project = existingByPath.get(discoveredProject.path);
      if (!project) {
        project = await Project.create(
          {
            name: discoveredProject.name,
            hostId: normalizedHostId,
            metadata: {
              path: discoveredProject.path,
              portBlock: null,
              customPath: discoveredCustomPath,
              hostName: discoveredHostName,
              hostIp: discoveredHostIp,
              hostAgentUuid: discoveredHostAgentUuid,
            },
          },
          { transaction },
        );
        existingByPath.set(discoveredProject.path, project);
      } else {
        const nextMetadata = {
          ...(project.metadata || {}),
          path: discoveredProject.path,
          customPath: discoveredCustomPath,
          hostName: discoveredHostName,
          hostIp: discoveredHostIp,
          hostAgentUuid: discoveredHostAgentUuid,
        };
        if (
          project.name !== discoveredProject.name ||
          Number(project.hostId || 0) !== Number(normalizedHostId || 0) ||
          JSON.stringify(nextMetadata) !== JSON.stringify(project.metadata || {})
        ) {
          await project.update(
            {
              name: discoveredProject.name,
              hostId: normalizedHostId,
              metadata: nextMetadata,
            },
            { transaction },
          );
        }
      }

      const technologyKeys = Array.from(new Set(discoveredProject.types || []));
      const technologyModels = [];
      for (const key of technologyKeys) {
        const [technology] = await Technology.findOrCreate({
          where: { key },
          defaults: {
            key,
            label: toTechnologyLabel(key),
          },
          transaction,
        });

        if (technology.label !== toTechnologyLabel(key)) {
          await technology.update({ label: toTechnologyLabel(key) }, { transaction });
        }
        technologyModels.push(technology);
      }
      await project.setTechnologies(technologyModels, { transaction });

      const declaredServices = Array.isArray(discoveredProject.declaredServices)
        ? discoveredProject.declaredServices
        : [];
      const serviceKinds = Array.from(new Set(discoveredProject.services || ['main']));

      const existingServices = await Service.findAll({
        where: { projectId: project.id },
        transaction,
      });
      const existingByKey = new Map(
        existingServices.map((service) => [serviceIdentityKey(service), service]),
      );
      const nextIdentityKeys = new Set();

      if (declaredServices.length > 0) {
        for (const service of declaredServices) {
          const payload = {
            projectId: project.id,
            kind: 'declared-service',
            name: service.name,
            relativePath: service.relativePath,
            language: service.language,
            commands: {
              packageScripts: service.packageScripts || [],
              makeTargets: service.makeTargets || [],
            },
            envVarNames: service.envVarNames || [],
            envFiles: service.envFiles || [],
            hasMakefile: Boolean(service.hasMakefile),
            hasPackageJson: Boolean(service.hasPackageJson),
          };
          const key = serviceIdentityKey(payload);
          nextIdentityKeys.add(key);

          const existing = existingByKey.get(key);
          if (existing) {
            await existing.update(payload, { transaction });
          } else {
            await Service.create(
              {
                ...payload,
                port: null,
                processId: null,
              },
              { transaction },
            );
          }
        }
      } else if (serviceKinds.length > 0) {
        for (const kind of serviceKinds) {
          const payload = {
            projectId: project.id,
            kind,
            name: toServiceName(kind),
            relativePath: null,
            language: null,
            commands: [],
            envVarNames: [],
            envFiles: [],
            hasMakefile: false,
            hasPackageJson: false,
          };
          const key = serviceIdentityKey(payload);
          nextIdentityKeys.add(key);
          const existing = existingByKey.get(key);
          if (existing) {
            await existing.update(payload, { transaction });
          } else {
            await Service.create(
              {
                ...payload,
                port: null,
                processId: null,
              },
              { transaction },
            );
          }
        }
      }

      for (const existing of existingServices) {
        const key = serviceIdentityKey(existing);
        if (!nextIdentityKeys.has(key)) {
          await existing.destroy({ transaction });
        }
      }
    }
  });
};

module.exports = {
  listCustomProjectPaths,
  syncDiscoveredProjects,
};
