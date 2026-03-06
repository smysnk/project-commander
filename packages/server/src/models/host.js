const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Host extends Model {}
const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const metadataDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

Host.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'runtime',
    },
    agentUuid: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    metadata: {
      type: metadataDataType,
      allowNull: false,
      defaultValue: isSqlite ? '{}' : {},
      get() {
        const raw = this.getDataValue('metadata');
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
      },
      set(value) {
        const normalized = value && typeof value === 'object' ? value : {};
        if (isSqlite) {
          this.setDataValue('metadata', JSON.stringify(normalized));
        } else {
          this.setDataValue('metadata', normalized);
        }
      },
    },
    directories: {
      type: DataTypes.VIRTUAL,
      get() {
        const metadata = this.getDataValue('metadata') || {};
        return Array.isArray(metadata.directories) ? metadata.directories : [];
      },
      set(value) {
        const metadata = { ...(this.getDataValue('metadata') || {}) };
        metadata.directories = Array.isArray(value) ? value : [];
        this.setDataValue('metadata', metadata);
      },
    },
  },
  {
    sequelize,
    modelName: 'Host',
    tableName: 'hosts',
    underscored: true,
  },
);

module.exports = {
  Host,
};
