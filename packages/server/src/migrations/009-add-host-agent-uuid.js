module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('hosts', 'agent_uuid', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('hosts', ['agent_uuid'], {
      unique: true,
      name: 'hosts_agent_uuid_unique',
    });
  },
};
