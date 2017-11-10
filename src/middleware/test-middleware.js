module.exports = function (options = {}) {
  return function testMiddleware(req, res, next) {
    console.log('testMiddleware middleware is running');
    next();
  };
};
