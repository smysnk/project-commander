module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('services', 'relative_path', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('services', 'language', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('services', 'commands', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: [],
    });

    await queryInterface.addColumn('services', 'env_var_names', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: [],
    });

    await queryInterface.addColumn('services', 'env_files', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: [],
    });

    await queryInterface.addColumn('services', 'has_makefile', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('services', 'has_package_json', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
