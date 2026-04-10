'use strict';

require('dotenv').config();

// [ Welcome To Bingo Game ]
/**
 * 
 * Programming Language: Node Js
 * Database: Mongodb
 * 
 */

//  [ Used For Create a Server Side Application ]
var express = require('express');
var helmet = require('helmet');

// 
var http = require('http');
var fs = require('fs');
var join = require('path').join;
var path = require("path");
var mongoose = require('mongoose');
var nunjucks = require('nunjucks')
const session = require('express-session');
var FileStore = require('session-file-store')(session);
var bodyParser = require('body-parser');
var fileUpload = require('express-fileupload');
var flash = require('connect-flash');
var passport = require('passport');
var cookieSession = require('cookie-session');
var jwt = require('jsonwebtoken');
var FCM = require('fcm-node');
var CronJob = require('cron').CronJob;
var LocalStrategy = require('passport-local').Strategy;
var winston = require('winston'); // Logger
let moment = require('moment-timezone');
require('winston-daily-rotate-file'); // Sys Logger Daily

var Sys = new require('../Boot/Sys');
const socketInit = require('../Config/socketinit');
const { sanitizeRequest } = require("../gamehelper/all");

// Ensure Log directory exists (Render has ephemeral filesystem)
if (!fs.existsSync('Log')) { fs.mkdirSync('Log', { recursive: true }); }
if (!fs.existsSync('sessions')) { fs.mkdirSync('sessions', { recursive: true }); }
var fileStoreOptions = {};

// Redis session store for Render (ephemeral filesystem)
let RedisStore;
try {
    const connectRedis = require('connect-redis');
    RedisStore = connectRedis(session);
} catch (e) {
    // connect-redis not installed, will fall back to file store
}



const allowedOrigins = [
    'https://spillorama.aistechnolabs.info',
    'https://bingoadmin.aistechnolabs.pro',
    'https://bingoadmin.aistechnolabs.in',
    'http://localhost:3007',
    'https://social-sincerely-tapir.ngrok-free.app',
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : []),
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : []),
];

function normalizeOriginList(values) {
    return [...new Set(
        values
            .filter(Boolean)
            .flatMap((value) => String(value).split(','))
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => {
                try {
                    return new URL(value).origin;
                } catch (_error) {
                    return null;
                }
            })
            .filter(Boolean)
    )];
}

const allowedEmbedOrigins = normalizeOriginList([
    'http://127.0.0.1:4174',
    'http://localhost:4174',
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'https://candy-backend-ldvg.onrender.com',
    process.env.CANDY_BACKEND_URL,
    process.env.CANDY_RUNTIME_URL,
    process.env.INTEGRATION_CANDY_FRONTEND_URL,
    process.env.INTEGRATION_CANDY_API_BASE_URL,
    process.env.ALLOWED_EMBED_ORIGINS
]);

Sys.App = express();
Sys.App.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "wss:", "data:", "blob:"],
            childSrc: ["'self'", ...allowedEmbedOrigins],
            frameSrc: ["'self'", ...allowedEmbedOrigins],
            fontSrc: ["'self'", "https:", "data:"],
            imgSrc: ["'self'", "https:", "data:", "blob:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "blob:"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            workerSrc: ["'self'", "blob:"],
            frameAncestors: ["'self'", ...allowedOrigins]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    xFrameOptions: false // Replaced by CSP frameAncestors whitelist
}));
const expiryDate = 604800000;
// [ Session ] - Use Redis store on Render, file store locally
let sessionStore;
if (RedisStore && process.env.REDIS_HOST) {
    const Redis = require('ioredis');
    const redisConfig = require('../Config/Redis');
    sessionStore = new RedisStore({ client: redisConfig });
    console.log('Using Redis session store');
} else {
    sessionStore = new FileStore(fileStoreOptions);
    console.log('Using file-based session store');
}
const sessionMiddleware = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: expiryDate,
        secure: process.env.NODE_ENV === 'production', // Secure cookies in production
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
});

Sys.App.use(sessionMiddleware);


// [ Passport ]
Sys.App.use(passport.initialize());
Sys.App.use(passport.session());

// [ CORS Headers Allow ]
Sys.App.use(function (req, res, next) {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  
    // Handle preflight (OPTIONS) request
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
  
    next();
});

