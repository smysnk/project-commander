const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class AutomationApiToken extends Model {}

const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const structuredDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

const parseStructuredValue = (raw, fallback) => {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const writeStructuredValue = (model, fieldName, value) => {
  const normalized = Array.isArray(value) ? value : [];
  model.setDataValue(fieldName, isSqlite ? JSON.stringify(normalized) : normalized);
};

AutomationApiToken.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tokenHash: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      field: 'token_hash',
    },
    accessMode: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'observe',
      field: 'access_mode',
    },
    scopesJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'scopes_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('scopesJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'scopesJson', value);
      },
    },
    allowedHostIdsJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'allowed_host_ids_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('allowedHostIdsJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'allowedHostIdsJson', value);
      },
    },
    allowedProjectIdsJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'allowed_project_ids_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('allowedProjectIdsJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'allowedProjectIdsJson', value);
      },
    },
    allowedPathPrefixesJson: {
      type: structuredDataType,
      allowNull: false,
      field: 'allowed_path_prefixes_json',
      defaultValue: isSqlite ? '[]' : [],
      get() {
        return parseStructuredValue(this.getDataValue('allowedPathPrefixesJson'), []);
      },
      set(value) {
        writeStructuredValue(this, 'allowedPathPrefixesJson', value);
      },
    },
    rawCommandAllowed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'raw_command_allowed',
    },
    fullAccess: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'full_access',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'expires_at',
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_used_at',
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'created_by',
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'revoked_at',
    },
  },
  {
    sequelize,
    modelName: 'AutomationApiToken',
    tableName: 'automation_api_tokens',
    underscored: true,
    indexes: [
      { fields: ['token_hash'], unique: true },
      { fields: ['access_mode'] },
      { fields: ['revoked_at', 'expires_at'] },
    ],
  },
);

module.exports = {
  AutomationApiToken,
};
