const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class DesiredProcess extends Model {}

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

DesiredProcess.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    processKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'process_key',
    },
    hostId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'host_id',
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id',
    },
    serviceId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'service_id',
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
    desiredState: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'running',
      field: 'desired_state',
    },
    launchMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'exec',
      field: 'launch_mode',
    },
    cwd: {
      type: DataTypes.STRING,
      allowNull: false,
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
    envHash: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'env_hash',
    },
    launchFingerprint: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'launch_fingerprint',
    },
    logRoot: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'log_root',
    },
    restartPolicy: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'manual',
      field: 'restart_policy',
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
    modelName: 'DesiredProcess',
    tableName: 'desired_processes',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['host_id', 'project_id', 'package_key'],
      },
      {
        fields: ['process_key'],
      },
      {
        fields: ['host_id'],
      },
      {
        fields: ['project_id'],
      },
    ],
  },
);

module.exports = {
  DesiredProcess,
};