// SSL: On Render, TLS is terminated at the load balancer level.
// We only use HTTPS locally if SSL cert files exist.
var https_options = null;
var useHttps = false;
try {
    if (fs.existsSync('public/SSL/aistechnolabsinfo_private.txt') && fs.existsSync('public/SSL/aistechnolabsinfo_ssl.pem')) {
        https_options = {
            key: fs.readFileSync('public/SSL/aistechnolabsinfo_private.txt'),
            cert: fs.readFileSync('public/SSL/aistechnolabsinfo_ssl.pem')
        };
        useHttps = true;
    }
} catch (e) {
    console.log('SSL certs not found, running in HTTP mode (Render handles TLS)');
}

// [ File Upload ]
Sys.App.use(fileUpload());

// [ For Parsing Application/JSON ]
Sys.App.use(bodyParser.json({ limit: '100mb' }));

// [ For Parsing Application/XWWW ]
Sys.App.use(bodyParser.urlencoded({ limit: '100mb', extended: true, parameterLimit: 10000 }));

Sys.App.use(sanitizeRequest); // all req.body/query/params automatically sanitized

// [ Flash For Error & Message ]
Sys.App.use(flash());

// Expose flash messages to views even if controllers forget to pass them
Sys.App.use(function (req, res, next) {
    const flashStore = (req.session && req.session.flash) ? req.session.flash : {};
    res.locals.success = flashStore.success || [];
    res.locals.error = flashStore.error || [];
    next();
});


Sys.App.set('trust proxy', true); //Trusting Header Set by Proxy Server.
Sys.App.set('view engine', 'html');

const EventEmitter = require('node:events');
const eventEmitter = new EventEmitter();
Sys.App.set('eventEmitter', eventEmitter);

Sys.App.use(express.static('./public'));
// [ Set Views ]
let env = nunjucks.configure('./App/Views', {
    autoescape: true,
    express: Sys.App,
    watch: true
});

env.addFilter('addTime', function (startTime, addTime) {
    if (startTime && addTime != undefined && addTime >= 3) {
        let addSeconds = 75 * addTime;
        let start = moment(startTime, "HH:mm A");
        let endTime = start.add(addSeconds, 'seconds').add('1', 'minutes').format("HH:mm A");
        return endTime;
    }
});

env.addFilter("includes", function (arr, str) {
    return arr.indexOf(str) !== -1;
});

// Add custom date filter
env.addFilter('date', function(date, format) {
    return moment(date).format(format);
});

env.addFilter('removeImagePrefix', function (value) {
    return value ? value.replace('/admin/images/', '') : value;
});

Sys.App.use('/node_modules', express.static('./node_modules'));
// Use HTTPS if certs available, otherwise HTTP (Render handles TLS)
if (useHttps) {
    Sys.Server = require('https').Server(https_options, Sys.App);
} else {
    Sys.Server = require('http').Server(Sys.App);
}

// [ FCM ]
Sys.fcm = FCM;

// var serverKey = 'AAAAs0_pgTg:APA91bFsodbNVviWfUdUTabdnQLaViPCBxwvM03SrEV7dJ5YxkU3DDTsIxCR16X7gbu1NZLd0CfMU61xMrC_BwOU-os0NiIUItGKJ_5Vyz9f-OUYyfbi5PJ_VAD6QN6dp-QK_3jAZ-PS'; //put your server key here
// var fcm = new FCM(serverKey);

// var message = { //this may vary according to the message type (single recipient, multicast, topic, et cetera)
// 	to: 'cM18EJM3tVs:APA91bFJ5t0b35XA5a4GfgVBNfyvJ_GL_yI44mq9a-3sevtt3-jLcpJketbBc7HoM5EytEnlRXZmGI8vtvpV4qud4584dODKNQ6llyJlq8cs0PVxXRXRdvESQVNjzgaLaL-oywCM4psJ', 
// 	collapse_key: 'your_collpase_key',

// 	notification: {
// 		title: 'Title of your push notification', 
// 		body: 'Body of your push notification' 
// 	},

// 	data: {  //you can send only notification or only data(or include both)
// 		my_key: 'my value',
// 		my_another_key: 'my another value'
// 	}
// };

