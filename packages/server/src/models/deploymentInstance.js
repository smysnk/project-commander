const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class DeploymentInstance extends Model {}

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

DeploymentInstance.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
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
    deploymentKey: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'deployment_key',
    },
    displayName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'display_name',
    },
    deploymentPath: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'deployment_path',
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
    logRoot: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'log_root',
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
    modelName: 'DeploymentInstance',
    tableName: 'deployment_instances',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['host_id', 'project_id', 'deployment_key'],
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
  DeploymentInstance,
};
