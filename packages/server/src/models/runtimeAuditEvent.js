const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class RuntimeAuditEvent extends Model {}

const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const structuredDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

const parseStructuredValue = (raw) => {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const writeStructuredValue = (model, fieldName, value) => {
  const normalized = value && typeof value === 'object' ? value : {};
  model.setDataValue(fieldName, isSqlite ? JSON.stringify(normalized) : normalized);
};

RuntimeAuditEvent.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    requestId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'request_id',
    },
    actorType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'actor_type',
    },
    actorId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'actor_id',
    },
    actorName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'actor_name',
    },
    toolName: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'tool_name',
    },
    scope: {
      type: DataTypes.STRING,
      allowNull: true,
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
    desiredProcessId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'desired_process_id',
    },
    runId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'run_id',
    },
    processKey: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'process_key',
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    inputJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'input_json',
      defaultValue: isSqlite ? '{}' : {},
      get() {
        return parseStructuredValue(this.getDataValue('inputJson'));
      },
      set(value) {
        writeStructuredValue(this, 'inputJson', value);
      },
    },
    resultJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'result_json',
      defaultValue: isSqlite ? '{}' : {},
      get() {
        return parseStructuredValue(this.getDataValue('resultJson'));
      },
      set(value) {
        writeStructuredValue(this, 'resultJson', value);
      },
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'success',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'error_message',
    },
  },
  {
    sequelize,
    modelName: 'RuntimeAuditEvent',
    tableName: 'runtime_audit_events',
    underscored: true,
    indexes: [
      { fields: ['request_id'] },
      { fields: ['actor_type', 'actor_id'] },
      { fields: ['action'] },
      { fields: ['host_id', 'project_id'] },
      { fields: ['created_at'] },
    ],
  },
);

module.exports = {
  RuntimeAuditEvent,
};
