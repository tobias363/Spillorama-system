var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var jwtcofig = {
    'secret': process.env.JWT_SECRET
};
var request = require("request");
// [ Nodemailer to send email ]
const nodemailer = require('nodemailer');
const moment = require('moment');

const XmlReader = require('xml-reader');
const xmlQuery = require('xml-query');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
// create a defaultTransport using gmail and authentication that are
// stored in the `config.js` file.
var defaultTransport = nodemailer.createTransport({
    //service: 'Gmail',
    host: Sys.Config.App.mailer.host,
    port: Sys.Config.App.mailer.port,
    secure: false,
    auth: {
        user: Sys.Config.App.mailer.auth.user,
        pass: Sys.Config.App.mailer.auth.pass
    }
});

module.exports = {
    login: async function (req, res) {

        //------------------------

        try {
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };
            let isDefaultUser = null;
            isDefaultUser = await Sys.App.Services.UserServices.getUserData({});

            if (isDefaultUser == null || isDefaultUser.length == 0) {
                let insertedUser = await Sys.App.Services.UserServices.insertUserData({
                    name: Sys.Config.App.defaultUserLogin.name,
                    email: Sys.Config.App.defaultUserLogin.email,
                    password: bcrypt.hashSync(Sys.Config.App.defaultUserLogin.password, bcrypt.genSaltSync(8), null),
                    role: Sys.Config.App.defaultUserLogin.role,
                    avatar: Sys.Config.App.defaultUserLogin.avatar,
                    isSuperAdmin: true
                });
            }
            return res.render('login', data);
        } catch (e) {
            console.log("Error in login", e);
            return new Error(e);
        }
    },

    register: async function (req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };
            return res.render('register', data);
        } catch (e) {
            console.log("Error in register :", e);
            return new Error(e);
        }
    },

    transactionsPaymet: async function (req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };
            return res.render('transactionsPaymet', data);
        } catch (e) {
            console.log("Error in transactionsPaymet :", e);
            return new Error(e);
        }
    },

    postLogin: async function (req, res) {
        try {
            
            let player = null;
            player = await Sys.App.Services.UserServices.getUserData({ "email": { "$regex": req.body.email, "$options": "i" } });

            let isAdminAgent = false;
            if (player == null || player.length == 0) {
                // req.flash('error', 'Email Address Found..!!');
                // return res.redirect('/admin');
                player = await Sys.App.Services.AgentServices.getByData({ "email": { "$regex": req.body.email, "$options": "i" } });
                isAdminAgent = true;
                console.log("Agent Data Length", player.length, player);
                if (player == null || player.length == 0) {
                    console.log("Agent Not Found");
                    req.flash('error', 'Email Address Not Found..!!');
                    return res.redirect('/admin');
                } else if (player[0].status == "inactive") {
                    console.log("Agent Not Active");
                    req.flash('error', 'Agent is Not Active..!!');
                    return res.redirect('/admin');
                }

            }

            let passwordTrue = false;
            if (bcrypt.compareSync(req.body.password, player[0].password)) {
                passwordTrue = true;
            }
            if (passwordTrue) {

                let datasRole;

                if (isAdminAgent == true) {
                    datasRole = await Sys.App.Services.RoleServices.getById({ _id: player[0].roleId })
                    if (datasRole == null || datasRole.length == 0) {
                        console.log("Agent Dont Have Any Roles.");
                        req.flash('error', 'No Role assigne to you,Please contact admin.');
                        return res.redirect('/admin');
                    }
                }
                let ip = '';
                let hall = [];

                //If Agent Trying To log in 
                if ((!player[0].role || player[0].role !== 'admin')) {
                    if(ip == ''){
                    //Get IP Address
                    console.log("req.ip", req.ip);
                    console.log("req.socket.remoteAddress", req.socket.remoteAddress);
                    console.log("req.headers['x-forwarded-for']", req.headers['x-forwarded-for']);
                    console.log("req.headers['x-real-ip']", req.headers['x-real-ip']);
                    ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress;
                    ip = convertIPv6MappedToIPv4(ip);
                    }
                    console.log("Final IP", ip);
                    
                    //Find Hall With Same IP Address
                    let halls = await Sys.App.Services.HallServices.getByData({ "ip": ip, "agents.id": player[0]._id });
                    if (halls.length == 0) {
                        console.log("Hall Not Found.");

                        // chekc for "Test Hall" Which is "Oslo bingo" for which we dont need to check for ip
                        if (player[0].hall.length > 0) {
                            const hallDetail = player[0].hall.find(obj => obj.name == "Oslo bingo");
                            console.log("hallDetail of test hall---", hallDetail)
                            if (hallDetail) {
                                hall.push(hallDetail);
                            } else {
                                req.flash('error', 'Hall Not Found With This IP Address. Please Contact Administrator.');
                                return res.redirect('/admin');
                            }
                        } else {
                            req.flash('error', 'Hall Not Found With This IP Address. Please Contact Administrator.');
                            return res.redirect('/admin');
                        }

                    } else if (halls.length && halls[0].status == "inactive") {
                        console.log("Your Current Hall is Not Active..");
                        req.flash('error', 'Your Current Hall is Not Active. Please Contact Administrator.');
                        return res.redirect('/admin');
                    } else {
                        for (let i = 0; i < player[0].hall.length; i++) {
                            if (halls[0]._id.toString() == player[0].hall[i].id.toString()) {
                                hall.push(player[0].hall[i]);
                            }
                        }
                    }
                }

                // User Authenticate Success

                // set jwt token
                let expiresIn = (60 * 60 * 24);
                if (player[0].role == 'admin') {
                    expiresIn = (60 * 60 * 24 * 30);
                }
                let token = jwt.sign({ id: player[0].id }, jwtcofig.secret, {
                    expiresIn: expiresIn // expires in 24 hours
                });
                req.session.login = true;
                req.session.details = {
                    id: player[0].id,
                    name: player[0].name,
                    jwt_token: token,
                    avatar: 'user.png',
                    is_admin: (isAdminAgent == false) ? 'yes' : 'no',
                    role: (isAdminAgent == false) ? 'admin' : 'agent',
                    isPermission: (isAdminAgent == false) ? player[0].permission : (datasRole == null) ? '' : datasRole.permission,
                    roleId: player[0].roleId ? player[0].roleId : '',
                    customIdAgent: (isAdminAgent == false) ? '' : datasRole.agentId,
                    chips: (isAdminAgent == false) ? player[0].chips : 0,
                    temp_chips: (isAdminAgent == false) ? player[0].temp_chips : 0,
                    rake_chips: player[0].rake_chips ? player[0].rake_chips : 0,
                    extraRakeChips: player[0].extraRakeChips ? player[0].extraRakeChips : 0,
                    isSuperAdmin: (isAdminAgent == false) ? player[0].isSuperAdmin : false,
                    groupHall: (isAdminAgent == false) ? '' : player[0].groupHall,
                    isTransferAllow: player[0].isTransferAllow ? player[0].isTransferAllow : "true",
                    hall: (isAdminAgent == false) ? [] : hall,
                    currentIP: (isAdminAgent == false) ? '' : ip,
                    language: player[0].language
                };

                if (player[0].avatar) {
                    req.session.details.avatar = player[0].avatar;
                }

                console.log("req.session", req.session);
                // let maintenanceMode = false;
                // if (Sys.Setting && Sys.Setting.maintenance) {
                //     if (Sys.Setting.maintenance.status == 'active') {
                //         maintenanceMode = true;
                //     }
                // }
                // Sys.Config.App.details.maintenanceMode = maintenanceMode;

                let keys = [
                    "welcome_to_admin_panel",
                    "welcome_to_agent_portal"
                ]
                let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

                if (isAdminAgent == false) {
                    req.flash('success', translate.welcome_to_admin_panel);
                    await req.session.save()
                    res.redirect('/dashboard');
                } else {

                    if (hall && hall.length > 0) {
                        console.log("hall of login agent", hall, req.session.details);
                        let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hall[0].id }, { activeAgents: 1, hallCashBalance: 1, hallDropsafeBalance: 1, otherData: 1 });
                        console.log("halls active agent", hallsData.activeAgents);
                        let alreadyLoggedin = false;
                        let isActive = false;
                        if (hallsData.activeAgents && hallsData.activeAgents.length > 0) {

                            let index = hallsData.activeAgents.findIndex((e) => e.id == req.session.details.id);
                            if (index >= 0) {
                                const now = new Date();
                                const startOfDay = new Date(now);
                                startOfDay.setHours(0, 0, 0, 0);
                                const loggedInAt = new Date(hallsData.activeAgents[index].date);

                                if (loggedInAt < startOfDay) {
                                    hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id }, { $set: { "activeAgents": [] } }, { new: true });
                                } else {
                                    alreadyLoggedin = true;
                                    req.session.details.shiftId = hallsData.activeAgents[index].shiftId;
                                    req.session.details.dailyBalance = hallsData.activeAgents[index].dailyBalance;
                                }
                            } else {
                                const now = new Date();
                                const startOfDay = new Date(now);
                                startOfDay.setHours(0, 0, 0, 0);
                                const loggedInAt = new Date(hallsData.activeAgents[0].date);
                                if (loggedInAt < startOfDay) {
                                    hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id }, { $set: { "activeAgents": [] } }, { new: true });
                                }
                            }
                            //alreadyLoggedin = hallsData.activeAgents.some(agent => agent.id == req.session.details.id);
                            //isActive = (hallsData.activeAgents[0].id == req.session.details.id);
                            //console.log("alreadyLoggedin and active---", alreadyLoggedin, isActive);
                        }
                        if (alreadyLoggedin == false) {
                            console.log("inside 1")
                            let agentShift = await Sys.App.Services.AgentServices.insertShiftData({
                                hallId: hall[0].id,
                                agentId: req.session.details.id,
                                hallCashBalance: hallsData.hallCashBalance,
                                hallDropsafeBalance: hallsData.hallDropsafeBalance,
                                dailyDifference: 0,
                                dailyBalance: 0,
                                totalDailyBalanceIn: 0,
                                totalCashIn: 0,
                                totalCashOut: 0,
                                toalCardIn: 0,
                                totalCardOut: 0,
                                sellingByCustomerNumber: 0,
                                isActive: true, //(hallsData.activeAgents.length == 0) ? true : false,
                                'controlDailyBalance.isDone': false,
                                startTime: new Date(),
                            });

                            //set shift data for tracking purpose
                            req.session.details.shiftId = agentShift.id;
                            req.session.details.dailyBalance = agentShift.dailyBalance;
                            hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hall[0].id }, { $push: { "activeAgents": { id: req.session.details.id, name: req.session.details.name, shiftId: agentShift.id, dailyBalance: 0, totalDailyBalanceIn: 0, totalCashIn: 0, totalCashOut: 0, toalCardIn: 0, totalCardOut: 0, sellingByCustomerNumber: 0, hallCashBalance: hallsData.hallCashBalance, hallDropsafeBalance: hallsData.hallDropsafeBalance, dailyDifference: 0, date: new Date() } } }, { new: true })
                            //console.log("inside 2", updatedHall.isSettled, updatedHall.otherData?.currentShiftId, updatedHall.activeAgents)
                            // if(updatedHall && updatedHall.activeAgents.length > 0){

                            //     if(updatedHall.isSettled == false && updatedHall.otherData.currentShiftId && updatedHall.activeAgents.length == 1 ){
                            //         let currentShiftData = await Sys.App.Services.AgentServices.getShiftById(updatedHall.otherData.currentShiftId)
                            //         console.log("currentShiftData when all agents logs out and settlment is not done", currentShiftData);
                            //         if(currentShiftData){
                            //             let isPreviousDaySettlementPending = false;
                            //             const startOfDay = new Date(new Date());
                            //             startOfDay.setHours(0,0,0,0);
                            //             const loggedInAt = new Date(currentShiftData.createdAt);
                            //             console.log("old and latest date 1", loggedInAt, startOfDay)
                            //             if(loggedInAt < startOfDay && (currentShiftData.dailyBalance > 0 || currentShiftData.totalDailyBalanceIn > 0 || currentShiftData.totalCashIn > 0 || currentShiftData.totalCashOut > 0 || currentShiftData.toalCardIn > 0 || currentShiftData.totalCardOut > 0 || currentShiftData.sellingByCustomerNumber > 0) ){
                            //                 isPreviousDaySettlementPending = true;
                            //             }
                            //             if(updatedHall.otherData?.isPreviousDaySettlementPending == true){
                            //                 isPreviousDaySettlementPending = true;
                            //             }
                            //             await Sys.App.Services.HallServices.updateHall({ _id: updatedHall.id, "activeAgents.id":  updatedHall.activeAgents[0].id }, 
                            //             { $set: 
                            //                 { 
                            //                     "activeAgents.$.dailyBalance": currentShiftData.dailyBalance, 
                            //                     "activeAgents.$.totalDailyBalanceIn": currentShiftData.totalDailyBalanceIn, 
                            //                     "activeAgents.$.totalCashIn": currentShiftData.totalCashIn, 
                            //                     "activeAgents.$.totalCashOut": currentShiftData.totalCashOut, 
                            //                     "activeAgents.$.toalCardIn": currentShiftData.toalCardIn, 
                            //                     "activeAgents.$.totalCardOut": currentShiftData.totalCardOut,
                            //                     "activeAgents.$.sellingByCustomerNumber": currentShiftData.sellingByCustomerNumber,
                            //                     "activeAgents.$.hallCashBalance": updatedHall.hallCashBalance,
                            //                     'otherData.currentShiftId': updatedHall.activeAgents[0].shiftId,
                            //                     'otherData.isPreviousDaySettlementPending': isPreviousDaySettlementPending,
                            //                     'otherData.previousDaySettlementDate': moment(currentShiftData.createdAt).toDate()
                            //                 } 
                            //             }, {new: true});

                            //             await Sys.App.Services.AgentServices.updateShiftData({ _id: updatedHall.activeAgents[0].shiftId  }, 
                            //                 { 
                            //                     isActive: true,
                            //                     dailyBalance: currentShiftData.dailyBalance, 
                            //                     totalDailyBalanceIn: currentShiftData.totalDailyBalanceIn, 
                            //                     totalCashIn: currentShiftData.totalCashIn, 
                            //                     totalCashOut: currentShiftData.totalCashOut, 
                            //                     toalCardIn: currentShiftData.toalCardIn, 
                            //                     totalCardOut: currentShiftData.totalCardOut,
                            //                     sellingByCustomerNumber: currentShiftData.sellingByCustomerNumber,
                            //                     hallCashBalance: updatedHall.hallCashBalance 
                            //                 }, 
                            //                 {new: true});
                            //                 req.session.details.dailyBalance = currentShiftData.dailyBalance;
                            //         }

                            //         // also need to update previous agent status


                            //     }

                            //     if(updatedHall.activeAgents.length == 1){
                            //         await Sys.App.Services.HallServices.updateHall({_id: hall[0].id}, { $set: { isSettled: false, 'otherData.currentShiftId': agentShift.id} });
                            //     }
                            // }

                        }

                        // check for last login


                        if (hallsData.otherData?.lastWorkingDate && req.session.details.shiftId) {
                            console.log("last working date found--", hallsData.otherData?.lastWorkingDate);
                            const startOfDay = new Date();
                            startOfDay.setHours(0, 0, 0, 0);
                            const lastWorkingDate = new Date(hallsData.otherData?.lastWorkingDate);
                            lastWorkingDate.setHours(0, 0, 0, 0);

                            const lastWorkingStartOfDay = new Date(hallsData.otherData?.lastWorkingDate);
                            lastWorkingStartOfDay.setHours(0, 0, 0, 0);
                            const lastWorkingEndOfDay = new Date(hallsData.otherData?.lastWorkingDate);
                            lastWorkingEndOfDay.setHours(23, 59, 59, 999);
                            console.log("before same date found ", startOfDay, lastWorkingDate, hallsData.activeAgents.length, hallsData.otherData.todayShiftIdWithoutTransfer)
                            if (lastWorkingDate < startOfDay) {
                                let isPreviousDaySettlementPending = false;
                                let isAnySettlement = false;
                                let isNeedtoAddBalances = false;

                                console.log("lastWorking start and end date---", lastWorkingStartOfDay, lastWorkingEndOfDay);
                                let lastShifts = await Sys.App.Services.AgentServices.getShiftByData({ hallId: hallsData.id, isDailyBalanceTransferred: false, startTime: { $gte: lastWorkingStartOfDay, $lt: lastWorkingEndOfDay } })
                                console.log("lastShifts---", lastShifts)
                                if (lastShifts && lastShifts.length > 0) {
                                    for (let s = 0; s < lastShifts.length; s++) {
                                        if (lastShifts[s]?.settlement) {
                                            isAnySettlement = true;
                                        }
                                        if (lastShifts[s].dailyBalance > 0) {
                                            console.log("daily balance is present so need to do settlment");
                                            isNeedtoAddBalances = true;

                                            let agentToUpdate = req.session.details.id;
                                            console.log("agentToUpdate---", agentToUpdate)
                                            
                                            await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id, "activeAgents.id":  agentToUpdate }, 
                                            { 
                                                $inc: {
                                                    "activeAgents.$.dailyBalance": lastShifts[s].dailyBalance, 
                                                },
                                            }, {new: true});
            
                                            let updatedShiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: req.session.details.shiftId }, 
                                            { 
                                                $inc: {
                                                    dailyBalance: lastShifts[s].dailyBalance,
                                                },
                                            }, 
                                            {new: true});

                                            await Sys.App.Services.AgentServices.updateShiftData({ _id: lastShifts[s]._id },
                                                {
                                                    $set: {
                                                        isDailyBalanceTransferred: true,
                                                    },
                                                });

                                            Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                                                shiftId: req.session.details.shiftId.toString(),
                                                hallId: updatedShiftData.hallId,
                                                dailyBalance: updatedShiftData.dailyBalance,
                                                totalDailyBalanceIn: updatedShiftData.totalDailyBalanceIn,
                                                totalCashIn: updatedShiftData.totalCashIn,
                                                totalCashOut: updatedShiftData.totalCashOut,
                                                toalCardIn: updatedShiftData.toalCardIn,
                                                totalCardOut: updatedShiftData.totalCardOut,
                                                totalHallCashBalance: hallsData.hallCashBalance
                                            });
                                            req.session.details.dailyBalance = updatedShiftData.dailyBalance;

                                        }
                                    }
                                }


                                if ((isAnySettlement == false || isNeedtoAddBalances == true) && lastShifts && lastShifts.length > 0) {
                                    isPreviousDaySettlementPending = true;
                                }
                                if (lastShifts && lastShifts.length > 0) {
                                    hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hall[0].id }, { $set: { 'otherData.isPreviousDaySettlementPending': isPreviousDaySettlementPending, 'otherData.previousDaySettlementDate': moment(lastShifts[0].createdAt).toDate() } }, { new: true })
                                } else {
                                    hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hall[0].id }, { $set: { 'otherData.isPreviousDaySettlementPending': isPreviousDaySettlementPending } }, { new: true })
                                }


                            } else if (startOfDay.getTime() == lastWorkingDate.getTime() && hallsData.activeAgents.length == 1 && hallsData.otherData.todayShiftIdWithoutTransfer) {
                                console.log("same date found", startOfDay, lastWorkingDate, hallsData.activeAgents.length, hallsData.otherData.todayShiftIdWithoutTransfer)
                                let lastShifts = await Sys.App.Services.AgentServices.getShiftByData({ _id: hallsData.otherData.todayShiftIdWithoutTransfer, hallId: hallsData.id, startTime: { $gte: lastWorkingStartOfDay, $lt: lastWorkingEndOfDay } })
                                console.log("lastShifts---", lastShifts)
                                if (lastShifts && lastShifts.length > 0) {
                                    for (let s = 0; s < lastShifts.length; s++) {

                                        if (lastShifts[s].dailyBalance > 0) {

                                            let agentToUpdate = req.session.details.id;
                                    
                                            await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id, "activeAgents.id":  agentToUpdate }, 
                                            { 
                                                $inc: {
                                                    "activeAgents.$.dailyBalance": lastShifts[s].dailyBalance, 
                                                },
                                                $set: {
                                                    "hallsData.otherData.todayShiftIdWithoutTransfer": ""
                                                }
                                            }, {new: true});
            
                                            let updatedShiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: req.session.details.shiftId }, 
                                            { 
                                                $inc: {
                                                    dailyBalance: lastShifts[s].dailyBalance,
                                                },
                                            }, 
                                            {new: true});
                                                

                                            Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                                                shiftId: req.session.details.shiftId.toString(),
                                                hallId: updatedShiftData.hallId,
                                                dailyBalance: updatedShiftData.dailyBalance,
                                                totalDailyBalanceIn: updatedShiftData.totalDailyBalanceIn,
                                                totalCashIn: updatedShiftData.totalCashIn,
                                                totalCashOut: updatedShiftData.totalCashOut,
                                                toalCardIn: updatedShiftData.toalCardIn,
                                                totalCardOut: updatedShiftData.totalCardOut,
                                                totalHallCashBalance: hallsData.hallCashBalance
                                            });
                                            req.session.details.dailyBalance = updatedShiftData.dailyBalance;

                                        }
                                    }
                                }
                            } else {
                                console.log("in else", startOfDay, lastWorkingDate)
                            }
                        }

                        hallsData = await Sys.App.Services.HallServices.updateHall({ _id: hall[0].id }, { $set: { 'otherData.lastWorkingDate': new Date() } }, { new: true })

                        // if(req.session.details.shiftId){
                        //     // await Sys.App.Services.HallServices.updateHall({_id: hall[0].id}, 
                        //     // { 
                        //     //     $addToSet: { "otherData.pendingSettlementShiftIds": req.session.details.shiftId } 
                        //     // } , {new: true})

                        //     const pendingSettle =await Sys.App.Services.HallServices.updateHall({_id: hall[0].id, "otherData.pendingSettlement.agentId":  req.session.details.id }, 
                        //     { 
                        //         $set: { "otherData.pendingSettlement.$.shiftId": req.session.details.shiftId } 
                        //     } , {new: true});
                        //     console.log("pendingSettle---", pendingSettle)
                        //     if (!pendingSettle || !pendingSettle.otherData.pendingSettlement.some(shift => shift.agentId == req.session.details.id && shift.shiftId == req.session.details.shiftId)) {
                        //         console.log("inside")
                        //         await Sys.App.Services.HallServices.updateHall({_id: hall[0].id }, 
                        //         { 
                        //             $push: { "otherData.pendingSettlement": { shiftId: req.session.details.shiftId, agentId: req.session.details.id } },
                        //         });

                        //     }
                        // }




                        // if(alreadyLoggedin == true && isActive == true){
                        //     console.log("This agent is already logged in and active ");
                        // }else{
                        //     if(alreadyLoggedin == true && isActive == false){
                        //         console.log("This agent is already logged in but not active")
                        //     }else{
                        //         let agentShift = await Sys.App.Services.AgentServices.insertShiftData({
                        //             hallId: hall[0].id,
                        //             agentId: req.session.details.id,
                        //             dailyBalance: 0,
                        //             totalIn: 0,
                        //             totalOut: 0,
                        //             isActive: (hallsData.activeAgents.length == 0) ? true : false,
                        //             startTime: new Date(),
                        //         });
                        //         await Sys.App.Services.HallServices.updateHallData({_id: hall[0].id}, {$push: { "activeAgents": {id: req.session.details.id  ,name: req.session.details.name, shiftId: agentShift.id, date: new Date() } } })
                        //     }
                        // }


                    }
                    console.log("before redirecting to dashboaed from login")


                    req.flash('success', translate.welcome_to_agent_portal);
                    return res.redirect('/dashboard');
                }

            } else {
                req.flash('error', 'Invalid Credentials');
                res.redirect('/admin');
            }
        } catch (e) {
            console.log("Error in postLogin :", e);
            return new Error(e);
        }
    },

    forgotPassword: async function (req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };

            return res.render('forgot-password', data);
        } catch (e) {
            console.log("Error in forgotPassword :", e);
            return new Error(e);
        }
    },

    forgotPasswordSendMail: async function (req, res) {
        try {

            let user = null;
            user = await Sys.App.Services.UserServices.getUserData({ email: req.body.email });

            let isAdminAgent = false;
            if (user == null || user.length == 0) {
                //Check if Agent is login
                user = await Sys.App.Services.AgentServices.getByData({ email: req.body.email });
                isAdminAgent = true;

                if (user == null || user.length == 0) {
                    req.flash('error', 'No Such User Found,Please Enter Valid Registered Email.');
                    return res.redirect('/forgot-password');
                }

            }

            var token = jwt.sign({ id: req.body.email }, jwtcofig.secret, {
                expiresIn: 300 // expires in 24 hours
            });


            if (isAdminAgent == true) {
                await Sys.App.Services.AgentServices.updateAgentData({
                    _id: user[0]._id
                }, {
                    resetPasswordToken: token,
                    resetPasswordExpires: Date.now() + 60 * 60 * 60 * 60 * 24,
                });
            } else {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: user[0]._id
                }, {
                    resetPasswordToken: token,
                    resetPasswordExpires: Date.now() + 60 * 60 * 60 * 60 * 24,
                });
            }

            var mailOptions = {
                to: req.body.email,
                from: Sys.Config.App.mailer.defaultFromAddress,
                subject: (isAdminAgent == true) ? 'Spillorama Bingo Game : Agent Password Reset' : 'Spillorama Bingo Game : Admin Password Reset',
                text: 'You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n' +
                    'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
                    'http://' + req.headers.host + '/reset-password/' + token + '\n\n' +
                    'If you did not request this, please ignore this email and your password will remain unchanged.\n'
            };
            defaultTransport.sendMail(mailOptions, function (err) {
                if (!err) {
                    req.flash('success', 'An e-mail has been sent to ' + req.body.email + ' with further instructions.');
                    defaultTransport.close();
                    return res.redirect('/forgot-password');
                } else {
                    console.log(err);
                    req.flash('error', 'Error sending mail,please try again After some time.');
                    return res.redirect('/forgot-password');
                }
            });
        } catch (e) {
            console.log("Error in forgotPasswordSendMail :", e);
            return new Error(e);
        }
    },

    resetPassword: async function (req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };
            let user = null;

            user = await Sys.App.Services.UserServices.getUserData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });

            if (user == null || user.length == 0) {

                user = await Sys.App.Services.AgentServices.getByData({
                    resetPasswordToken: req.params.token,
                    resetPasswordExpires: { $gt: Date.now() }
                });

                if (user == null || user.length == 0) {
                    req.flash('error', 'Password reset token is invalid or has expired.');
                    return res.redirect('/forgot-password');
                }
            }
            data.user = user[0];
            return res.render('reset-password', data);
        } catch (e) {
            console.log("Error in resetPassword :", e);
            return new Error(e);
        }
    },

    postResetPassword: async function (req, res) {
        try {
            let user = null;

            user = await Sys.App.Services.UserServices.getUserData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });

            let isAdminAgent = false;
            if (user == null || user.length == 0) {

                user = await Sys.App.Services.AgentServices.getByData({
                    resetPasswordToken: req.params.token,
                    resetPasswordExpires: { $gt: Date.now() }
                });
                isAdminAgent = true;
                if (user == null || user.length == 0) {
                    req.flash('error', 'Password reset token is invalid or has expired.');
                    return res.redirect('/forgot-password');
                }
            }

            if (isAdminAgent == true) {
                await Sys.App.Services.AgentServices.updateAgentData({
                    _id: req.body.id
                }, {
                    password: bcrypt.hashSync(req.body.pass_confirmation, bcrypt.genSaltSync(8), null)
                });
            } else {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: req.body.id
                }, {
                    password: bcrypt.hashSync(req.body.pass_confirmation, bcrypt.genSaltSync(8), null)
                });
            }


            req.flash('success', 'Password updated successfully,Now you can Login with your New Password.');
            return res.redirect('/admin');
        } catch (e) {
            console.log("Error in postResetPassword :", e);
            req.flash('error', 'Error while upating password');
            return res.redirect(req.header('Referer'));
        }
    },

    playerResetPassword: async function (req, res) {
        try {
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
            };
            let user = null;
            user = await Sys.App.Services.PlayerServices.getByData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });

            if (user == null || user.length == 0) {
                //req.flash('error', 'Password reset token is invalid or has expired.');
                return res.render('resetPasswordSuc', { title: "Password Token Expired", message: "Password reset token is invalid or has expired." });
            }
            data.user = user[0];
            //console.log("final user", data);
            return res.render('playerResetPassword', data);
        } catch (e) {
            console.log("Error in resetPassword :", e);
            return new Error(e);
        }
    },

    playerPostResetPassword: async function (req, res) {
        try {
            let user = null;
            user = await Sys.App.Services.PlayerServices.getByData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });

            //console.log("user::::::::::::", user);

            if (user == null || user.length == 0) {
                //req.flash('error', 'Password reset token is invalid or has expired.');
                return res.render('resetPasswordSuc', { title: "Password Token Expired", message: "Password reset token is invalid or has expired." });
            }

            await Sys.App.Services.PlayerServices.update({
                _id: req.body.id
            }, {
                password: bcrypt.hashSync(req.body.pass_confirmation, bcrypt.genSaltSync(8), null),
                resetPasswordToken: null,
                resetPasswordExpires: null
            });

            const language = user[0].selectedLanguage === 'en' ? 'english' : 'norwegian'
            //req.flash('success', 'Password updated successfully,Now you can Login with your New Password.');
            return res.render('resetPasswordSuc', { title: await Sys.Helper.bingo.getSingleTraslateData(["password_reset_successfully"], language), message: await Sys.Helper.bingo.getSingleTraslateData(["password_updated_login_with_new"], language), thanks_msg: await Sys.Helper.bingo.getSingleTraslateData(["thank_you"], language) });
        } catch (e) {
            console.log("Error in postResetPassword :", e);
            req.flash('error', 'Error while upating password');
            return res.render('resetPasswordSuc', { title: "Error in Password Updating", message: "Error while upating password" });
            //return res.redirect(req.header('Referer'));
        }
    },

    logout: async function (req, res) {
        try {
            console.log("Logout called", req.session?.details?.role, req.query);

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.session.details.hall[0].id }, { name: 1, activeAgents: 1, groupHall: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    const index = hallsData.activeAgents.findIndex((e) => e.id == req.session.details.id);
                    console.log("index of agent ", index)

                    //Check if already any game 1 running in the hall
                    if (index >= 0) {
                        const startDate = new Date();
                        const endDate = new Date();
                        startDate.setHours(0, 0, 0);
                        endDate.setHours(23, 59, 59);

                        const gameQuery = {
                            gameType: "game_1",
                            halls: req.session.details.hall[0].id.toString(),
                            $or: [{ "status": "running" }, { "otherData.gameSecondaryStatus": "running" }],
                            startDate: {
                                $gte: startDate,
                                $lt: endDate
                            }
                        }
                        const runningGameCount = await Sys.App.Services.GameService.getSelectedGameCount(gameQuery);
                        if (runningGameCount) {
                            console.log("already running games", runningGameCount);
                            console.log("agent cant logout");
                            req.flash("error", `There is already running game in your hall, you can logout after the game finished.`)
                            return res.redirect('/agent/cashinout');
                        }


                        if (req?.query?.distributePhysicalWinnings == "yes") {
                            console.log("Need to distribute the winning of the ticket to the physical tickets");
                            try {
                                await Sys.Helper.gameHelper.assignWinningToAllPhysicalTicket({
                                    agentId: req.session.details.id,
                                    agentName: req.session.details.name,
                                    hallId: hallsData._id,
                                    hallName: hallsData.name,
                                    groupHall: hallsData.groupHall,
                                    shiftId: req.session.details.shiftId,
                                    dailyBalance: hallsData.activeAgents[index].dailyBalance,
                                    language: req.session.details.language
                                })
                            } catch (error) {
                                console.log("error while physical cashout", error);
                                req.flash('error', error.message);
                                return res.redirect('/admin')
                            }
                        }

                        // transfer tickets to next agent functionality
                        if (!req?.query?.transferTickets || req?.query?.transferTickets != "yes") {
                            console.log("Don't Need to Transfer tickets to next agent", req.query.transferTickets);

                            let response = await Sys.App.Controllers.agentcashinoutController.dontTransferTickets({
                                agentId: req.session.details.id,
                                agentName: req.session.details.name,
                                hallId: hallsData._id,
                                hallName: hallsData.name,
                                groupHall: hallsData.groupHall,
                                shiftId: req.session.details.shiftId,
                            });
                            console.log("response----", response)

                        }
                        // transfer tickets to next agent functionality


                        //update shift document
                        const shiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: req.session.details.shiftId }, { endTime: new Date(), updatedAt: new Date(), isActive: false, isDailyBalanceTransferred: true }, { new: true });

                        let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id }, { $pull: { "activeAgents": { id: req.session.details.id } } }, { new: true });
                        console.log("updatedHall----", updatedHall, shiftData, req.session.details.id);

                        if (updatedHall && updatedHall.activeAgents.length > 0) { // && updatedHall.otherData.currentShiftId == req.session.details.shiftId

                            for (let a = 0; a < updatedHall.activeAgents.length; a++) {
                                let agentToUpdate = updatedHall.activeAgents[a];
                                console.log("agentToUpdate---", agentToUpdate, shiftData.dailyBalance)

                                await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id, "activeAgents.id": agentToUpdate.id },
                                    {
                                        $inc: {
                                            "activeAgents.$.dailyBalance": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.dailyBalance,
                                            "activeAgents.$.totalDailyBalanceIn": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalDailyBalanceIn,
                                            "activeAgents.$.totalCashIn": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCashIn,
                                            "activeAgents.$.totalCashOut": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCashOut,
                                            "activeAgents.$.toalCardIn": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.toalCardIn,
                                            "activeAgents.$.totalCardOut": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCardOut,
                                            "activeAgents.$.sellingByCustomerNumber": (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.sellingByCustomerNumber,
                                        },
                                        $set:
                                        {
                                            "activeAgents.$.hallCashBalance": updatedHall.hallCashBalance,  //shiftData.hallCashBalance,
                                            "otherData.currentShiftId": agentToUpdate.shiftId,
                                            "isSettled": false,
                                            "otherData.todayShiftIdWithoutTransfer": ""
                                        }
                                    }, { new: true });

                                let updatedShiftData = await Sys.App.Services.AgentServices.updateShiftData({ _id: agentToUpdate.shiftId },
                                    {
                                        $inc: {
                                            dailyBalance: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.dailyBalance,
                                            totalDailyBalanceIn: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalDailyBalanceIn,
                                            totalCashIn: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCashIn,
                                            totalCashOut: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCashOut,
                                            toalCardIn: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.toalCardIn,
                                            totalCardOut: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.totalCardOut,
                                            sellingByCustomerNumber: (shiftData.settlement && isObjectNonEmpty(shiftData.settlement) && shiftData.dailyBalance == 0) ? 0 : shiftData.sellingByCustomerNumber,
                                        },
                                        $set: {
                                            hallCashBalance: updatedHall.hallCashBalance,  //shiftData.hallCashBalance 
                                        }

                                    },
                                    { new: true });
                                console.log("updatedShiftData---", updatedShiftData)
                                if (updatedShiftData) {
                                    Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                                        shiftId: agentToUpdate.shiftId.toString(),
                                        hallId: updatedShiftData.hallId,
                                        dailyBalance: updatedShiftData.dailyBalance,
                                        totalDailyBalanceIn: updatedShiftData.totalDailyBalanceIn,
                                        totalCashIn: updatedShiftData.totalCashIn,
                                        totalCashOut: updatedShiftData.totalCashOut,
                                        toalCardIn: updatedShiftData.toalCardIn,
                                        totalCardOut: updatedShiftData.totalCardOut,
                                        totalHallCashBalance: updatedHall.hallCashBalance
                                    });
                                }


                            }

                        } else if (updatedHall.activeAgents.length == 0) {
                            await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id },
                                {
                                    $set:
                                    {
                                        "otherData.todayShiftIdWithoutTransfer": shiftData.id,
                                    }
                                }, { new: true });
                        }

                        //delete hold sell physical ticket if not sold
                        await Sys.App.Controllers.physicalTicketsController.deleteholdSellTicketsOfAgent(req, res);
                    }
                }
            }

            req.session.destroy(function (err) {
                // req.logout();
                res.redirect('/admin');
            });
        } catch (e) {
            console.error("Error in logout :", e);
            return new Error(e);
        }
    },

    profile: async function (req, res) {
        try {
            user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.session.details.id });
            const keysArray = [
                "dashboard",
                "user_profile",
                "fullname",
                "email",
                "edit_profile",
                "change_password",
                "new_password",
                "confirm_password",
                "change_avatar",
                "sms_api_change_username_password",
                "password",
                "language",
                "update",
                "update_avatar",
                "username",
                "new_avatar"
            ];

            let profile = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                user: user,
                profile,
                navigation: profile,
            };
            return res.render('profile', data);
        } catch (e) {
            console.log("Error in profile : ", e);
            return new Error(e);
        }
    },

    profileUpdate: async function (req, res) {
        try {
            let user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.body.id });
            if (user) {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: req.body.id
                }, {
                    email: req.body.email,
                    name: req.body.name
                });

                // req.flash('success', 'Profile Updated Successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["profile_updated_successfully"], req.session.details.language)
                req.flash('success', translate.profile_updated_successfully);
                res.redirect('/profile');
            } else {
                // req.flash('error', 'Error in Profile Update');
                let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                req.flash('error', translate.err_profile_update);
                res.redirect('/profile');
            }
        } catch (e) {
            console.log("Error in profileUpdate :", e);
            return new Error(e);
        }
    },

    changePassword: async function (req, res) {
        try {
            let user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.body.id });
            console.log("CCNP:-SP CP ", req.body.pass_confirmation, " time:-", new Date())
            if (user) {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: req.body.id
                }, {
                    password: bcrypt.hashSync(req.body.pass_confirmation, bcrypt.genSaltSync(8), null)
                });
                let translate = await Sys.Helper.bingo.getTraslateData(["psw_updated_successfully"], req.session.details.language)
                // req.flash('success', 'Password update successfully');
                req.flash('success', translate.psw_updated_successfully);
                res.redirect('/profile');
            } else {
                // req.flash('error', 'Password not update successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["err_psw_update"], req.session.details.language)
                req.flash('error', translate.err_psw_update);
                return res.redirect('/profile');
            }
        } catch (e) {
            console.log("Error in ChangePassword :", e);
            let translate = await Sys.Helper.bingo.getTraslateData(["err_psw_update"], req.session.details.language)
            req.flash('error', translate.err_psw_update);
            return new Error(e);
        }
    },

    changeAvatar: async function (req, res) {
        try {

            if (req.files) {
                let image = req.files.avatar;
                console.log("data coming here :::", image, __dirname);
                var re = /(?:\.([^.]+))?$/;
                var ext = re.exec(image.name)[1];
                let fileName = Date.now() + '.' + ext;
                if (!fs.existsSync(path.join(__dirname, '../../public/profile'))) {
                    fs.mkdirSync(path.join(__dirname, '../../public/profile'));
                }
                // Use the mv() method to place the file somewhere on your server
                image.mv('./public/profile/' + fileName, async function (err) {
                    if (err) {
                        // req.flash('error', 'Error Uploading Profile Avatar');
                        let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                        req.flash('error', translate.err_profile_update);
                        return res.redirect('/profile');
                    }

                    let user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.body.id });
                    if (user) {
                        await Sys.App.Services.UserServices.updateUserData({
                            _id: req.body.id
                        }, {
                            avatar: fileName
                        });
                        req.session.details.avatar = fileName;

                        // req.flash('success', 'Profile Avatar Updated Successfully');
                        let translate = await Sys.Helper.bingo.getTraslateData(["profile_updated_successfully"], req.session.details.language)
                        req.flash('success', translate.profile_updated_successfully);
                        res.redirect('/profile');
                    } else {
                        let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                        req.flash('error', translate.err_profile_update);
                        return res.redirect('/profile');
                    }
                });
            } else {
                // req.flash('success', 'Profile Avatar Updated Successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["profile_updated_successfully"], req.session.details.language)
                req.flash('success', translate.profile_updated_successfully);
            }
        } catch (e) {
            console.log("Error in changeAvatar : ", e);
            let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
            req.flash('error', translate.err_profile_update);
            return new Error(e);
        }
    },

    changeSmsUsrPwd: async function (req, res) {
        try {
            let user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.body.id });
            if (user) {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: req.body.id
                }, {
                    smsUsername: req.body.name,
                    smsPassword: req.body.pass //bcrypt.hashSync(, bcrypt.genSaltSync(8), null)
                });
                // req.flash('success', 'Details are update successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["detail_update"], req.session.details.language)
                req.flash('success', translate.detail_update);
                res.redirect('/profile');
            } else {
                // req.flash('error', 'Details are not update successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["detail_not_update"], req.session.details.language)
                req.flash('error', translate.detail_not_update);
                return res.redirect('/profile');
            }
        } catch (error) {
            console.log("Error in changeSmsUsrPwd : ", error);
        }
    },

    agentProfile: async function (req, res) {
        try {
            let agent = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.session.details.id });
            ;
            const keysArray = [
                "dashboard",
                "user_profile",
                "fullname",
                "email",
                "edit_profile",
                "change_password",
                "new_password",
                "confirm_password",
                "change_avatar",
                "sms_api_change_username_password",
                "password",
                "language",
                "update",
                "update_avatar",
                "username",
                "new_avatar"
            ];

            let profile = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                user: agent,
                profile: profile,
                navigation: profile,
            };
            return res.render('agentProfile', data);
        } catch (e) {
            console.log("Error in agentProfile : ", e);
            return new Error(e);
        }
    },

    agentProfileUpdate: async function (req, res) {
        try {
            let user = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            if (user) {

                let data = {
                    email: req.body.email,
                    name: req.body.name
                }
                await Sys.App.Services.AgentServices.updateAgentData({ _id: req.body.id }, data)

                req.session.details.name = data.name;

                // req.flash('success', 'Profile Updated Successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["profile_updated_successfully"], req.session.details.language)
                req.flash('success', translate.profile_updated_successfully);
                res.redirect('/agent/profile');
            } else {
                // req.flash('error', 'Error in Profile Update');
                let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                req.flash('success',translate.err_profile_update );
                return res.redirect('/agent/profile');
            }
        } catch (e) {
            console.log("Error in agentProfileUpdate :", e);
            return new Error(e);
        }
    },

    agentChangePassword: async function (req, res) {
        try {
            let user = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            console.log("CCNP:-SP CP ", req.body.pass_confirmation, " time:-", new Date())
            if (user) {
                await Sys.App.Services.AgentServices.updateAgentData({
                    _id: req.body.id
                }, {
                    password: bcrypt.hashSync(req.body.pass_confirmation, bcrypt.genSaltSync(8), null)
                });
                // req.flash('success', 'Password update successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["psw_updated_successfully"], req.session.details.language)
                req.flash('success',translate.psw_updated_successfully );
                res.redirect('/agent/profile');
            } else {
                // req.flash('error', 'Password not update successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["err_psw_update"], req.session.details.language)
                req.flash('error', translate.err_psw_update);
                return res.redirect('/agent/profile');
            }
        } catch (e) {
            console.log("Error in agentChangePassword :", e);
            return new Error(e);
        }
    },

    agentChangeAvatar: async function (req, res) {
        try {
            if (req.files) {
                let image = req.files.avatar;
                console.log("Coming to update agent profile Picture", image);
                var re = /(?:\.([^.]+))?$/;
                var ext = re.exec(image.name)[1];
                let fileName = Date.now() + '.' + ext;
                // Use the mv() method to place the file somewhere on your server
                image.mv('./public/profile/' + fileName, async function (err) {
                    if (err) {
                        console.log(err);
                        // req.flash('error', 'Error Uploading Profile Avatar');
                        let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                        req.flash('error', translate.err_profile_update);
                        return res.redirect('/profile');
                    }

                    let user = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
                    if (user) {
                        await Sys.App.Services.AgentServices.updateAgentData({
                            _id: req.body.id
                        }, {
                            avatar: fileName
                        });
                        req.session.details.avatar = fileName;

                        // req.flash('success', 'Profile Avatar Updated Successfully');
                        let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                        req.flash('success', translate.profile_updated_successfully);
                        return res.redirect('/agent/profile');
                    } else {
                        // req.flash('error', 'Error in Profile Avatar Update');
                        let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                        req.flash('error', translate.err_profile_update);
                        return res.redirect('/agent/profile');
                    }
                });
            } else {
                // req.flash('success', 'Profile Avatar Updated Successfully');
                let translate = await Sys.Helper.bingo.getTraslateData(["err_profile_update"], req.session.details.language)
                req.flash('error', translate.err_profile_update);
                res.redirect('/agent/profile');
            }
        } catch (e) {
            console.log("Error in changeAvatar : ", e);
            return new Error(e);
        }
    },

    payment: async function (req, res) {
        try {
            console.log("payment 1", req.query);
            // console.log("payment 2", req.body);
            // console.log("payment 3", req.params);


            let deposit = await Sys.App.Services.depositMoneyServices.getSingleData({ transactionID: req.query.transactionId });
            if (deposit) {

                console.log("Same transactionID true/false =====>>>>>>>", deposit.transactionID == req.query.transactionId);

                if (deposit.transactionID == req.query.transactionId) {

                    if (req.query.responseCode == 'OK') {
                        var options = {
                            method: 'GET',
                            url: Sys.Config.App[Sys.Config.Database.connectionType].payment.processurl,
                            qs: {
                                merchantId: Sys.Config.App[Sys.Config.Database.connectionType].payment.merchantId,
                                token: Sys.Config.App[Sys.Config.Database.connectionType].payment.token,
                                transactionId: req.query.transactionId,
                                operation: 'AUTH'
                            }
                        };


                        var apiCalling = await Sys.Helper.bingo.paymentGetAPI(options);

                        console.log(" payment request apiCalling", apiCalling);

                        var ast = XmlReader.parseSync(apiCalling.data);

                        console.log("response body ast", xmlQuery(ast).children());
                        var errorType = xmlQuery(ast).children().find('Error').attr('xsi:type');
                        console.log("response body errorType", errorType);

                        if (errorType) {
                            var errorSection = 'AUTH';
                            var dataSend = {
                                depositId: deposit.id
                            }
                            var errorCheck = await Sys.Helper.bingo.errorCheck(errorType, errorSection, ast, dataSend);
                            console.log("errorCheck", errorCheck);
                            req.flash('error', errorCheck);
                            return res.render('transactionsPaymet', { title: "Transaction Failed", message: "Sorry your transcation failed becuase unable to authenticate..!!" });
                        } else {
                            var BatchNumber = xmlQuery(ast).find('BatchNumber').text();
                            var ExecutionTime = xmlQuery(ast).find('ExecutionTime').text();
                            var Operation = xmlQuery(ast).find('Operation').text();

                            let depositUpdateAuth = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                                batchNumber: BatchNumber,
                                executionTime: ExecutionTime,
                                operation: Operation,
                                responseCode: ResponseCode,
                                updatedAt: Date.now()
                            });


                            var options = {
                                method: 'GET',
                                url: Sys.Config.App[Sys.Config.Database.connectionType].payment.processurl,
                                qs: {
                                    merchantId: Sys.Config.App[Sys.Config.Database.connectionType].payment.merchantId,
                                    token: Sys.Config.App[Sys.Config.Database.connectionType].payment.token,
                                    transactionId: req.query.transactionId,
                                    transactionAmount: deposit.amount,
                                    operation: 'CAPTURE'
                                },
                            };
                            var apiCallingCAPTURE = await Sys.Helper.bingo.paymentGetAPI(options);


                            console.log(" payment request apiCalling", apiCallingCAPTURE);

                            var ast = XmlReader.parseSync(apiCallingCAPTURE.data);

                            console.log("response body ast", xmlQuery(ast).children());
                            var errorType = xmlQuery(ast).children().find('Error').attr('xsi:type');
                            console.log("response body errorType", errorType);

                            if (errorType) {
                                var errorSection = 'CAPTURE';
                                var dataSend = {
                                    depositId: deposit.id
                                }
                                var errorCheck = await Sys.Helper.bingo.errorCheck(errorType, errorSection, ast, dataSend);
                                console.log("errorCheck", errorCheck);
                                req.flash('error', errorCheck);
                                return res.render('transactionsPaymet', { title: "Transaction Failed", message: "Sorry your transcation failed becuase unable to authenticate..!!" });
                            } else {
                                var ResponseCode = xmlQuery(ast).find('ResponseCode').text();
                                console.log("response body ResponseCode", ResponseCode);

                                var ExecutionTime = xmlQuery(ast).find('ExecutionTime').text();
                                var Operation = xmlQuery(ast).find('Operation').text();

                                let depositUpdateCAPTURE = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                                    executionTime: ExecutionTime,
                                    operation: Operation,
                                    updatedAt: Date.now()
                                });
                                console.log("depositUpdateCAPTURE", depositUpdateCAPTURE);
                                if (ResponseCode == 'OK') {
                                    var options = {
                                        method: 'GET',
                                        url: Sys.Config.App[Sys.Config.Database.connectionType].payment.queryurl,
                                        qs: {
                                            merchantId: Sys.Config.App[Sys.Config.Database.connectionType].payment.merchantId,
                                            token: Sys.Config.App[Sys.Config.Database.connectionType].payment.token,
                                            transactionId: req.query.transactionId
                                        },
                                    };

                                    var apiCallingOK = await Sys.Helper.bingo.paymentGetAPI(options);
                                    console.log(" payment request apiCallingOK", apiCallingOK);

                                    var ast = XmlReader.parseSync(apiCallingOK.data);


                                    var message = 'Transaction is Complete';
                                    let depositUpdateFinal = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                                        message: message,
                                        operation: "query",
                                        responseCode: 'OK',
                                        status: "success",
                                        updatedAt: Date.now()
                                    });


                                    await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: deposit.playerId }, { $inc: { walletAmount: deposit.amount } });

                                    var transactionPointData = {
                                        transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                                        playerId: deposit.playerId,
                                        hallId: deposit.hallId,
                                        defineSlug: "extraTransaction",
                                        typeOfTransaction: "Deposit",
                                        category: "credit",
                                        status: "success",
                                        typeOfTransactionTotalAmount: deposit.amount,
                                        amtCategory: "realMoney",
                                        createdAt: Date.now(),
                                    }
                                    await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                                    // req.flash('success', 'Transaction is Complete..!!');
                                    let translate = await Sys.Helper.bingo.getTraslateData(["txn_complete"], req.session.details.language)
                                    req.flash('success', translate.txn_complete);
                                    return res.render('transactionsPaymet', { title: "Transaction Completed", message: "Your transaction is completed..!!" });
                                } else {
                                    var message = 'Transaction is Failed';
                                    let depositUpdateFinal = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                                        message: message,
                                        operation: "query",
                                        responseCode: 'Cancel',
                                        status: "fail",
                                        updatedAt: Date.now()
                                    });
                                    // req.flash('error', 'Transaction is Failed..!!');
                                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["txn_failed"], req.session.details.language));
                                    return res.render('transactionsPaymet', { title: "Transaction Failed", message: "Sorry your transcation failed" });
                                }
                            }
                        }
                    } else {
                        console.log("responseCode 2", req.query.responseCode);
                        var message = 'Transaction is Cancel by user';
                        let depositUpdateFinal = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                            message: message,
                            status: "fail",
                            updatedAt: Date.now()
                        });
                        // req.flash('success', 'Transaction is Cancel..!!');
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["txn_failed"], req.session.details.language));
                        return res.render('transactionsPaymet', { title: "Transaction Cancel", message: "Transaction was cancel" });
                    }

                } else {
                    var message = 'Sorry Transaction ID Not Found';
                    let depositUpdateFinal = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                        message: message,
                        status: "fail",
                        updatedAt: Date.now()
                    });
                    // req.flash('error', 'Sorry Transaction ID Not Found');
                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["txn_id_not_found"], req.session.details.language));
                    return res.render('transactionsPaymet', { title: "Transaction Cancel", message: "Sorry Transaction ID Not Found" });
                }
            } else {
                var message = 'Sorry Transaction ID Not Found';
                let depositUpdateFinal = await Sys.App.Services.depositMoneyServices.updateData({ _id: deposit.id }, {
                    message: message,
                    status: "fail",
                    updatedAt: Date.now()
                });
                // req.flash('error', 'Sorry Transaction ID Not Found');
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["txn_id_not_found"], req.session.details.language));
                return res.render('transactionsPaymet', { title: "Transaction Cancel", message: "Sorry Transaction ID Not Found" });
            }
        } catch (e) {
            console.log("Error in payment :", e);
            return new Error(e);
        }
    },

    paymentPost: async function (req, res) {
        try {
            console.log("payment 1", req.query);
            // console.log("payment 2", req.body);
            // console.log("payment 3", req.params);

        } catch (e) {
            console.log("Error in paymentPost :", e);
            return new Error(e);
        }
    },

    // validateGameView: async function(req, res){
    //     try{
    //         console.log("schedule id of validateGameView", req.body.id);
    //         if (req.session.login){
    //             let playerData;
    //             if (req.session.details.is_admin != 'yes') {
    //                 playerData = await Sys.App.Services.AgentServices.getByData({ email: req.body.email });
    //             }else{
    //                 playerData = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.session.details.id });
    //             }
    //             console.log("data", playerData)

    //             let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({_id: req.body.id}, {}, { });
    //             console.log("schedule of validateGameView", req.body.id, schedule);
    //             let query = {
    //                 gameType: "game_1",
    //                 //status: { $ne: "finish" },
    //                 stopGame: false,
    //                 parentGameId: req.body.id,
    //                 'otherData.gameSecondaryStatus': { $ne: "finish" },
    //                 startDate: {
    //                     $gte: moment().startOf('day').toDate(),
    //                     $lt: moment().startOf('day').add(1, 'day').toDate()
    //                 }
    //             }

    //             let games =  await Sys.Game.Game1.Services.GameServices.getByData(query, {gameName: 1, status: 1, players: 1, timerStart: 1, isNotificationSent: 1, stopGame: 1, sequence: 1, gameMode: 1, startDate: 1, graceDate: 1, subGames: 1, otherData: 1}, {startDate: 1});
    //             console.log("games of validateGameView", req.body.id, games)
    //             let runningGame = {};
    //             let upcomingGame = {};
    //             if(games.length > 0){
    //                 let status = {'running': 1,'active': 2,'completed': 3, 'finish': 4};
    //                 //games.sort((a, b) => status[a.status] - status[b.status]);
    //                 games.sort((a, b) => status[a.otherData.gameSecondaryStatus] - status[b.otherData.gameSecondaryStatus]);
    //                 console.log("sorted games", games);


    //                 let index =  games.findIndex(x => x.otherData.gameSecondaryStatus == 'running');
    //                 if(index >= 0){
    //                     runningGame = {
    //                         gameId: games[index]._id,
    //                         gameTitle: games[index].gameName,
    //                         status: games[index].otherData.gameSecondaryStatus,
    //                         gameName: "Game1"
    //                     }
    //                 }else{
    //                     // if running game not found, then check for upcoming game
    //                     let upcomingIndex =  games.findIndex(x => x.status == 'active');
    //                     if(upcomingIndex >= 0){
    //                         upcomingGame = {
    //                             gameId: games[upcomingIndex]._id,
    //                             gameTitle: games[upcomingIndex].gameName,
    //                             status: games[upcomingIndex].status,
    //                             gameName: "Game1"
    //                         }
    //                     }
    //                 }
    //             }
    //             console.log("runningGame & upcomingGame of validateGameView", req.body.id, runningGame, upcomingGame)
    //             let gameData = {};
    //             if(Object.keys(runningGame).length > 0){
    //                 gameData = runningGame;
    //             }else if(Object.keys(upcomingGame).length > 0){console.log("inside upcoming game")
    //                 gameData = upcomingGame;
    //             }
    //             console.log("gameData of validateGameView", gameData, req.body.id)
    //             //let gameData = await Sys.Game.Game1.Services.GameServices.getSingleGameData({ _id: req.body.id});
    //             if(req.body.id && playerData && Object.keys(gameData).length != 0 ){
    //                 // let players = {
    //                 //     id: playerData._id,
    //                 //     name: playerData.username,
    //                 //     status: 'Waiting',
    //                 // }

    //                 // await Sys.Game.Game3.Services.GameServices.updateGameNew({ _id: req.body.id }, { $push: { "players": players } });

    //                 return res.send({message: "success", identifier: gameData.gameName, gameId: gameData.gameId});
    //             }else{
    //                 console.log("data not found of validateGameView", req.body.id);
    //                 return res.send({message: "error", identifier: "", gameId: ""});
    //             }
    //         }else{
    //             console.log("session not available of validateGameView", req.body.id);
    //             return res.send({message: "error", identifier: "", gameId: ""});
    //         }
    //     }catch(e){
    //         console.log("Error in validateGameView :", e);
    //         return new Error(e);
    //     }
    // },

    validateGameView: async function (req, res) {
        try {
            let adminLang = req.session?.details?.language || "norwegian";
            let language = adminLang === "norwegian" ? "nor" : "en";
            console.log("schedule id of validateGameView", req.body.id, req.session?.details?.language);
            let playerData = null;
            if (req.session.login) {
                if (req.session.details.is_admin != 'yes') {
                    playerData = await Sys.App.Services.AgentServices.getByData({ email: req.body.email });
                } else {
                    playerData = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.session.details.id });
                }
                console.log("data", playerData)
            }

            if (req.session.login && req.session.details.is_admin == 'yes' && mongoose.Types.ObjectId.isValid(req.body.id)) {
                const objectId = mongoose.Types.ObjectId.isValid(req.body.id) ? new mongoose.Types.ObjectId(req.body.id) : null;

                if (!objectId) {
                    return res.send({
                        message: "error",
                        identifier: "",
                        gameId: "",
                        displayMessage: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access_tv_screen"], adminLang),
                        language: language,
                        hallId: null
                    });
                }
                let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.body.id }, {}, {});

                let query = {
                    gameType: "game_1",
                    //status: { $ne: "finish" },
                    stopGame: false,
                    parentGameId: req.body.id,
                    'otherData.gameSecondaryStatus': { $ne: "finish" },
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                        $lt: moment().startOf('day').add(1, 'day').toDate()
                    }
                }

                let games = await Sys.Game.Game1.Services.GameServices.getByData(query, { gameName: 1, status: 1, players: 1, timerStart: 1, isNotificationSent: 1, stopGame: 1, sequence: 1, gameMode: 1, startDate: 1, graceDate: 1, subGames: 1, otherData: 1 }, { startDate: 1 });
                //console.log("games of validateGameView", req.body.id, games)
                let runningGame = {};
                let upcomingGame = {};
                if (games.length > 0) {
                    let status = { 'running': 1, 'active': 2, 'completed': 3, 'finish': 4 };
                    //games.sort((a, b) => status[a.status] - status[b.status]);
                    games.sort((a, b) => status[a.otherData.gameSecondaryStatus] - status[b.otherData.gameSecondaryStatus]);
                    //console.log("sorted games", games);


                    let index = games.findIndex(x => x.otherData.gameSecondaryStatus == 'running');
                    if (index >= 0) {
                        runningGame = {
                            gameId: games[index]._id,
                            gameTitle: games[index].gameName,
                            status: games[index].otherData.gameSecondaryStatus,
                            gameName: "Game1"
                        }
                    } else {
                        // if running game not found, then check for upcoming game
                        let upcomingIndex = games.findIndex(x => x.status == 'active');
                        if (upcomingIndex >= 0) {
                            upcomingGame = {
                                gameId: games[upcomingIndex]._id,
                                gameTitle: games[upcomingIndex].gameName,
                                status: games[upcomingIndex].status,
                                gameName: "Game1"
                            }
                        }
                    }
                }
                //console.log("runningGame & upcomingGame of validateGameView", req.body.id, runningGame, upcomingGame)
                let gameData = {};
                if (Object.keys(runningGame).length > 0) {
                    gameData = runningGame;
                } else if (Object.keys(upcomingGame).length > 0) {
                    console.log("inside upcoming game")
                    gameData = upcomingGame;
                }
                //console.log("gameData of validateGameView", gameData, req.body.id)
                //let gameData = await Sys.Game.Game1.Services.GameServices.getSingleGameData({ _id: req.body.id});
                if (req.body.id && playerData && Object.keys(gameData).length != 0) {
                    // let players = {
                    //     id: playerData._id,
                    //     name: playerData.username,
                    //     status: 'Waiting',
                    // }

                    // await Sys.Game.Game3.Services.GameServices.updateGameNew({ _id: req.body.id }, { $push: { "players": players } });

                    return res.send({ message: "success", identifier: gameData.gameName, gameId: gameData.gameId, displayMessage: "", language: language, hallId: null });
                } else {
                    console.log("data not found of validateGameView", req.body.id);
                    return res.send({
                        message: "error",
                        identifier: "",
                        gameId: "",
                        displayMessage: await Sys.Helper.bingo.getSingleTraslateData(["no_ongoing_game"], adminLang),
                        language: language,
                        hallId: null
                    });
                }
            } else {
                let groupOfHall = await Sys.App.Services.GroupHallServices.getSingleGoh({ tvId: req.body.id }, { tvId: 1, name: 1, halls: 1 });
                if (groupOfHall) {
                    let allHalls = [];
                    if (groupOfHall.halls.length > 0) {
                        for (let h = 0; h < groupOfHall.halls.length; h++) {
                            allHalls.push(groupOfHall.halls[h].id)
                        }
                    }

                    if ((!req.session || !req.session.login) || (req.session && req.session.login == true )) { //&& req.session?.details?.is_admin != 'yes'
                        if (allHalls.length > 0) {
                            let allowedIps = [];
                            let hallIps = await Sys.App.Services.HallServices.getByData({ _id: { $in: allHalls } }, { ip: 1 });
                            console.log("hallIps--", hallIps)
                            if (hallIps && hallIps.length > 0) {
                                for (let i = 0; i < hallIps.length; i++) {
                                    allowedIps.push(hallIps[i].ip);
                                }
                            }
                            console.log("allowedIps---", allowedIps);
                            if (allowedIps.length > 0) {
                                let currentUserIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0] : req.socket.remoteAddress;
                                console.log("currentUserIp---", currentUserIp);
                                if (allowedIps.includes(currentUserIp) == false) {
                                    console.log("you are not allowed");
                                    return res.send({
                                        message: "error",
                                        identifier: "",
                                        gameId: "",
                                        displayMessage: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access_tv_screen"], adminLang),
                                        language: language,
                                        hallId: null
                                    });
                                } else {
                                    const record = hallIps.find(entry => entry.ip == currentUserIp);
                                    if (record) {
                                        allHalls = [record._id.toString()];
                                    }

                                }
                            }
                        }
                    }



                    let query = {
                        gameType: "game_1",
                        halls: { $in: allHalls },
                        $or: [
                            { status: { $ne: "finish" } },
                            { 'otherData.gameSecondaryStatus': "running" }
                        ],
                        stopGame: false,
                        'otherData.isClosed': false,
                        startDate: {
                            $gte: moment().startOf('day').toDate(),
                            $lt: moment().startOf('day').add(2, 'day').toDate()
                        }
                    }

                    let games = await Sys.Game.Game1.Services.GameServices.getByData(query, { gameName: 1, status: 1, players: 1, timerStart: 1, isNotificationSent: 1, stopGame: 1, sequence: 1, gameMode: 1, startDate: 1, graceDate: 1, subGames: 1, otherData: 1, parentGameId: 1 }, { sort: { startDate: 1 } });

                    let runningGame = {};
                    let upcomingGame = {};
                    if (games.length > 0) {
                        let status = { 'running': 1, 'active': 2, 'completed': 3, 'finish': 4 };
                        //games.sort((a, b) => status[a.status] - status[b.status]);
                        games.sort((a, b) => status[a.otherData.gameSecondaryStatus] - status[b.otherData.gameSecondaryStatus]);
                        //console.log("sorted games", games);


                        let index = games.findIndex(x => x.otherData.gameSecondaryStatus == 'running');
                        if (index >= 0) {
                            runningGame = {
                                gameId: games[index]._id,
                                gameTitle: games[index].gameName,
                                status: games[index].otherData.gameSecondaryStatus,
                                gameName: "Game1"
                            }
                        } else {
                            // if running game not found, then check for upcoming game
                            let upcomingIndex = games.findIndex(x => x.status == 'active');
                            if (upcomingIndex >= 0) {
                                upcomingGame = {
                                    gameId: games[upcomingIndex]._id,
                                    gameTitle: games[upcomingIndex].gameName,
                                    status: games[upcomingIndex].status,
                                    gameName: "Game1"
                                }
                            }
                        }
                    }
                    //console.log("runningGame & upcomingGame of validateGameView", req.body.id, runningGame, upcomingGame)
                    let gameData = {};
                    if (Object.keys(runningGame).length > 0) {
                        gameData = runningGame;
                    } else if (Object.keys(upcomingGame).length > 0) {
                        console.log("inside upcoming game")
                        gameData = upcomingGame;
                    }
                    console.log("gameData of validateGameView", gameData, req.body.id, groupOfHall, allHalls)
                    //let gameData = await Sys.Game.Game1.Services.GameServices.getSingleGameData({ _id: req.body.id});
                    if (req.body.id && Object.keys(gameData).length != 0) { //&& playerData
                        return res.send({ message: "success", identifier: gameData.gameName, gameId: gameData.gameId, displayMessage: "", language: language, hallId: allHalls?.[0] });
                    } else {
                        console.log("data not found of validateGameView", req.body.id);
                        return res.send({ message: "error", identifier: "", gameId: "", displayMessage: await Sys.Helper.bingo.getSingleTraslateData(["no_ongoing_game"], adminLang), language: language, hallId: allHalls?.[0] });
                    }
                }
                return res.send({ message: "error", identifier: "", gameId: "", displayMessage: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_access_tv_screen"], adminLang), language: language, hallId: null });
            }


        } catch (e) {
            console.log("Error in validateGameView :", e);
            return new Error(e);
        }
    },

    // deleteAgentSessions: async function(store){
    //     try {
    //         const sessionsDir = path.join(__dirname, '../../sessions');
    //         const files = await fs.promises.readdir(sessionsDir);
    //         console.log("files---", files)
    //         const deletePromises = files.map(async (file) => {
    //             const filePath = path.join(sessionsDir, file);

    //             try {
    //                 const data = await fs.promises.readFile(filePath, 'utf8');
    //                 console.log("data---", data)
    //                 if (data.trim() === '') {
    //                     console.warn(`Skipping empty file: ${filePath}`);
    //                     return;
    //                 }
    //                 const session = JSON.parse(data);

    //                 // Replace the condition below with your specific condition
    //                 if (session.details.is_admin != 'yes') {
    //                     return new Promise((resolve, reject) => {
    //                         store.destroy(file.replace(/\.json$/, ''), (err) => {
    //                             if (err) reject(err);
    //                             else resolve();
    //                         });
    //                     });
    //                 }
    //             } catch (err) {
    //                 console.error(`Failed to process file ${filePath}:`, err);
    //             }

    //         })

    //         await Promise.all(deletePromises);

    //         return true;
    //       } catch (err) {
    //         console.error('Error cleaning up sessions:', err);
    //         res.status(500).send('Failed to clean up sessions');
    //       }
    // }

    resetImportedPlayerPassword: async function (req, res) {
        try {
            const { token } = req.params;
            const language = "english";// req.session.details?.language || "en";
            
            // Validate token and get user in one query
            const user = await Sys.App.Services.PlayerServices.getSinglePlayerData(
                { 
                    'otherData.importPlayerResetPasswordToken': token, 
                    'otherData.isImportPlayerPasswordReset': false 
                }, 
                { username: 1, email: 1, hall: 1, otherData: 1 }
            );

            if (!user) {
                const errorMessage = await Sys.Helper.bingo.getSingleTraslateData(
                    ["psw_token_invalied_or_expired"], 
                    language
                );
                return res.render('resetPasswordSuc', { 
                    title: "Invalid Token", 
                    message: errorMessage 
                });
            }

            // Only fetch translate data if needed (empty array check removed as it seems unnecessary)
            const translate = await Sys.Helper.bingo.getTraslateData([], language);

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                translate,
                navigation: translate,
                user
            };

            return res.render('importplayer-reset-password', data);
        } catch (e) {
            console.error("Error in resetting import player password:", e);
            const language = "english";
            const errorMessage = await Sys.Helper.bingo.getSingleTraslateData(
                ["psw_token_invalied_or_expired"], 
                language
            ).catch(() => "An error occurred while processing your request.");
            return res.render('resetPasswordSuc', { 
                title: "Error", 
                message: errorMessage 
            });
        }
    },

    postResetImportedPlayerPassword: async function (req, res) {
        try {
            const { id, hall, pass_confirmation } = req.body;
            const { token } = req.params;

            // Validate required fields
            if (!id || !hall || !pass_confirmation || !token) {
                return res.send({
                    status: "fail",
                    title: "Invalid Request",
                    message: "Missing required fields."
                });
            }

            // Find and validate user
            const user = await Sys.App.Services.PlayerServices.getSinglePlayerData(
                { 
                    _id: id, 
                    'hall.id': hall, 
                    'otherData.importPlayerResetPasswordToken': token,
                    'otherData.isImportPlayerPasswordReset': false
                }, 
                { _id: 1 }
            );

            if (!user) {
                return res.send({
                    status: "fail",
                    title: "Invalid Token",
                    message: "Password reset token is invalid or has expired."
                });
            }

            // Update password and reset token
            const updatedPlayer = await Sys.App.Services.PlayerServices.update(
                { 
                    _id: id, 
                    'hall.id': hall, 
                    'otherData.importPlayerResetPasswordToken': token
                }, 
                {
                    password: bcrypt.hashSync(pass_confirmation, bcrypt.genSaltSync(8), null),
                    'otherData.isImportPlayerPasswordReset': true,
                    'otherData.importPlayerResetPasswordToken': ""
                }
            );

            if (updatedPlayer?.modifiedCount > 0) {
                return res.send({ 
                    status: "success", 
                    title: "Password Reset Successfully", 
                    message: "Password updated successfully, Now you can Login with your New Password." 
                });
            } else {
                return res.send({ 
                    status: "fail", 
                    title: "Error in Password Updating", 
                    message: "Error while updating Password, Please try again later" 
                });
            }

        } catch (e) {
            console.error("Error in postResetImportedPlayerPassword:", e);
            return res.send({ 
                status: "fail", 
                title: "Error in Password Updating", 
                message: "Error while updating password. Please try again later." 
            });
        }
    },

    updateLanguage: async function (req, res) {
        try {
            console.log("Body", req.body);

            let user = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.body.id });
            if (user) {
                await Sys.App.Services.UserServices.updateUserData({
                    _id: req.body.id
                }, {
                    language: req.body.language
                });
                req.session.details.language = req.body.language;
                // req.flash('success', 'Language Updated Successfully');
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["language_update_success"], req.session.details.language));
                res.redirect('/profile');
            } else {
                req.flash('error', 'Error in Language Update');
                res.redirect('/profile');
            }

        } catch (error) {
            console.log("error", error);

        }
    },

    agentUpdateLanguage: async function (req, res) {
        try {
            console.log("Body", req.body);

            let user = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            if (user) {
                await Sys.App.Services.AgentServices.updateAgentData({
                    _id: req.body.id
                }, {
                    language: req.body.language
                });
                req.session.details.language = req.body.language;

                // req.flash('success', 'Language Avatar Updated Successfully');
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["language_update_success"], req.session.details.language));
                return res.redirect('/agent/profile');
            } else {
                // req.flash('error', 'Error in Language Avatar Update');
                req.flash('failed', await Sys.Helper.bingo.getSingleTraslateData(["language_update_failed"], req.session.details.language));
                return res.redirect('/agent/profile');
            }

        } catch (error) {
            console.log("error", error);

        }
    }

}

function convertIPv6MappedToIPv4(ip) {
    // Check if the input is an IPv6-to-IPv4 mapped address
    const isIPv6Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.test(ip);

    if (isIPv6Mapped) {
        // Extract the IPv4 portion (last 32 bits) and return it as an IPv4 address
        const ipv4Address = ip.replace(/^::ffff:/, '');
        return ipv4Address;
    }
    return ip;
}

function isObjectNonEmpty(obj) {
    if (obj && typeof obj === 'object') {
        return Object.keys(obj).length > 0;
    }
    return false;
}