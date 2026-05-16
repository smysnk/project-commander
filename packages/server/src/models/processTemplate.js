const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class ProcessTemplate extends Model {}

const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const structuredDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

const parseStructuredValue = (raw, fallback) => {
  if (Array.isArray(fallback)) {
    if (Array.isArray(raw)) {
      return raw;
    }
  } else if (raw && typeof raw === 'object') {
    return raw;
  }

  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(fallback)) {
        return Array.isArray(parsed) ? parsed : fallback;
      }
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const writeStructuredValue = (model, fieldName, value, fallback) => {
  const normalized = Array.isArray(fallback)
    ? (Array.isArray(value) ? value : fallback)
    : (value && typeof value === 'object' ? value : fallback);
  if (isSqlite) {
    model.setDataValue(fieldName, JSON.stringify(normalized));
    return;
  }
  model.setDataValue(fieldName, normalized);
};

ProcessTemplate.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    hostId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'host_id',
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'project_id',
    },
    templateKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'template_key',
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'display_name',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    packageKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'package_key',
    },
    packageRelativePath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'package_relative_path',
    },
    processKeyTemplate: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'process_key_template',
    },
    cwdTemplate: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'cwd_template',
    },
    desiredState: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'running',
      field: 'desired_state',
    },
    launchMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'shell',
      field: 'launch_mode',
    },
    command: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    argsJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'args_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('argsJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'argsJson', value, []);
      },
    },
    envJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'env_json',
      defaultValue: isSqlite ? '{}' : {},
      get() {
        return parseStructuredValue(this.getDataValue('envJson'), {});
      },
      set(value) {
        writeStructuredValue(this, 'envJson', value, {});
      },
    },
    restartPolicy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'manual',
      field: 'restart_policy',
    },
    healthChecksJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'health_checks_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('healthChecksJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'healthChecksJson', value, []);
      },
    },
    logRoot: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'log_root',
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    allowCodex: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'allow_codex',
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'created_by',
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'updated_by',
    },
  },
  {
    sequelize,
    modelName: 'ProcessTemplate',
    tableName: 'process_templates',
    underscored: true,
    indexes: [
      { fields: ['template_key'] },
      { fields: ['host_id', 'project_id', 'template_key'] },
      { fields: ['enabled', 'allow_codex'] },
    ],
  },
);

module.exports = {
  ProcessTemplate,
};
