const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class PortRange extends Model {}

PortRange.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    begin: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    end: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id',
      unique: true,
    },
  },
  {
    sequelize,
    modelName: 'PortRange',
    tableName: 'port_ranges',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['project_id'],
      },
    ],
  },
);

module.exports = {
  PortRange,
};
