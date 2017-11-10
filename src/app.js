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

const handler = require('@feathersjs/errors/handler');
const notFound = require('@feathersjs/errors/not-found');


var MongoClient = require('mongodb').MongoClient;
const mongoService = require('feathers-mongodb');

const appHooks = require('./app.hooks');
const channels = require('./channels');

function makeApp(config) {
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

    app.configure(feathersSync(config.feathersSync));
    // Connect to your MongoDB instance(s)
    MongoClient.connect(config.db, config.mongoClient).then(function (db) {
      // Connect to the db, create and register a Feathers service.
      config.services.forEach((serviceDef) => {
        console.log('create service', serviceDef.name);
        app.use('/' + serviceDef.name, mongoService({
          Model: db.collection(serviceDef.dbName),
          paginate: {
            default: 10,
            max: 50
          }
        }));
      });

      // Set up event channels (see channels.js)
      app.configure(channels);
      // Configure a middleware for 404s and the error handler
      app.use(notFound());
      app.use(handler());

      app.hooks(appHooks);

      // Start the server
      app.listen(config.port);

      app.title = title;
      setTimeout(() => {

        resolve(app);
      }, 100);

    }).catch(function (error) {
      reject(error);
    });
  }).then(result => {
    return result;
  });
}

function makeConfig({ port, mongoClient, db, services, title }) {
  return {
    port,
    feathersSync: {
      size: 40 * 1024 * 1024,
      max: 50000,
      mubsub: mongoClient,
      db,
      collection: '_events'
    },
    mongoClient,
    services,
    db,
    title
  };
}


var mongoClient = {
  reconnectTries: 120,
  reconnectInterval: 1000,
  authSource: 'admin'
};

var services = [
  { name: 'bitcoin-transactions', dbName: 'bitcointransactions' },
  { name: 'currency-accounts', dbName: 'currencyaccounts' },
  { name: 'requests', dbName: 'requests' },
  { name: 'wallets', dbName: 'wallets' },
];

var db = 'mongodb://peerpaid:Pe3rB41dP4sswurd@10.0.0.99:27017/peerpaid_btc';
var port = 3021;
var title = 'btcToData';
var config = makeConfig({ title, port, mongoClient, db, services });

const appBtcPromise = makeApp(config);

db = 'mongodb://peerpaid:Pe3rB41dP4sswurd@10.0.0.99:27017/peerpaid_data';
port = 3022;
title = 'dataToBtc';
config = makeConfig({ title, port, mongoClient, db, services });

const appDataPromise = makeApp(config);



db = 'mongodb://peerpaid:Pe3rB41dP4sswurd@10.0.0.99:27017/peerpaid_web';
port = 3023;
title = 'webToData';
config = makeConfig({ title, port, mongoClient, db, services });

const appWebPromise = makeApp(config);



Promise.all([appWebPromise, appDataPromise, appBtcPromise])
  .then((result) => {
    const appWeb = result[0];
    const appData = result[1];
    const appBtc = result[2];

    connectServices(appWeb, appData);
    connectServices(appBtc, appData);
  });





function connectServices(appA, appB) {
  var serviceA = appA.service(services[0].name);
  var serviceB = appB.service(services[0].name);
  serviceB = {};
  if (!serviceA || !serviceB) {
    setTimeout(() => {
      connectServices();
    }, 10);
    return;
  }
  function performConnections(app, appDest) {
    var provider = app.provider;
    Object.keys(app.services).forEach(function (path) {
      var service = app.services[path];
      service._serviceEvents.forEach(function (event) {
        var serviceDest = appDest.service(path);
        if (serviceDest === void 0) {
          console.log('Service at ', path, 'not exists');
        }
        service.on(event, (data) => {
          console.log(provider, path + '.on(' + event + ') = ', data._id);
          if (data.emitted === appDest.provider) {
            console.log(provider, 'Emitted already');
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
              }).catch(error => console.log(path + 'A.updateErr:', error));
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
      });
    });
  }

  performConnections(appA, appB);
  performConnections(appB, appA);


}