// fcm.send(message, function(err, response){
// 	if (err) {
// 		console.log("Something has gone wrong!");
// 	} else {
// 		console.log("Successfully sent with response: ", response);
// 	}
// });

// Sys.App.use(cookieSession({
//   name: 'session',
//   keys:  ["golfcookie"],

//   // Cookie Options
//   maxAge: 24 * 60 * 60 * 1000 // 24 hours
// }))

// [ Middleware To Use Session Data in All Routes ]
Sys.App.use(function (req, res, next) {
    res.locals.session = req.session;
    next();
});

Sys.Config = new Array();
fs.readdirSync(join(__dirname, '../Config'))
    .filter(file => ~file.search(/^[^\.].*\.js$/))
    .forEach(function (file) {
        Sys.Config[file.split('.')[0]] = require(join(join(__dirname, '../Config'), file))
    });

Sys.Helper = new Array();
fs.readdirSync(join(__dirname, '../Helper'))
    .filter(file => ~file.search(/^[^\.].*\.js$/))
    .forEach(function (file) {
        Sys.Helper[file.split('.')[0]] = require(join(join(__dirname, '../Helper'), file))
    });

console.log("Helper.", Sys.Helper.Poker.numFormater(1000330000));

// [ Logger Load ]
const myCustomLevels = {
    levels: {
        trace: 9,
        input: 8,
        verbose: 7,
        prompt: 6,
        debug: 5,
        info: 4,
        data: 3,
        help: 2,
        warn: 1,
        error: 0
    },
    colors: {
        trace: 'magenta',
        input: 'grey',
        verbose: 'cyan',
        prompt: 'grey',
        debug: 'blue',
        info: 'green',
        data: 'grey',
        help: 'cyan',
        warn: 'yellow',
        error: 'red'
    }
};

