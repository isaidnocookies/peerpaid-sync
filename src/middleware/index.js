const testMiddleware = require('./test-middleware');
module.exports = function (app) {
  app.use(testMiddleware());
};
