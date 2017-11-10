const { authenticate } = require('feathers-authentication').hooks;

const testhook = require('../../hooks/testhook');

module.exports = {
  before: {
    all: [ authenticate('jwt') ],
    find: [testhook()],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  after: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  },

  error: {
    all: [],
    find: [],
    get: [],
    create: [],
    update: [],
    patch: [],
    remove: []
  }
};