Sys.Log = winston.createLogger({
    format: winston.format.json(),
    levels: myCustomLevels.levels,
    prettyPrint: function (object) {
        return JSON.stringify(object);
    },
    transports: [
        new (winston.transports.DailyRotateFile)({
            filename: path.join(Sys.Config.App.logger.logFolder, '/' + Sys.Config.App.logger.logFilePrefix + '-%DATE%.log'),
            datePattern: 'DD-MM-YYYY', // YYYY-MM-DD-HH
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '14d'
        })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    Sys.Log.add(new winston.transports.Console({
        level: 'debug',
        timestamp: true,
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.timestamp(),
            winston.format.printf((info) => {
                const {
                    timestamp,
                    level,
                    message,
                    ...args
                } = info;
                const ts = timestamp.slice(0, 19).replace('T', ' ');
                return `${ts} [${level}]: ${message} ${Object.keys(args).length ? JSON.stringify(args, null, 2) : ''}`;
            })
        ),
    }));
}

Sys.Log.info('Initializing Server...');

fs.readdirSync(path.join(__dirname, '../', './App'))
    .filter(function (file) {
        return (file.indexOf(".") !== 0) && (file.indexOf(".") === -1);
    })
    .forEach(function (dir) {
        if (dir != 'Views' && dir != 'Routes') { // Ignore Load Views & Routes in Sys Object
            Sys.App[dir] = {};
            Sys.Log.info('Loading... App ' + dir);
            fs
                .readdirSync(path.join(__dirname, '../', './App', dir))
                .filter(function (file) {
                    return (file.indexOf(".") !== 0);
                })
                .forEach(function (file) {
                    Sys.App[dir][file.split('.')[0]] = require(path.join(__dirname, '../', './App', dir, file));
                });
        }
    });

Sys.Log.info('Loading... Game Server...');
Sys.Game = {};

let insidePath = null;
fs.readdirSync(path.join(__dirname, '../', './Game'))
    .filter(function (file) {
        return (file.indexOf(".") !== 0) && (file.indexOf(".") === -1);
    }).forEach(function (dir) {
        Sys.Game[dir] = {};
        // Sys.Log.info('Loading... Game '+dir);
        fs.readdirSync(path.join(__dirname, '../', './Game', dir)).filter(function (file) {
            return (file.indexOf(".") !== 0);
        }).forEach(function (subDir) {
            // Sys.Log.info('Loading... Game Sub Directory :'+subDir);
            insidePath = dir + '/' + subDir;
            if (fs.existsSync(path.join(__dirname, '../', './Game', insidePath))) {
                if (fs.lstatSync(path.join(__dirname, '../', './Game', insidePath)).isFile()) {
                    // Sys.Log.info('Loading... File :'+subDir);
                    Sys.Game[dir][subDir.split('.')[0]] = require(path.join(__dirname, '../', './Game', dir, subDir)); // Add File in Sub Folder Object
                } else {
                    Sys.Game[dir][subDir] = {};
                    // Sys.Log.info('Loading... Game Sub Directory Folder:'+insidePath);
                    fs.readdirSync(path.join(__dirname, '../', './Game', insidePath)).filter(function (file) {
                        return (file.indexOf(".") !== 0);
                    }).forEach(function (subInnerDir) {
                        insidePath = dir + '/' + subDir + '/' + subInnerDir;
                        // Sys.Log.info('Loading... Game Sub  Inner Directory :'+subInnerDir);
                        if (fs.lstatSync(path.join(__dirname, '../', './Game', insidePath)).isFile()) {
                            // Sys.Log.info('Loading... Sub  File :'+subInnerDir);
                            Sys.Game[dir][subDir][subInnerDir.split('.')[0]] = require(path.join(__dirname, '../', './Game', dir + '/' + subDir, subInnerDir)); // Add File in Sub Folder Object
                        } else {
                            Sys.Game[dir][subDir][subInnerDir] = {};
                            // Sys.Log.info('Loading... Game Sub Inner Directory Folder:'+insidePath);
                            fs.readdirSync(path.join(__dirname, '../', './Game', insidePath)).filter(function (file) {
                                return (file.indexOf(".") !== 0);
                            }).forEach(function (subInnerLastDir) {
                                insidePath = dir + '/' + subDir + '/' + subInnerDir + '/' + subInnerLastDir;
                                // Sys.Log.info('Loading... Game Sub  Inner Directory :'+insidePath);
                                if (fs.lstatSync(path.join(__dirname, '../', './Game', insidePath)).isFile()) {
                                    // Sys.Log.info('Loading... Sub Last  File :'+subInnerLastDir);
                                    Sys.Game[dir][subDir][subInnerDir][subInnerLastDir.split('.')[0]] = require(path.join(__dirname, '../', './Game', dir + '/' + subDir + '/' + subInnerDir, subInnerLastDir)); // Add File in Sub Folder Object
                                } else {
                                    // Sys.Log.info('Loading... Sub Last  Folder Plase Change Your Code:'+subInnerLastDir);
                                }
                            });
                        }
                    });
                }
            }
        });
    });

Sys.Log.info('Loading... Router');
// Load Router
fs.readdirSync(join(__dirname, '../App/Routes'))
    .filter(file => ~file.search(/^[^\.].*\.js$/))
    .forEach(function (file) {
        Sys.App.use('/', require(join(join(__dirname, '../App/Routes'), file))); // Register Router to app.use
    });

Sys.Log.info('Initializing Variables');
Sys.Timers = [];
Sys.Running = [];
Sys.StartedGame = [];
Sys.ConnectedPlayers = {};
Sys.GameTimers = [];
Sys.Game5Timers = [];
Sys.AvailableGamesForHall = {};
Sys.Log.info('Loading... DB Connection');
// Mongodb Connection

var dbURI = '';
if (Sys.Config.Database.mongoUri) {
    // Direct connection string (e.g. MongoDB Atlas: mongodb+srv://...)
    dbURI = Sys.Config.Database.mongoUri;
} else if (Sys.Config.Database.connectionType === 'local') {
    dbURI = 'mongodb://' + Sys.Config.Database.mongo.host + ':' + Sys.Config.Database.mongo.port + '/' + Sys.Config.Database.mongo.database;
} else {
    dbURI = 'mongodb://' + Sys.Config.Database.mongo.user + ':' + Sys.Config.Database.mongo.password + '@' + Sys.Config.Database.mongo.host + ':' + Sys.Config.Database.mongo.port + '/' + Sys.Config.Database.mongo.database;
}
mongoose.set('strictQuery', false); //Testing
mongoose.connect(dbURI, Sys.Config.Database.option);
// CONNECTION EVENTS
// When successfully connected
mongoose.connection.on('connected', async function () {
    Sys.Namespace = [];
    Sys.Log.info('Mongoose Default Connection Open To [ ' + dbURI + ' ]');
    Sys.Log.info('Loading... Setting');
    Sys.Setting = await Sys.App.Services.SettingsServices.getSettingsData({});
    let ptrnCount = await Sys.App.Services.patternServices.getSelectedGamePatternCount({ gameType: "game_3", patternName: { $in: ['Row 1', 'Row 2', 'Row 3', 'Row 4'] } });
    console.log('ptrnCount', ptrnCount);
    if (ptrnCount < 4) {
        let ptrn = ['Row 1', 'Row 2', 'Row 3', 'Row 4'];
        function dateTimeFunction(dateData) {
            let dt = new Date(dateData);
            let date = dt.getDate();
            let month = parseInt(dt.getMonth() + 1);
            let year = dt.getFullYear();
            let hours = dt.getHours();
            let minutes = dt.getMinutes();
            let seconds = dt.getSeconds();
            let miliSeconds = dt.getMilliseconds();
            let ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12;
            hours = hours ? hours : 12;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            seconds = seconds < 10 ? '0' + seconds : seconds;
            let dateTime = year + '' + month + '' + date + '_' + hours + '' + minutes + seconds + miliSeconds;
            return dateTime; // Function returns the dateandtime
        }
        for (let i = 0; i < ptrn.length; i++) {
            var ID = Date.now()
            var createID = dateTimeFunction(ID);
            let fixedPatternType = await Sys.Game.Common.Controllers.GameController.fixedPatternType(ptrn[i]);
            let Pattern = await Sys.App.Services.patternServices.insertGamePatternData({
                gameName: 'Game3',
                gameType: 'game_3',
                patternNumber: createID + '_G3Pattern',
                patternName: ptrn[i],
                count: 0,
                isFixedPtrn: true,
                fixedPatternType: fixedPatternType
            });
        }
    }
    Sys.App.Controllers.patternController.checkGame5Patterns();
    
    const io = socketInit(Sys, sessionMiddleware);
    
    const { exec } = require("child_process");
    exec("node -v", function (req, res) {
        console.log("[ -------------------- ]");
        console.log('\x1b[36m%s\x1b[0m', 'Node Version: ', res);
    })
    exec("mongod --version", function (req, res) {
        console.log('\x1b[36m%s\x1b[0m', 'Mongodb Version: ', res);
        console.log("[ -------------------- ]");
    })

    Sys.App.get('eventEmitter').emit('game4botcheckup', { botPlay: true })

    
    //put  '0.0.0.0' after port if you only want to listen to ipv4 address
    Sys.Server.listen(Sys.Config.Socket.port, function () {
        Sys.App.use(function (req, res, next) {
            res.render('404.html');
        });

        var numWorkers = require('os').cpus().length;

        console.log("(---------------------------------------------------------------)");
        console.log("numWorkers", numWorkers);
        console.log("(---------------------------------------------------------------)");

        console.log("(---------------------------------------------------------------)");
        console.log(" |                    Server Started...                        |");
        console.log(" |                  http://" + Sys.Config.Database.mongo.host + ":" + Sys.Config.Socket.port + "                      |");
        console.log("(---------------------------------------------------------------)");

        /* setInterval(function(){ 
            const {rss,heapTotal} = process.memoryUsage();
            // Send Broadcast only for Dashboard 
            let data = {
                rss: parseInt(rss/1024/1024),
                heap: parseInt(heapTotal/1024/1024)
            }
            Sys.Io.to('memory').emit('live_memory',data ) // 
        }, 1000); */

        //Sys.Log.info('Server Start.... Port :'+Sys.Config.Socket.port);
    });


    // *    *    *    *    *    *
    // ┬    ┬    ┬    ┬    ┬    ┬
    // │    │    │    │    │    │
    // │    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
    // │    │    │    │    └───── month (1 - 12)
    // │    │    │    └────────── day of month (1 - 31)
    // │    │    └─────────────── hour (0 - 23)
    // │    └──────────────────── minute (0 - 59)
    // └───────────────────────── second (0 - 59, OPTIONAL)

    new CronJob('0 0 * * *', async function () { //Daily one time run at 12 am for loyalty 
        console.log("Loyalty corn run once per day");
        //Sys.Game.Common.Controllers.GameController.loyaltyPointsPlayer(); // We are not using points money
        Sys.Game.Game1.Controllers.GameController.deleteDailySchedules();
        Sys.Game.Common.Controllers.PlayerController.generateExcelOfWithdraw();
        await Sys.App.Controllers.machineApiController.autoCloseTicket({machineName: "Metronia"});
        await Sys.App.Controllers.machineApiController.autoCloseTicket({machineName: "OK Bingo"});
        await Sys.App.Controllers.PlayerController.checkBankIdAndIdCardExpiryAndSendReminders(); // BankId Reminder Cron
        Sys.Game.Common.Controllers.PlayerController.updatePlayerBlockRules(); // remove expired block rules
    }, null, true);

    // We are not using points money
    // new CronJob('0 8 * * 1', async function () { // '0 8 * * 1' Runs 8 AM on every Monday for Leaderboard Points 
    //     console.log("Leaderboard corn run once per week");
    //     Sys.Game.Common.Controllers.GameController.leaderboardPointsPlayer();
    // }, null, true);

    new CronJob('0 * * * *', async function () { //for every hour
        console.log("Running cron job at every hour");
        Sys.Game.Common.Controllers.PlayerController.swedbankpayCronToUpdateTransaction(); // verifoneCronToUpdateTransaction
    }, null, true);

    setInterval(function () { // Every 15 sec run
        Sys.Game.Common.Controllers.GameController.startGameCron();
    }, 15000); //New

    setInterval(function () { // Every 1 min run
        Sys.Game.Common.Controllers.GameController.sendGameStartNotifications();
    }, 1 * 60000); //5000

    Sys.Game.Common.Controllers.GameController.game1StatusCron(); // default call on server restart
    setInterval(function () { // Every 5 min run 
        Sys.Game.Common.Controllers.GameController.game1StatusCron();
    }, 5 * 60000); //New

    Sys.Game.Game4.Controllers.GameController.handleServerRestart(); // Game 4 handle server restart for running game

});


// If the connection throws an error
mongoose.connection.on('error', async function (err) {
    Sys.Log.info('Mongoose default connection error: ' + err);
});

// When the connection is disconnected
mongoose.connection.on('disconnected', function () {
    Sys.Log.info('Mongoose default connection disconnected');
});

// If the Node process ends, close the Mongoose connection
process.on('SIGINT', function () {
    mongoose.connection.close(function () {
        Sys.Log.info('Mongoose default connection disconnected through app termination');
        process.exit(0);
    });
});

// Game Timer check
// setInterval(function() {
//     
// }, 2000);

// Regular tournament status check
// setInterval(function(){ 
// 	// Regular tournament status check
// 	Sys.Game.Common.Controllers.TournamentController.checkRegularTournamentStatus();
// }, 4000);

// setInterval(function(){ 
// 	// Regular tournament status check
// 	Sys.Game.CashGame.Texas.Controllers.PlayerController.removePlayerFromRooms();
// }, 10000); 
Sys.Game.Game5.Controllers.GameController.refundGame5();
Sys.Game.Game2.Controllers.GameProcess.checkForBotGames(null);
//Sys.Game.Common.Services.PlayerServices.deleteManyPlayerByData({userType: "Bot"});
Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "Restart" });
//Sys.App.Services.transactionServices.deleteManyTransactions({gameType:"game_3", gameNumber: "CH_1_2024219_542069_G3"});
Sys.Game.Game3.Controllers.GameProcess.handleServerRestart(null); // use to handle real and bot game restart
//Sys.Game.Common.Controllers.PlayerController.verifoneCronToUpdateTransaction();
//Sys.Game.Common.Controllers.PlayerController.generateExcelOfWithdraw();
//Sys.Game.Common.Controllers.PlayerController.addCustomerNumberInExistingPlayers();
Sys.Game.Game1.Controllers.GameProcess.initGame1(null);
//Sys.App.Controllers.PlayerController.updatePlayerSchemaMultihall();
module.exports = { app: Sys.App, server: Sys.Server };
