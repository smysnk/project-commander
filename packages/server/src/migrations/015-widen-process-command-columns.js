module.exports = {
  up: async (queryInterface, Sequelize) => {
    for (const [tableName, allowNull] of [
      ['desired_processes', false],
      ['process_runs', false],
      ['process_templates', false],
    ]) {
      await queryInterface.changeColumn(tableName, 'command', {
        type: Sequelize.TEXT,
        allowNull,
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    for (const [tableName, allowNull] of [
      ['desired_processes', false],
      ['process_runs', false],
      ['process_templates', false],
    ]) {
      await queryInterface.changeColumn(tableName, 'command', {
        type: Sequelize.STRING,
        allowNull,
      });
    }
  },
};
