var debug = require('debug')('feathers-sync');
const fs = require('fs');
const path = require('path');
const favicon = require('serve-favicon');
const compress = require('compression');
const cors = require('cors');
const helmet = require('helmet');

const feathers = require('@feathersjs/feathers');
const configuration = require('@feathersjs/configuration');
const express = require('@feathersjs/express');
const rest = require('@feathersjs/express/rest');
const socketio = require('@feathersjs/socketio');

const feathersSync = require('feathers-sync');
const config = require('config');
const deepAssign = require('deep-assign');

const handler = require('@feathersjs/errors/handler');
const notFound = require('@feathersjs/errors/not-found');


var MongoClient = require('mongodb').MongoClient;
const mongoService = require('feathers-mongodb');

const appHooks = require('./app.hooks');
const channels = require('./channels');

function makeApp(settings) {
  return new Promise((resolve, reject) => {
    var app = express(feathers());
    // Load app configuration
    app.configure(configuration());
    // Enable CORS, security, compression, favicon and body parsing
    app.use(cors());
    app.use(helmet());
    app.use(compress());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(favicon(path.join(app.get('public'), 'favicon.ico')));
    // Host the public folder
    app.use('/', express.static(app.get('public')));

    // Set up Plugins and providers
    app.configure(rest());
    app.configure(socketio());

    app.configure(feathersSync(settings.feathersSync));
    // Connect to your MongoDB instance(s)
    MongoClient.connect(settings.db, settings.mongoClient).then(function (db) {
      // Connect to the db, create and register a Feathers service.
      settings.services.forEach((serviceDef) => {
        function markDeleted(hook) {
          return new Promise((resolve, reject) => {
            // var smallHook = Object.assign({}, hook, { params: Object.assign({}, hook.params, { user: null, payload: null }) });

            // console.log("Hook", smallHook);

            hook.app.service(serviceDef.name).update(hook.id, { $set: { "deleted": true } }).then(results => {
              hook.result = results || {};
              resolve(hook);
            }).catch(error => {
              hook.result = {};
              resolve(hook);
            })
          })
        }
        app.use('/' + serviceDef.name, mongoService({
          Model: db.collection(serviceDef.dbName),
          paginate: {
            default: 10,
            max: 50
          }
        }));
        app.service(serviceDef.name).hooks({
          before: {
            remove: [
              markDeleted
            ]
          },
          after: {
            all: [
              hook => {
                if (hook.params && hook.params.provider) {
                  hook.result.emitted = hook.params.provider;
                }
                return Promise.resolve(hook);
              }
            ]
          }
        });
      });

      // Set up event channels (see channels.js)
      app.configure(channels);
      // Configure a middleware for 404s and the error handler
      app.use(notFound());
      app.use(handler());

      app.hooks(appHooks);

      // Start the server
      app.listen(settings.port);

      app.title = settings.title;
      app.provider = settings.title;
      resolve(app);
    }).catch(function (error) {
      reject(error);
    });
  }).then(result => {
    return result;
  });
}



var syncSettingsDefault = config.get('syncSettingsDefault');

var syncSettingsServers = config.get('syncSettingsServers');

var syncServerNames = Object.keys(syncSettingsServers);

var appPromises = syncServerNames.map(serverName => {

  var syncDefault = JSON.parse(JSON.stringify(syncSettingsDefault));
  var syncServer = JSON.parse(JSON.stringify(syncSettingsServers[serverName]));
  var combinedSettings = deepAssign({ title: serverName }, syncDefault, syncServer);



  if ((['production', 'devServer', 'productionPrep'].indexOf(process.env.NODE_ENV) >= 0) && config.has('mongoCert')) {
    var cert = fs.readFileSync(config.get('mongoCert'), 'utf8');
    var mongoOptions = {};
    mongoOptions.ssl = true;
    mongoOptions.sslValidate = false;
    mongoOptions.sslKey = cert;
    mongoOptions.sslCert = cert;
    mongoOptions.sslCA = cert;

    combinedSettings.feathersSync.mubsub = Object.assign({}, combinedSettings.feathersSync.mubsub, mongoOptions);
    combinedSettings.mongoClient = Object.assign({}, combinedSettings.mongoClient, mongoOptions);
  }


  return makeApp(combinedSettings);
});

Promise.all(appPromises)
  .then((result) => {
    var appList = {};
    result.forEach(app => {
      appList[app.title] = app;
    });

    for (var i = 1; i < result.length; i++) {
      performConnections(result[0], result[i]);
    }

  }).catch(error => {
    debug('Error:', error);
  });





function performConnections(appA, appB) {


  var serviceA = appA.service(Object.keys(appA.services)[0]);
  var serviceB = appB.service(Object.keys(appB.services)[0]);

  if (!serviceA || !serviceB) {
    setTimeout(() => {
      performConnections(appA, appB);
    }, 10);
    return;
  }
  debug('Connecting', appA.title, 'to', appB.title);
  function connectServices(app, appDest) {
    var provider = app.provider;
    Object.keys(app.services).forEach(function (path) {
      var service = app.services[path];
      service._serviceEvents.forEach(function (event) {
        var serviceDest = appDest.service(path);
        if (serviceDest) {
          service.on(event, (data) => {
            debug(provider, path + '.on(' + event + ') = ', data._id || data);
            if (data.emitted === appDest.provider) {
              debug(provider, 'Emitted already', data._id, provider, appDest.provider, app === appDest);
              return;
            }
            switch (event) {
              case 'created':
                return new Promise((resolve, reject) => {
                  serviceDest.create(data, { provider }).then(resolve).catch(reject);
                });
              case 'patched':
                return new Promise((resolve, reject) => {
                  var id = data._id || data.id;
                  serviceDest.patch(id, data, { provider }).then(resolve).catch(err => {
                    return new Promise(resolve, reject => {
                      setTimeout(() => {
                        //retry 
                        serviceDest.patch(id, data, { provider }).then(resolve).catch(reject);
                      }, 100);
                    });
                  }).catch(reject);
                });
              case 'updated':
                return new Promise((resolve, reject) => {
                  var id = data._id || data.id;
                  serviceDest.update(id, data, { provider }).then(resolve).catch(err => {
                    return new Promise(resolve, reject => {
                      setTimeout(() => {
                        //retry 
                        serviceDest.update(data, { provider }).then(resolve).catch(reject);
                      }, 100);
                    });
                  }).catch(reject);
                }).catch(error => debug(path + 'A.updateErr:', error));
              case 'removed':
                return new Promise((resolve, reject) => {
                  setTimeout(() => {
                    // always delay remove
                    var id = data._id || data.id;
                    serviceDest.remove(id, { provider }).then(resolve).catch(err => {
                      return new Promise(resolve, reject => {
                        setTimeout(() => {
                          //retry 
                          serviceDest.remove(id, { provider }).then(resolve).catch(reject);
                        }, 100);
                      });
                    }).catch(reject);
                  }, 500);
                });
              default:
              //do nothing
            }
          });
        }
      });
    });
  }
  connectServices(appA, appB);
  connectServices(appB, appA);
}
