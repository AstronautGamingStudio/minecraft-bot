const tasks = {
  collect: require('./modules/tasks/collect'),
  mine: require('./modules/tasks/mine'),
  build: require('./modules/tasks/build'),
  fight: require('./modules/tasks/pvp'),
  pvp: require('./modules/tasks/pvp'),
  empire: require('./modules/tasks/empire'),
  speedrun: require('./modules/tasks/speedrun')
};

module.exports = { tasks };
