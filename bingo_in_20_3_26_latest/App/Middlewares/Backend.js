var Sys = require('../../Boot/Sys');
var jwt = require('jsonwebtoken');

const flatCache = require('flat-cache');
let cache = flatCache.load('dashboardCache');

var jwtcofig = {
    'secret': process.env.JWT_SECRET
};
const { translate } = require('../../Config/i18n');
module.exports = {
    loginCheck: function(req, res, next) {
        if (req.session.login) {
            console.log("req.session.login", req.session.login);
            res.redirect('/dashboard');
        } else {
            next();
        }
    },
    // auth
    Authenticate: async function (req, res, next) {
        /*if(req.session && req.session.web && req.session.web.playerLogin){
            jwt.verify(
              req.session.web.details.jwt_token,
              jwtcofig.secret,
              async function (err, decoded) {
                if (err) {
                  console.log(err)
                  //return res.status(500).send({ auth: false, message: 'Failed to authenticate token.' });
                  req.session.destroy(function (err) {
                    req.logout();
                    const obj = {
                      status: 'expired',
                      result: null,
                      message: `Your session expired`,
                    };
                    return res.send(obj)
                  });
                } else {
                  res.locals.session = req.session.web.details;
                  console.log("local session", res.locals.session)
                  next();
                }
              }
            );
        }else{*/
        if (req.session.login) {

            if (req.session.details.is_admin != 'yes') {
                if (req.session.details.role == "player") {
                    let player = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: req.session.details.id });
                    req.session.details.chips = player.chips;
                    req.session.details.rake_chips = 0;
                    req.session.details.temp_chips = 0;
                    req.session.details.isTransferAllow = false;
                } else if (req.session.details.role == "agent") {

                    let hallsData = await Sys.App.Services.HallServices.getSingleHallData({_id: req.session.details.hall[0].id}, {activeAgents: 1, isSettled: 1});
                    // console.log("hallsData", hallsData)
                    if(hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0){
                        
                        let index = hallsData.activeAgents.findIndex((e) => e.id == req.session.details.id);
                        // console.log("index of agent ", index)
                        if(index >= 0){
                            const now = new Date();
                            const startOfDay = new Date(now);
                            startOfDay.setHours(0,0,0,0);
                            const loggedInAt = new Date(hallsData.activeAgents[index].date);
                            console.log("old and latest date", loggedInAt, startOfDay)
                            if(loggedInAt < startOfDay){
                                await module.exports.updateHallStatus(hallsData)
                                Sys.App.Services.HallServices.updateHallData({_id: hallsData.id}, { $set: { "activeAgents": [] } });
                                new Promise((resolve, reject) => {
                                    req.session.destroy((err) => {
                                        if (err) {
                                            reject(err);
                                        } else {
                                            resolve();
                                        }
                                    });
                                });
                                return res.redirect('/admin');
                            }
                        }else{
                            await module.exports.updateHallStatus(hallsData)
                            await Sys.App.Services.HallServices.updateHallData({_id: hallsData.id}, { $set: { "activeAgents": [] } });
                                new Promise((resolve, reject) => {
                                req.session.destroy((err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve();
                                    }
                                });
                            });
                            return res.redirect('/admin');
                            // const now = new Date();
                            // const startOfDay = new Date(now);
                            // startOfDay.setHours(0,0,0,0);
                            // const loggedInAt = new Date(hallsData.activeAgents[0].date);
                            // console.log("old and latest date 1", loggedInAt, startOfDay)
                            // if(loggedInAt < startOfDay){
                            //     await module.exports.updateHallStatus(hallsData)
                            //     return res.redirect('/admin');
                            // }
                        }
                    }else{
                        new Promise((resolve, reject) => {
                            req.session.destroy((err) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            });
                        });
                        return res.redirect('/admin');
                    }
                    let roleData = await Sys.App.Services.RoleServices.getById({ _id: req.session.details.roleId });
                    req.session.details.isPermission = roleData.permission;
                }

            } else {
                let adminChips = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.session.details.id });
                if(!req.session.details.isSuperAdmin){
                    req.session.details.isPermission = adminChips.permission;
                }
                req.session.details.chips = adminChips.chips;
                req.session.details.rake_chips = adminChips.rake_chips;
                req.session.details.temp_chips = adminChips.temp_chips;
                req.session.details.extraRakeChips = adminChips.extraRakeChips;
                req.session.details.isTransferAllow = adminChips.isTransferAllow;
            }



            jwt.verify(req.session.details.jwt_token, jwtcofig.secret, async function (err, decoded) {
                if (err) {
                    //return res.status(500).send({ auth: false, message: 'Failed to authenticate token.' });
                    req.session.destroy(function (err) {
                        // req.logout();
                        console.log("Session Destroy Process", err);
                        return res.redirect('/admin');
                    })
                } else {
                    res.locals.session = req.session.details;

                    //find out latest player counts
                    /*let player = await Sys.App.Services.PlayerServices.getPlayerData({isLatest: '0'});
                    let latestPlayerCount = player.length;
                    console.log("player count",latestPlayerCount);
                    res.locals.countObject = {
                        latestPlayerCount: latestPlayerCount,
                    };*/

                    next();
                }

            });

            //next();
        } else {
            res.redirect('/admin');
        }
        //}

    },

    HasRole: function(...allowed) {
        const isAllowed = role => allowed.indexOf(role) > -1;
        return function(req, res, next) {
            //console.log(req.session.details.role);
            /*if(req.session && req.session.web && req.session.web.playerLogin){
                if(!isAllowed(req.session.web.details.role)){
                    req.flash('error', 'You are Not allowed to access that page.');
                    return res.redirect('/group');
                }
                else next();
            }else{*/
            if (!isAllowed(req.session.details.role)) {
                if (req.session.details.role == 'player') {
                    req.flash('error', 'You are Not allowed to access that page.');
                    return res.redirect('/groups');
                } else {
                    req.flash('error', 'You are Not allowed to access that page.');
                    return res.redirect('/dashboard');
                }

            } else{ 
                next();
            }
            //}

        }
    },


    flatCacheMiddleware: function(req, res, next) {
        let key = '__express__' + req.originalUrl || req.url
        let cacheContent = cache.getKey(key);
        if (cacheContent) {
            res.send(cacheContent);
        } else {
            res.sendResponse = res.send
            res.send = (body) => {
                cache.setKey(key, body);
                cache.save();
                res.sendResponse(body)
            }
            next()
        }
    },

    updateHallStatus: async function(hallData){
        try{
            console.log("updateHallStatus data---", hallData)
            if(hallData && hallData.activeAgents.length > 0){
                // if(hallData.isSettled == true){
                //     let isSettled = true;
                //     for(let a=0; a < hallData.activeAgents.length; a++){
                //         let currentAgent = hallData.activeAgents[a];
                //         if(currentAgent.dailyBalance > 0 || currentAgent.totalDailyBalanceIn > 0 || currentAgent.totalCashIn > 0 || currentAgent.totalCashOut > 0 || currentAgent.toalCardIn > 0 || currentAgent.totalCardOut > 0 || currentAgent.sellingByCustomerNumber > 0 || currentAgent.dailyDifference > 0){
                //             isSettled = false;
                //             break;
                //         }
                //     }
                //     if(isSettled == false){
                //         Sys.App.Services.HallServices.updateHallData({_id: hallData._id}, { $set: { isSettled: isSettled } });
                //     }
                //     // let currentAgent = hallData.activeAgents[0];
                //     // if(currentAgent.dailyBalance > 0 || currentAgent.totalDailyBalanceIn > 0 || currentAgent.totalCashIn > 0 || currentAgent.totalCashOut > 0 || currentAgent.toalCardIn > 0 || currentAgent.totalCardOut > 0 || currentAgent.sellingByCustomerNumber > 0 || currentAgent.dailyDifference > 0){
                //     //     Sys.App.Services.HallServices.updateHallData({_id: hallData._id}, { $set: { isSettled: false } });
                //     // }
                // }

                let shiftIds = [];
                for(let s=0; s < hallData.activeAgents.length; s++){
                    shiftIds.push(hallData.activeAgents[s].shiftId);
                }

                if(shiftIds.length > 0){
                    let updateShifts = await Sys.App.Services.AgentServices.updateManyShiftData({_id: {$in: shiftIds} }, { isActive: false});
                    console.log("update shifts", updateShifts);
                }
                
            }
        }catch(e){
            console.log("Error in updating the hall status");
        }
    },

    authenticatePlayerGameToken: async function(req, res, next) {
        const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.split(" ")[1] : null;
        const language = req.body.language || 'nor';
        const secretKey = jwtcofig.secret;
        if (!token) {
            return res.send({
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), // 'Something went wrong...',
                statusCode: 401
            });
        }
        try {
            const payload = jwt.verify(token, secretKey); // Validate token
            req.player = payload; // Attach user info to request
            next();
        } catch (err) {
            return res.send({
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }), // 'Something went wrong...',
                statusCode: 403
            });
        }
    }
}