module.exports = function (options = {}) {
  return function testMiddleware(req, res, next) {
    console.log('test-middleware middleware is running');
    next();
  };
};
