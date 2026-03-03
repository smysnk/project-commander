const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Technology extends Model {}

Technology.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    label: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Technology',
    tableName: 'technologies',
    underscored: true,
  },
);

module.exports = {
  Technology,
};
