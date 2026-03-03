const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Project extends Model {}
const dialect = sequelize.getDialect();
const isPostgres = dialect === 'postgres';
const isSqlite = dialect === 'sqlite';
const metadataDataType = isPostgres ? DataTypes.JSONB : (isSqlite ? DataTypes.TEXT : DataTypes.JSON);

Project.init(
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
    path: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue('metadata')?.path || null;
      },
      set(value) {
        const metadata = { ...(this.getDataValue('metadata') || {}) };
        metadata.path = value;
        this.setDataValue('metadata', metadata);
      },
    },
  },
  {
    sequelize,
    modelName: 'Project',
    tableName: 'projects',
    underscored: true,
  },
);

module.exports = {
  Project,
};
