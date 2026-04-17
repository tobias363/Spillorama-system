var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var parseInt = require('parse-int');
var moment = require('moment-timezone');
var Jimp = require('jimp');
var path = require('path');
var filesize = require('filesize');
const mongoose = require('mongoose');
var fs = require('fs');
var jwt = require('jsonwebtoken');
var jwtcofig = {
    'secret': process.env.JWT_SECRET
};
const { promisify } = require('util');
const convert = require('heic-convert');
// nodemialer to send email
const nodemailer = require('nodemailer');
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

    agent: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Agent Management'] || [];
                let stringReplace =req.session.details.isPermission['Agent Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (stringReplace?.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
            }
            let keys = [
                "agent_table",
                "dashboard",
                "agent",
                "search",
                "all",
                "inactive",
                "active",
                "reset",
                "agents",
                "add_agent",
                "agent_id",
                "agent_name",
                "emailId",
                "mobile_number",
                "hall_name",
                "status",
                "action",
                "agent_name_or_id",
                "agent_not_delete",
                "agent_delete_msg",
                "delete_successfully",
                "delete_button",
                "cancel_button",
                "delete_message",
                "delete_player_message",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "deleted",
                "no_hall_assigned"
            ]
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)


            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                agentActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                agentData: agentData,
                navigation: agentData
            };
            return res.render('agent/agents', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getAgent: async function (req, res) {
        try {
            console.log("get agent param", req.query.params);
            let isIndividual = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // let stringReplace = user.permission['Agent Management'] || [];
                let stringReplace =req.session.details.isPermission['Agent Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("role_all_agent_allow") == -1) {
                    isIndividual = false;
                }
            }
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let query = {};
            if (search != '') {
                query = { $or: [{ agentId: { $regex: '.*' + search + '.*', $options: 'i' } }, { name: { $regex: '.*' + search + '.*', $options: 'i' } }] }
            }
            if (req.query.params.status != '') {
                query.status = req.query.params.status;
            }
            if(!isIndividual){
                query.parentId = req.session.details.id;
            }
            console.log('query',query);
            let playersCount = await Sys.App.Services.AgentServices.getAgentCount(query);
            let data = await Sys.App.Services.AgentServices.getAgentDatatable(query, length, start, sort);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getAgent controller:", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    addAgent: async function (req, res) {
        try {
            let hallOption = [
                '_id',
                'name'
            ];
            let hallData = await await Sys.App.Services.HallServices.getAllHallDataSelect({
                "status": "active"
            }, hallOption);
            console.log("hall in add agent", hallData);

            let keys = [
                "agent_table",
                "dashboard",
                "agent",
                "edit_agent",
                "add_agent",
                "agent_name",
                "emailId",
                "phone_number",
                "assigned",
                "new_password",
                "confirm_password",
                "password",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "assign"
            ]

            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                agentActive: 'active',
                hallData: hallData,
                agentData: agentData,
                navigation: agentData
            };
            return res.render('agent/add', data);
        } catch (e) {
            console.log("Error in addAgent page", e);
        }
    },

    addAgentPostData: async function (req, res) {
        try {
            console.log("req.body", req.body);
            let agent = await Sys.App.Services.AgentServices.getByData({ email: req.body.email });
            let hall = [];
            if (agent.length) {
                let translate = await Sys.Helper.bingo.getTraslateData(['agent_already_exists'], req.session.details.language)
                req.flash('error',translate.agent_already_exists )//'Agent Already Exists');
                return res.redirect('/agent');
            }
            if (req.body.halls && req.body.halls.length && req.body.status === 'active') {
                let halls = req.body.halls;
                for (let i = 0; i < halls.length; i++) {
                    let singleHall = await Sys.App.Services.HallServices.getSingleHall({ "_id": halls[i], "status": "active" });
                    if (singleHall) { //singleHall.agents.id == undefined
                        hall.push({
                            id: singleHall._id.toString(),
                            name: singleHall.name
                        });
                    } else {
                        // let message = '';
                        // if (singleHall) {
                        //     message += `${singleHall.name} already assigned to ${singleHall.agent.name}`
                        // }else{
                        //     message += "Some of Halls not Found or Unavailable!"
                        // }
                        let translate = await Sys.Helper.bingo.getTraslateData(['some_of_hall_not_found_or_unavailable'], req.session.details.language)
                        req.flash("error", translate.some_of_hall_not_found_or_unavailable )//"Some of Halls not Found or Unavailable!");
                    }
                }
            }
            let ID = Date.now();
            console.log("data ID", ID);
            let createID = await Sys.Helper.bingo.dateTimeFunction(ID);
            console.log("data ID", createID);
            let pass = bcrypt.hashSync(req.body.newpassword, bcrypt.genSaltSync(8), null);
            agent = await Sys.App.Services.AgentServices.insertAgentData({
                agentId: 'AG-' + createID,
                parentId: req.session.details.id,
                name: req.body.name,
                email: req.body.email,
                phone: req.body.phone,
                hall: hall,
                password: pass,
                status: req.body.status,
                lastParentId: req.session.details.id
            });
            console.log("agent is", agent);
            if (!agent) {
                let translate = await Sys.Helper.bingo.getTraslateData(['agent_not_creates'], req.session.details.language)
                req.flash('error',translate.agent_not_creates )// 'Agent Not Created');
                return res.redirect('/agent');
            } else {
                // for update agent to hall 
                if (hall.length) {
                    let hallIds = hall.map((v, i) => {
                        return v.id;
                    });
                    // for (let i = 0; i < hall.length; i++) {
                    //     await Sys.App.Services.HallServices.updateHallData({"_id":hall[i].id},{
                    //         "$set":{
                    //             "agents":{
                    //                 "id":agent._id,
                    //                 "name":agent.name
                    //             }
                    //         }
                    //     })
                    // }
                    await Sys.App.Services.HallServices.updateManyDataById({
                        "_id": {
                            '$in': hallIds
                        }
                    }, {
                        "$push": {
                            "agents": {
                                "id": agent._id,
                                "name": agent.name
                            }
                        }
                    })
                }
                let inputData = {
                    agentId: agent._id.toString(),
                    agentName: agent.name,
                    parentId: agent.parentId,
                    permission: {
                        'Players Management': ['view', 'edit', 'delete', 'block/unblock'],
                        'Games Management': ['view']
                    },
                    agnetIdNormal: agent.agentId,
                    isAssginRole: true
                };

                console.log("inputData", inputData);

                let RoleData = await Sys.App.Services.RoleServices.insertData(inputData);

                await Sys.App.Services.AgentServices.FindOneUpdate({ _id: agent._id }, { roleId: RoleData._id });
                let translate = await Sys.Helper.bingo.getTraslateData(['agent_create_successfully'], req.session.details.language)
                req.flash('success',translate.agent_create_successfully )// 'Agent create successfully');
                return res.redirect('/agent');
            }

        } catch (e) {
            console.log("Error in create agent", e);
            let translate = await Sys.Helper.bingo.getTraslateData(['internal_server_error'], req.session.details.language)
            req.flash('error', translate.internal_server_error || 'Internal Server Error');
            return res.redirect('/agent');
        }
    },

    getActivePlayer: async function (req, res) {

        try {

            let query = {};
            let data = await Sys.App.Services.AgentServices.getPlayerData(query);
            var obj = {
                'data': data
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    editAgent: async function (req, res) {
        try {

            let agent = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.params.id });

            let hallOption = [
                '_id',
                'name'
            ];
            let hallData = await await Sys.App.Services.HallServices.getAllHallDataSelect({
                "status": "active",
                // "agents.id": agent._id
            }, hallOption);
            console.log(hallData);

            let keys = [
                "agent_table",
                "dashboard",
                "agent",
                "edit_agent",
                "add_agent",
                "agent_name",
                "emailId",
                "phone_number",
                "assigned",
                "new_password",
                "confirm_password",
                "password",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel",
                "assign"
            ]

            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                agent: agent,
                hallData: hallData,
                agentData: agentData,
                navigation: agentData
            };

            req.session.playerBack = req.header('Referer');
            return res.render('agent/add', data);
        } catch (e) {
            console.log("Error in editAgent Page::", e);
        }
    },


    editAgentPostData: async function (req, res) {
        try {
            console.log("change: ", req.body);
            let agent = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.params.id });
            let hall = []
            if (agent) {

                var passwordTrue = true;
                // if (bcrypt.compareSync(req.body.copassword, agent.password)) {
                //     passwordTrue = true;
                // } else {
                //     passwordTrue = false;
                // }

                if (passwordTrue) {

                    // if (agent.hall.length != req.body.halls.length){
                    //     const oldHallIds = [...new Set(agent.hall.map(item => item.id))];
                    //     console.log("old hallIds", oldHallIds, req.body.halls);
                    //     if(oldHallIds.length > 0){
                    //         let checkHallGameIds = [];
                    //         for(let i=0; i < oldHallIds.length; i++){
                    //             if( req.body.halls.includes(oldHallIds[i]) == false ){
                    //                 checkHallGameIds.push(oldHallIds[i]);
                    //             }
                    //         }

                    //         let query = {
                    //             gameType: "game_1",
                    //             halls: { $in: checkHallGameIds }, 
                    //             status: "running",
                    //             stopGame: false,
                    //             'otherData.isClosed': false,
                    //             startDate: {
                    //                 $gte: moment().startOf('day').toDate(),
                    //             }
                    //         }

                    //         let runningGameInHall = await Sys.Game.Game1.Services.GameServices.getGameCount(query);
                    //         console.log("runningGameInHall---", runningGameInHall)
                    //         if(runningGameInHall && runningGameInHall > 0){
                    //             req.flash('error', 'You can not remove halls in which game is running.');
                    //             return res.redirect('/agent');
                    //         }
                    //     }
                    // }

                    if (agent.hall.length !== 0 && req.body.status == "inactive") {
                        // req.flash('success', 'Agent is Removed from all halls assigned to them.');
                        //Remove Agent from all Halls
                        await Sys.App.Services.HallServices.updateManyDataById({ "agents.id": agent._id }, {
                            "$pull": {
                                "agents": { id: agent._id }
                            }
                        });
                    } else if (req.body.halls && req.body.halls.length && req.body.status === 'active') {
                        //Add Agent Data to all Halls
                        let dataUpg = await Sys.App.Services.HallServices.updateManyDataById({ "_id": { "$in": req.body.halls }, "status": "active" }, {
                            "$addToSet": {
                                "agents": {
                                    "id": agent._id,
                                    "name": agent.name
                                }
                            }
                        });
                        let halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "_id": { "$in": req.body.halls }, "status": "active" }, ["_id", "name"]);
                        if (halls.length) {
                            for (let i = 0; i < halls.length; i++) {
                                hall.push({
                                    id: halls[i]._id.toString(),
                                    name: halls[i].name
                                })
                            }
                        }

                    }
                    //Retrieve out halls which are not included in new hallArray
                    let removedHalls = agent.hall.filter(hallElem => {
                        return !hall.some(element => element.id.toString() === hallElem.id.toString());
                    }).map(element => element.id);
                    console.log("remove halls", removedHalls);
                    if (removedHalls.length) {
                        await Sys.App.Services.HallServices.updateManyDataById({ _id: { "$in": removedHalls } }, {
                            "$pull": {
                                "agents": { id: agent._id }
                            }
                        });
                    }

                    let pass = bcrypt.hashSync(req.body.newpassword, bcrypt.genSaltSync(8), null);
                    let data = {
                        name: req.body.name,
                        phone: req.body.phone,
                        status: req.body.status,
                        email: req.body.email,
                        hall: hall,
                        lastParentId: req.session.details.id
                    }
                    if (req.body.newpassword) {
                        data.password = pass;
                    }

                    console.log("data", data);

                    await Sys.App.Services.AgentServices.updateAgentData({ _id: req.params.id }, data)

                    // update agents in game
                    if (haveSameIds(agent.hall, hall) == false) {
                        module.exports.updateAgentsInGame({ agentId: req.params.id, previousHalls: agent.hall, currentHalls: hall });
                    }
                    let translate = await Sys.Helper.bingo.getSingleTraslateData(["agent_updated_successfully"], req.session.details.language)
                    req.flash('success',translate )//'Agent updated successfully');
                    return res.redirect(req.session.playerBack);
                } else {
                    let translate = await Sys.Helper.bingo.getSingleTraslateData(["password_not_matches"], req.session.details.language)
                    req.flash('error', translate.password_not_matches)//'Password Not Matched');
                    // res.redirect(req.session.playerBack);
                    return res.redirect('/agent');
                }


                //res.redirect('/player');
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(["no_user_found"], req.session.details.language)
                req.flash('error', translate.no_user_found)//'No User found');
                return res.redirect(req.session.playerBack);
            }
        } catch (e) {
            console.log("Error", e);
        }
    },


    getAgentDelete: async function (req, res) {
        try {
            console.log("coming here", req.query, req.params, req.body);
            let player = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            if (player || player.length > 0) {

                // let Id = mongoose.Types.ObjectId(player._id)

                // let hallUpdate = await Sys.App.Services.HallServices.updateManyData(Id);
                // console.log("hallUpdate", hallUpdate);

                // remve agents from all the assigned halls
                await Sys.App.Services.HallServices.updateManyDataById({ "agents.id": player._id }, {
                    "$pull": {
                        "agents": { id: player._id }
                    }
                });

                //if (player.hall.length == 0) {
                await Sys.App.Services.RoleServices.deleteRole(player.roleId);
                await Sys.App.Services.AgentServices.deletePlayer(player._id);
                return res.send("success");
                //}
                //return res.send("fail");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },

    active: async function (req, res) {

        try {

            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.body.id });
            if (player || player.length > 0) {
                if (player.status == 'active') {
                    await Sys.App.Services.AgentServices.updatePlayerData({
                        _id: req.body.id
                    }, {
                        status: 'Block'
                    })
                } else {
                    await Sys.App.Services.AgentServices.updatePlayerData({
                        _id: req.body.id
                    }, {
                        status: 'active'
                    })
                }
                //req.flash('success','Status updated successfully');
                return res.send("success");
            } else {
                return res.send("error");
                req.flash('error', 'Problem while updating Status.');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },
    emailStatus: async function (req, res) {

        try {

            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.body.id });
            if (player || player.length > 0) {
                if (player.emailStatus == 'Active') {
                    await Sys.App.Services.AgentServices.updatePlayerData({
                        _id: req.body.id
                    }, {
                        emailStatus: 'InActive'
                    })
                } else {
                    await Sys.App.Services.AgentServices.updatePlayerData({
                        _id: req.body.id
                    }, {
                        emailStatus: 'Active'
                    })
                }
                //req.flash('success','Status updated successfully');
                return res.send("success");
            } else {
                return res.send("error");
                req.flash('error', 'Problem while updating Status.');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },
    inActive: async function (req, res) {

        try {

            let player = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            if (player || player.length > 0) {

                await Sys.App.Services.AgentServices.updatePlayerData({
                    _id: req.params.id
                }, {
                    status: 'inactive'
                })
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    chipsAdd: async function (req, res) {
        try {
            console.log("This is prohibited!", req.body);
            res.send({ 'status': 'fail', 'message': "This is prohibited!" });

            /*console.log("chipsAdd req.body: ", req.body);

              var data = {
                App : Sys.Config.App.details,Agent : req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                 playerActive : 'active',
              };
              let operation = req.body.chipsValue;
              let chipsUpdate = req.body.chips;
              let player = await Sys.App.Services.AgentServices.getSinglePlayerData({_id: req.body.playerId});
              if (player || player.length >0) {

               if(operation == 'Add') {
                newChips = parseFloat(player.chips + parseFloat(req.body.chips));

                let transactionAdminAddData = {
                  user_id: player.id,
                  username: player.username,
                  chips: parseFloat(req.body.chips),
                  previousBalance: parseFloat(player.chips),
                  afterBalance: parseFloat(newChips),
                  category: 'credit',
                  type: 'entry',
                  remark: 'Credit chips by Admin',
                  isTournament: 'No',
                  isGamePot: 'no'
                }

                console.log("admin chips add to player transactionAdminAddData: ", transactionAdminAddData);
                await Sys.Game.CashGame.Texas.Services.PlayerAllTransectionService.createTransaction(transactionAdminAddData);

              }else if(operation == 'Deduct') {
                newChips = parseFloat(player.chips - parseFloat(req.body.chips));

                let transactionAdminDebitData = {
                  user_id: player.id,
                  username: player.username,
                  chips: parseFloat(req.body.chips),
                  previousBalance: parseFloat(player.chips),
                  afterBalance: parseFloat(newChips),
                  category: 'debit',
                  type: 'entry',
                  remark: 'Debit chips by Admin',
                  isTournament: 'No',
                  isGamePot: 'no'
                }

                console.log("admin chips add to player transactionAdminDebitData: ", transactionAdminDebitData);
                await Sys.Game.CashGame.Texas.Services.PlayerAllTransectionService.createTransaction(transactionAdminDebitData);
              }

              await Sys.App.Services.AgentServices.updatePlayerData(
              {
                _id: req.body.playerId
              },{
                chips:eval(parseFloat( newChips).toFixed(2) ),
              }
              );

              req.flash("success",'Chips updated successfully');
              res.redirect( req.header('Referer') );
              //res.redirect('/player');

            }else{
              return res.flash("error");
            }*/
        } catch (e) {
            console.log("Error", e);
            req.flash('error', 'Problem while updating Chips.');
        }
    },

    getChipsNotes: async function (req, res) {
        try {
            var noteDetail = await Sys.App.Services.chipsNoteServices.getSingleChipsNote({ 'requestById': req.session.details.id, 'requestToId': req.body.player_id });
            console.log("noteDetail: ", noteDetail);
            let translate = await Sys.Helper.bingo.getTraslateData(["chips_note"], req.session.details.language)
            res.send({
                'status': 'success', 'message': translate.chips_note,//'chips note', 
                data: noteDetail
            });
        } catch (e) {
            console.log("Error when get chips note: ", e)
            res.send({
                'status': 'fail', 'message': 'Player chips note not availabel' 
            });
        }
    },

    updateChipsNotes: async function (req, res) {
        try {

            if (req.body.requestType == "Update") {

                var noteId = req.body.noteId;
                var noteDetail = req.body.edit_chips_note;
                await Sys.App.Services.chipsNoteServices.updateChipsNoteData({ '_id': noteId }, { 'note': noteDetail });
                let translate = await Sys.Helper.bingo.getTraslateData(["note_update_successfully"], req.session.details.language)
                req.flash("success",translate.note_update_successfully )//'Note updated successfully');
            } else {
                await Sys.App.Services.chipsNoteServices.insertChipsNoteData({
                    requestById: req.session.details.id,
                    requestToId: req.body.agentId,
                    note: req.body.edit_chips_note,
                    type: 'player'
                });
                let translate = await Sys.Helper.bingo.getTraslateData(["note_save_successfully"], req.session.details.language)
                req.flash("success", translate.note_save_successfully)//'Note save successfully');
            }


            let backURL = '/player';
            res.redirect(backURL);
        } catch (e) {
            let translate = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language)
            req.flash("error" ,translate.something_went_wrong || 'Something went wrong');
            let backURL = '/player';
            res.redirect(backURL);
        }
    },

    chipsAction: async function (req, res) {
        try {
            console.log("in chipsAction")
            let action = req.body.action;
            let chips = req.body.chips;
            let playerId = req.body.playerId;
            console.log(action, chips, playerId)

            if (req.session.details.is_admin == 'yes') {

                let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: playerId });
                if (player) {
                    let parentAgent = await Sys.App.Services.UserServices.getSingleUserData({ _id: req.session.details.id });

                    console.log("parentAgent: ", parentAgent);

                    let newChips;
                    let parentAgentUpdatedCash;
                    if (action == 'add') {
                        if (parseFloat(parentAgent.chips) >= parseFloat(req.body.chips)) {
                            newChips = parseFloat(player.chips + parseFloat(req.body.chips));
                            parentAgentUpdatedCash = parseFloat(parentAgent.chips) - parseFloat(req.body.chips);

                            let transactionAdminAddData = {
                                user_id: player.id,
                                username: player.username,
                                chips: parseFloat(req.body.chips),
                                previousBalance: parseFloat(player.chips),
                                afterBalance: parseFloat(newChips),
                                category: 'credit',
                                type: 'entry',
                                remark: 'Credit chips by ' + parentAgent.email,
                                isTournament: 'No',
                                isGamePot: 'no'
                            }

                            console.log("agent chips add to player transactionAdminAddData: ", transactionAdminAddData);
                            await Sys.Game.CashGame.Texas.Services.PlayerAllTransectionService.createTransaction(transactionAdminAddData);

                        } else {
                            let translate = await Sys.Helper.bingo.getTraslateData(["you_have_insufficent_chips"], req.session.details.language)
                            res.send({ status: 'fail', result: null, message: translate.you_have_insufficent_chips})//'You have Insufficient Chips!' });
                            return;
                        }

                    } else if (action == 'deduct') {
                        if (parseFloat(player.chips) >= parseFloat(req.body.chips)) {
                            newChips = parseFloat(parseFloat(player.chips) - parseFloat(req.body.chips));
                            parentAgentUpdatedCash = parseFloat(parentAgent.chips) + parseFloat(req.body.chips);

                            let transactionAdminDebitData = {
                                user_id: player.id,
                                username: player.username,
                                chips: parseFloat(req.body.chips),
                                previousBalance: parseFloat(player.chips),
                                afterBalance: parseFloat(newChips),
                                category: 'debit',
                                type: 'entry',
                                remark: 'Debit chips by ' + parentAgent.email,
                                isTournament: 'No',
                                isGamePot: 'no'
                            }

                            console.log("admin chips debit to player transactionAdminDebitData: ", transactionAdminDebitData);
                            await Sys.Game.CashGame.Texas.Services.PlayerAllTransectionService.createTransaction(transactionAdminDebitData);
                        } else {
                            let translate = await Sys.Helper.bingo.getTraslateData(["player_have_insufficient_chips"], req.session.details.language)
                            res.send({ status: 'fail', result: null, message: translate.player_have_insufficient_chips })//'Player Have Insufficient Chips!' });
                            return;
                        }
                    }
                    await Sys.App.Services.AgentServices.updatePlayerData({ _id: playerId }, { chips: newChips });
                    await Sys.Io.to([player.socketId]).emit('OnPlayerChipsUpdate', { playerId: player.id, playersChips: newChips });
                    await Sys.App.Services.UserServices.updateUserData({
                        _id: req.session.details.id
                    }, {
                        chips: eval(parseFloat(parentAgentUpdatedCash).toFixed(2))
                    });
                    let traNumber = +new Date()
                    await Sys.App.Services.AllUsersTransactionHistoryServices.insertData({
                        'receiverId': req.body.playerId,
                        'receiverRole': 'Player',
                        'providerId': parentAgent.id,
                        'providerRole': 'admin',
                        'providerEmail': parentAgent.email,
                        'chips': parseFloat(parseFloat(req.body.chips).toFixed(2)),
                        'cash': '',
                        'remark': req.body.chips_note,
                        'transactionNumber': (action == 'add') ? 'DEP-' + traNumber : 'DE-' + traNumber,
                        'beforeBalance': eval(parseFloat(player.chips).toFixed(2)),
                        'afterBalance': eval(parseFloat(newChips).toFixed(2)),
                        'type': (action == 'add') ? 'deposit' : 'deduct',
                        'category': (action == 'add') ? 'credit' : 'debit',
                        'status': 'success',
                    });
                    await Sys.App.Services.AllUsersTransactionHistoryServices.insertData({
                        'receiverId': parentAgent.id,
                        'receiverRole': 'admin',
                        'providerId': req.body.playerId,
                        'providerRole': 'Player',
                        'providerEmail': player.username + " (player)",
                        'chips': parseFloat(parseFloat(req.body.chips).toFixed(2)),
                        'cash': '',
                        'remark': req.body.chips_note,
                        'transactionNumber': (action != 'add') ? 'DEP-' + traNumber : 'DE-' + traNumber,
                        'beforeBalance': eval(parseFloat(parentAgent.chips).toFixed(2)),
                        'afterBalance': eval(parseFloat(parentAgentUpdatedCash).toFixed(2)),
                        'type': (action != 'add') ? 'deposit' : 'deduct',
                        'category': (action != 'add') ? 'credit' : 'debit',
                        'status': 'success',
                    });

                    var noteDetail = await Sys.App.Services.chipsNoteServices.getSingleChipsNote({ 'requestById': req.session.details.id, 'requestToId': req.body.playerId });
                    if (noteDetail == null) {
                        await Sys.App.Services.chipsNoteServices.insertChipsNoteData({
                            requestById: req.session.details.id,
                            requestToId: req.body.playerId,
                            note: req.body.chips_note,
                            type: 'player'
                        });
                    } else {
                        await Sys.App.Services.chipsNoteServices.updateChipsNoteData({ '_id': noteDetail._id }, { 'note': req.body.chips_note });
                    }

                    // Sys.Game.CashGame.Texas.Services.ChipsServices.createTransaction({
                    //   user_id           : req.body.playerId,
                    //   username          : parentAgent.name,
                    //   chips             : parseFloat(req.body.chips).toFixed(2),
                    //   previousBalance   : eval( parseFloat(player.chips).toFixed(2) ),
                    //   afterBalance      :eval( parseFloat(newChips).toFixed(2) ),
                    //   category          : (action == 'add') ? 'credit': 'debit',
                    //   type              : (action == 'add') ? 'deposit': 'deduct',
                    //   remark            : req.body.chips_note
                    // })

                    let translate = await Sys.Helper.bingo.getTraslateData(["chips_updated"], req.session.details.language)
                    res.send({ status: 'success', newChips: newChips, rootChips: parentAgentUpdatedCash, message: translate.chips_updated })// 'Chips Updated' });
                } else {
                    let translate = await Sys.Helper.bingo.getTraslateData(["no_player_found"], req.session.details.language)
                    res.send({ status: 'fail', result: null, message: translate.no_player_found  })//'No Player Found' });
                }
            }

        } catch (e) {
            console.log("Error", e);
            let translate = await Sys.Helper.bingo.getTraslateData(["no_player_found"], req.session.details.language)
            res.send({ status: 'fail', result: null, message: translate.no_player_found })//'No Player Found' });
        }
    },


    chipsHistory: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerId: req.params.id,
                playerActive: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('player/chipsHistory', data);
        } catch (e) {
            console.log("Error", e);
        }

    },

    getChipsHistory: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                let capital = search;
                query = { username: { $regex: '.*' + search + '.*' }, user_id: req.params.id };
            } else {
                query = { user_id: req.params.id };
            }
            let columns = [
                'id',
                'username',
                'firstname',
                'lastname',
                'email',
                'chips',
                'status',
                'isBot',
            ]

            let chipsCount = await Sys.App.Services.ChipsHistoryServices.getChipsHistoryCount(query);
            //let chipsCount = chipsC.length;
            console.log(chipsCount);
            let data = await Sys.App.Services.ChipsHistoryServices.getChipsDatatable(query, length, start);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': chipsCount,
                'recordsFiltered': chipsCount,
                'data': data
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    cashTransactionHistory: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.id });

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerId: req.params.id,
                player: player,
                playerActive: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('player/cashTransactionHistory', data);
        } catch (e) {
            console.log("Error", e);
        }

    },

    getCashTransactionHistory: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let query = {};
            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.id });
            if (player.isCash == true) {
                if (search != '') {
                    query = { $and: [{ $or: [{ 'receiverId': req.params.id }, { user_id: req.params.id }] }, { email: { $regex: '.*' + search + '.*' } }] }
                } else {
                    query = { $or: [{ 'receiverId': req.params.id }, { user_id: req.params.id }] };
                }
                query.type = { '$nin': ['winner', 'lose'] }

                var countData = await Sys.App.Services.AllUsersTransactionHistoryServices.getCount(query);
                var data = await Sys.App.Services.AllUsersTransactionHistoryServices.getByData(query, null, { skip: start, limit: length, sort: { createdAt: -1 } });
            } else {
                if (search != '') {
                    query = { 'playerId': req.params.id, transactionNumber: { $regex: '.*' + search + '.*' } };
                } else {
                    query = { 'playerId': req.params.id };
                }

                var countData = await Sys.App.Services.ChipsHistoryServices.getCashTransactionHistoryCount(query);
                var data = await Sys.App.Services.ChipsHistoryServices.getCashTransactionDatatable(query, length, start);
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': countData,
                'recordsFiltered': countData,
                'data': data
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getCashTransactionHistoryNew: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            /*if (search != '') {
              let capital = search;
              query = { transactionNumber: { $regex: '.*' + search + '.*' } , playerId : req.params.id};
            } else {
              query = { playerId : req.params.id };
            }

            let chipsCount = await Sys.App.Services.ChipsHistoryServices.getCashTransactionHistoryCount(query);
            let data = await Sys.App.Services.ChipsHistoryServices.getCashTransactionDatatable(query, length, start);*/

            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.id });

            console.log("player: ", player);

            if (search != '') {
                query = { 'receiverId': req.params.id, email: { $regex: '.*' + search + '.*' } };
            } else {
                query = { 'receiverId': req.params.id };
            }
            let Count = await Sys.App.Services.AllUsersTransactionHistoryServices.getCount(query);
            let data = await Sys.App.Services.AllUsersTransactionHistoryServices.getByData(query, null, { skip: start, limit: length, sort: { createdAt: -1 } });
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': Count,
                'recordsFiltered': Count,
                'data': data
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    loginHistory: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerId: req.params.id,
                playerActive: 'active',
                translate: translate,
                navigation: translate
            };
            return res.render('player/loginHistory', data);
        } catch (e) {
            console.log("Error", e);
        }

    },

    getLoginHistory: async function (req, res) {
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                let capital = search;
                query = { email: { $regex: '.*' + search + '.*' }, player: req.params.id };
            } else {
                query = { player: req.params.id };
            }
            let columns = [
                'id',
                'username',
                'firstname',
                'lastname',
                'email',
                'chips',
                'status',
                'isBot',
            ]

            let loginCount = await Sys.App.Services.ChipsHistoryServices.getLoginHistoryCount(query);
            //let loginCount = loginC.length;
            let data = await Sys.App.Services.ChipsHistoryServices.getLoginDatatable(query, length, start);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': loginCount,
                'recordsFiltered': loginCount,
                'data': data
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    allPlayers: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                allPlayers: 'true',
                myPlayerActive: 'active',
                PlayerMenu: 'active menu-open',
                translate: translate,
                navigation: navigation
            };
            return res.render('player/player', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getAllPlayers: async function (req, res) {

        // res.send(req.query.start); return false;
        try {
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let query;
            if (search != '') {
                query = { username: { $regex: '.*' + search + '.*' } };
            }

            let playersCount = await Sys.App.Services.AgentServices.getPlayerCount(query);
            //let playersCount = playersC.length;
            let data = await Sys.App.Services.AgentServices.getPlayerDatatable(query, length, start);
            //let data = await Sys.App.Services.AgentServices.getSingleAgentData(query);


            var obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },


    //player's game history
    gameHistory: async function (req, res) {

        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerId: req.params.id,
                playerHistoryActive: 'active',
                translate:translate,
                navigation: translate
            };
            return res.render('player/gameHistory', data);
        } catch (e) {
            console.log(e);
            return new Error("Error", e);
        }
    },

    getPlayerGameHistory: async function (req, res) {
        try {

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = { history: { $elemMatch: { playerId: req.params.id } } };
            if (search != '') {
                query = { gameNumber: { $regex: '.*' + search + '.*' }, history: { $elemMatch: { playerId: req.params.id } } };
            }

            let gameCount = await Sys.App.Services.GameService.getGameCount(query);
            console.log("total game count", gameCount);
            let data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);
            //let data = await Sys.App.Services.AgentServices.getSingleAgentData(query);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': gameCount,
                'recordsFiltered': gameCount,
                'data': data
            };
            res.send(obj);
        } catch (e) {
            return new Error("Error", e);
            console.log(e);
        }
    },

    playerProfile: async function (req, res) {
        try {
            var date = new Date();
            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.id });
            let gamePlayed = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id });
            let gamewon = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id, result: 'Won' });
            let gameLost = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id, result: 'Lost' });

            //START: Today rack
            var startDate = new Date();
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("today startDate: ", startDate);
            console.log("today endDate: ", endDate);

            let todaysRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lt: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let todaysTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(todaysRake);
            console.log("today rack", todaysTotalRack);
            var todayRakeTotal = 0.00;
            if (todaysTotalRack.length > 0) {
                var todayRakeTotal = parseFloat(todaysTotalRack[0].count).toFixed(2);
            }
            //END: Today rack

            //START: Weekally rack
            var start_date = moment().subtract(7, 'days');
            var startDate = new Date(start_date);
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("Weekally startDate: ", startDate);
            console.log("Weekally endDate: ", endDate);

            let weekallyRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lte: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let weekallyTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(weekallyRake);
            console.log("Weekally rack", weekallyTotalRack);
            var weekallyRakeTotal = 0.00;
            if (weekallyTotalRack.length > 0) {
                var weekallyRakeTotal = parseFloat(weekallyTotalRack[0].count).toFixed(2);
            }
            //END: Weekally rack

            //START: Monthally rack
            var start_date = moment().subtract(1, 'months');
            var startDate = new Date(start_date);
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("Monthally startDate: ", startDate);
            console.log("Monthally endDate: ", endDate);

            let monthallyRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lte: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let monthallyTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(monthallyRake);
            console.log("monthally rack", monthallyTotalRack);
            var monthallyRakeTotal = 0.00;
            if (monthallyTotalRack.length > 0) {
                var monthallyRakeTotal = parseFloat(monthallyTotalRack[0].count).toFixed(2);
            }
            //END: Monthally rack
            let query = { $or: [{ 'receiverId': req.params.id }, { user_id: req.params.id }] };
            query.type = { '$nin': ['deposit', 'deduct'] }
            let trasactionData = await Sys.App.Services.AllUsersTransactionHistoryServices.getByData(query);
            let deposit = 0
            let withdraw = 0

            for (let index = 0; index < trasactionData.length; index++) {
                if (trasactionData[index].type == "deposit" || trasactionData[index].category == "credit")
                    deposit = parseFloat(parseFloat(deposit) + parseFloat(trasactionData[index].chips))
                else
                    withdraw = parseFloat(parseFloat(withdraw) + parseFloat(trasactionData[index].chips))

            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                player: player,
                gamePlayed: gamePlayed,
                gamewon: gamewon,
                gameLost: gameLost,
                curentYear: date.getFullYear(),
                todayRakeTotal: todayRakeTotal,
                weekallyRakeTotal: weekallyRakeTotal,
                monthallyRakeTotal: monthallyRakeTotal,
                withdraw: withdraw,
                deposit: deposit,
            };

            return res.render('player/profile', data);
        } catch (e) {
            console.log("Error", e)
        }
    },


    playerProfileExport: async function (req, res) {
        try {
            var date = new Date();
            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.id });
            let gamePlayed = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id });
            let gamewon = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id, result: 'Won' });
            let gameLost = await Sys.App.Services.gameStatisticsServices.getCount({ player: req.params.id, result: 'Lost' });

            //START: Today rack
            var startDate = new Date();
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("today startDate: ", startDate);
            console.log("today endDate: ", endDate);

            let todaysRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lt: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let todaysTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(todaysRake);
            console.log("today rack", todaysTotalRack);
            var todayRakeTotal = 0.00;
            if (todaysTotalRack.length > 0) {
                var todayRakeTotal = parseFloat(todaysTotalRack[0].count).toFixed(2);
            }
            //END: Today rack

            //START: Weekally rack
            var start_date = moment().subtract(7, 'days');
            var startDate = new Date(start_date);
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("Weekally startDate: ", startDate);
            console.log("Weekally endDate: ", endDate);

            let weekallyRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lte: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let weekallyTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(weekallyRake);
            console.log("Weekally rack", weekallyTotalRack);
            var weekallyRakeTotal = 0.00;
            if (weekallyTotalRack.length > 0) {
                var weekallyRakeTotal = parseFloat(weekallyTotalRack[0].count).toFixed(2);
            }
            //END: Weekally rack

            //START: Monthally rack
            var start_date = moment().subtract(1, 'months');
            var startDate = new Date(start_date);
            var endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            console.log("Monthally startDate: ", startDate);
            console.log("Monthally endDate: ", endDate);

            let monthallyRake = [{
                $match: {
                    rackToId: req.session.details.id,
                    rackFromId: req.params.id,
                    createdAt: {
                        $gte: startDate,
                        $lte: endDate,
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: '$totalRack' },
                }
            }
            ];
            let monthallyTotalRack = await Sys.App.Services.RackHistoryServices.aggregateQuery(monthallyRake);
            console.log("monthally rack", monthallyTotalRack);
            var monthallyRakeTotal = 0.00;
            if (monthallyTotalRack.length > 0) {
                var monthallyRakeTotal = parseFloat(monthallyTotalRack[0].count).toFixed(2);
            }
            //END: Monthally rack
            let query = { $or: [{ 'receiverId': req.params.id }, { user_id: req.params.id }] };
            query.type = { '$nin': ['deposit', 'deduct'] }
            let trasactionData = await Sys.App.Services.AllUsersTransactionHistoryServices.getByData(query);
            let deposit = 0
            let withdraw = 0

            for (let index = 0; index < trasactionData.length; index++) {
                if (trasactionData[index].type == "deposit" || trasactionData[index].category == "credit")
                    deposit = parseFloat(parseFloat(deposit) + parseFloat(trasactionData[index].chips))
                else
                    withdraw = parseFloat(parseFloat(withdraw) + parseFloat(trasactionData[index].chips))
            }


            let newLine = "\r";
            var fields = ["\t", newLine, 'User Id', 'Username', 'Chips', 'Game Played', 'Game Won', ' Game Lost', 'Tournament Played', 'Tournament Won', 'Total Deposit', 'Total Withdraw', 'Subscribe Status', "Email Status", newLine];
            let properData = [newLine, player.uniqId, player.username, player.chips, gamePlayed, gamewon, gameLost, 0, 0, deposit, withdraw, "Inactive", player.emailStatus,]
            let responseData = fields.concat(properData);
            responseData = responseData.toString()
            res.attachment(player.username + "[" + player.uniqId + "].csv");
            let translate = await Sys.Helper.bingo.getTraslateData(["csv_file_created_successfully"], req.session.details.language)
            req.flash("success",translate.csv_file_created_successfully )//"csv File Created Sucessfully ");
            return res.send(responseData);
        } catch (e) {
            console.log("Error", e)
        }
    },


    getMonthlyGamePlayedByPlayerChart: async function (req, res) {
        console.log(req.params.id)
        let monthlyGamePlayedArray = [3, 6, 7, 1, 4, 8, 9, 78, 8, 99, 0, 5]
        console.log("============>", monthlyGamePlayedArray);
        return res.json(monthlyGamePlayedArray);
    },

    getExportedData: async function (query, pageSize, processPage) {


        let documents = await Sys.App.Services.AgentServices.getPlayerExport(query, pageSize);
        if (!documents || documents.length < 1) {
            // stop - no data left to traverse
            return Promise.resolve();
        } else {
            if (documents.length < pageSize) {
                // stop - last page
                return processPage(documents);
            } else {

                /*return processPage(documents)
                  .then(function getNextPage(){
                    var last_id = documents[documents.length-1]['_id'];
                    query['_id'] = {'$gt' : last_id};
                    return getPage(query, pageSize, processPage);
                  });*/

                //return processPage(documents);
                //console.log("new Docs",newDocuments)
                var last_id = documents[documents.length - 1]['_id'];
                query['_id'] = { '$gt': last_id };
                console.log("query", query)
                return [processPage(documents), this.getExportedData(query, pageSize, processPage)];



            }
        }
    },

    exportData: async function (req, res) {

        /*await module.exports.getExportedData(
          { agentId: req.session.details.id },
            10000,
            function processPage(pagedDocs){
              console.log('do something with', pagedDocs);
              //res.send(pagedDocs);
            })
        */


        /*var start = 0;
        let query = { agentId: req.session.details.id };
        let playersCount = await Sys.App.Services.AgentServices.getPlayerCount(query);
        let data = {};
        if(start>= playersCount){
          let data = await Sys.App.Services.AgentServices.getPlayerDatatable(query, 100, start);
          start = start+100;
        }

        res.send(data);*/



        // recursison
        let data = await module.exports.getSingleAgentData({ agentId: req.session.details.id }, 1)
        //.then((sentence) => console.log(sentence));
        res.send(data);

    },



    getSingleAgentData: async function (query, pageSize) {
        let fragment = await module.exports.getPlayerDataFragment(query, pageSize);

        if (fragment.flag == 0 || fragment.flag == -1) {
            return fragment.data;
        } else {
            return fragment.data.concat(await module.exports.getSingleAgentData(query, pageSize));
        }
    },

    getPlayerDataFragment: async function (query, pageSize) {
        let documents = await Sys.App.Services.AgentServices.getPlayerExport(query, pageSize);
        if (documents.length >= 1) {
            if (documents.length < pageSize) {
                //await module.exports.wait(500);
                return {
                    data: documents,
                    flag: 0,
                    //pageSize: 0;
                };
            } else {
                var last_id = documents[documents.length - 1]['_id'];
                query['_id'] = { '$gt': last_id };
                //await module.exports.wait(500);
                return {
                    data: documents,
                    query: query,
                    flag: 1,
                    //pageSize: 0;
                };

            }
        } else {
            //await module.exports.wait(500);
            return {
                data: documents,
                query: query,
                flag: -1,
                //pageSize: 0;
            };
        }
    },

    wait: function (ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    },

    updateBalance: async function (req, res) {
        try {
            var players = await Sys.App.Services.AgentServices.getByData({});
            console.log("players.length: ", players.length);
            for (var i = 0; i < players.length; i++) {
                await Sys.App.Services.AgentServices.updatePlayerData({ _id: players[i]._id });
            }

            console.log("Players balance update")
        } catch (error) {
            console.log("Error in player controller updateBalance: ", error);
        }
    },
    updateSystemBalance: async function (req, res) {
        try {
            let waitingPlayers = []
            var waitingRoom = await Sys.App.Services.RoomServices.getRoomData({ 'status': { '$in': ['Finished', 'Waiting'] } });
            for (let index = 0; index < waitingRoom.length; index++) {
                if (waitingRoom[index].players) {
                    for (let index1 = 0; index1 < waitingRoom[index].players.length; index1++) {
                        let waiting = {}
                        if (waitingRoom[index].players[index1].status != "Left") {
                            waiting = { id: mongoose.Types.ObjectId(waitingRoom[index].players[index1].id), chips: waitingRoom[index].players[index1].chips, username: waitingRoom[index].players[index1].playerName }
                            waitingPlayers.push(waiting)
                        }
                    }
                }
            }
            let data = [];
            var admin = await Sys.App.Services.UserServices.getSingleUserData({ $or: [{ chips: { $gte: 0.01 } }, { rake_chips: { $gte: 0.01 } }, { extraRakeChips: { $gte: 0.01 } }] }, null, null, ['chips', 'email', 'role', 'rake_chips', 'extraRakeChips']);
            data = data.concat(admin)
            // var players =  await Sys.App.Services.AgentServices.getPlayerDatatable({isCash:true}, null, null, ['username','chips','agentId','agentRole','email']);
            var players = await Sys.App.Services.AgentServices.getPlayerDatatable({ isCash: true, $or: [{ chips: { $gte: 0.01 } }, { rake_chips: { $gte: 0.01 } }] }, null, null, ['username', 'chips', 'agentId', 'agentRole', 'email', 'uniqId']);
            for (let index = 0; index < players.length; index++) {
                for (let index1 = 0; index1 < waitingPlayers.length; index1++) {
                    if (waitingPlayers[index1].username == players[index].username) {
                        players[index].chips = parseFloat(parseFloat(players[index].chips) + parseFloat(waitingPlayers[index1].chips))
                    }
                }
            }
            data = data.concat(players)
            let systemTotalBalance = 0
            for (let index = 0; index < data.length; index++) {
                data[index].rake_chips = data[index].rake_chips ? data[index].rake_chips : 0
                data[index].extraRakeChips = data[index].extraRakeChips ? data[index].extraRakeChips : 0
                let chips = data[index].chips || data[index].rake_chips || data[index].extraRakeChips ? parseFloat(parseFloat(data[index].chips) + parseFloat(data[index].rake_chips) + parseFloat(data[index].extraRakeChips)) : 0;
                systemTotalBalance = parseFloat(systemTotalBalance) - parseFloat(chips)
            }
            let settings = await Sys.App.Services.SettingsServices.getSettingsData({});
            if (settings) {
                await Sys.App.Services.SettingsServices.updateSettingsData({
                    _id: settings._id
                }, {
                    systemChips: systemTotalBalance
                });
            } else {
                console.log("Error in player controller updateBalance ");
            }
        } catch (error) {
            console.log("Error in player controller updateBalance: ", error);
        }
    },

    /* Web Login Functions */
    identifiertoken: async function (req, res) {
        try {
            console.log('identifiertoken:', req.body.id, req.body.identifiertoken);
            let player = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: req.body.id });
            if (player && player.length > 0) {
                let data = {
                    identifiertoken: req.body.identifiertoken
                };
                await Sys.App.Services.AgentServices.updatePlayerData({ _id: req.body.id }, data);
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },

    loadWebPage: async function (req, res) {
        try {
            console.log("loadWebPage called");
            let session = null;
            if (req.session.web) {
                session = req.session.web.details;
            }

            let allLoggedInTokens = await Sys.App.Services.AgentServices.getLoggedInTokens({});
            if (allLoggedInTokens instanceof Error) {
                allLoggedInTokens = [];
            }

            var data = {
                App: Sys.Config.App.details,
                session: session,
                error: req.flash("error"),
                success: req.flash("success"),
                allLoggedInTokens: JSON.stringify(allLoggedInTokens)
            };
            return res.render('web/index', data);
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },

    loadWebPageLogin: async function (req, res) {
        try {
            console.log("loadWebPageLogin called");
            let session = null;
            if (req.session.web) {
                session = req.session.web.details;
            }

            let allLoggedInTokens = await Sys.App.Services.AgentServices.getLoggedInTokens({});
            if (allLoggedInTokens instanceof Error) {
                allLoggedInTokens = [];
            }

            var data = {
                App: Sys.Config.App.details,
                session: session,
                error: req.flash("error"),
                success: req.flash("success"),
                allLoggedInTokens: JSON.stringify(allLoggedInTokens)
            };
            console.log("data", data);
            return res.send(data);
            //return res.render('web/login', data);
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },

    webPlayerRegister: async function (req, res) {
        try {
            console.log("req.body", req.body);
            //console.log("req.body", req.body.group);
            let ownerDetails
            let data = req.body;
            if (Sys.Setting.maintenance && Sys.Setting.maintenance.status == 'active') {
                req.flash('error', Sys.Setting.maintenance.message);
                return res.redirect('/web/');
            }

            // Check Username & Email Already Avilable
            let player = await await Sys.App.Services.AgentServices.getSinglePlayerData({
                username: data.username
            });
            if (player) { // When Player Found
                req.flash('error', 'Username already taken.');
                return res.redirect('/web/');
            }

            // Check Username & Email Already Avilable
            player = await await Sys.App.Services.AgentServices.getSinglePlayerData({ email: data.email });
            if (player) { // When Player Found
                req.flash('error', 'Email already taken.');
                return res.redirect('/web/');
            }


            /*let groupData
             if(req.body.group || req.body.group!="" || req.body.group == null){
                groupData = await Sys.App.Services.groupService.getsingleData({groupId: req.body.group});
             }else{
               groupData = await Sys.App.Services.groupService.getsingleData({isPublic:true });
             }
             
             if(groupData == null){
               req.flash('error', 'Please enter correct group ID.');
               return res.redirect('/web/');
             }
             console.log(groupData);
             
             let role
             ownerDetails = await Sys.App.Services.UserServices.getSingleUserData({ _id: mongoose.Types.ObjectId(groupData.ownerId)})
             console.log(ownerDetails);
             
            console.log(role);
            */
            // Create Player Object
            let playerObj = {
                device_id: await randomString(36),
                firstname: data.firstname,
                lastname: data.lastname,
                username: data.username,
                password: bcrypt.hashSync(data.password, 10),
                email: data.email,
                mobile: data.mobile,
                isFbLogin: false,
                profilePic: 0,
                chips: 0,
                cash: 0,
                status: 'active',
                socketId: '1234',
                isCash: true,
                platform_os: 'other',
                agentId: "",
                //groupId: groupData._id,
                agentRole: "",
                //groupNumber:groupData.groupId
            };
            player = await Sys.App.Services.AgentServices.insertPlayerData(playerObj);
            /* console.log("player", player);
             let groupPlayers = groupData.playerIds;
             groupPlayers.push(player._id);
             await Sys.App.Services.groupService.updateData({
               _id: groupData._id
             }, {
               playerIds: groupPlayers
             });*/
            if (!player) {
                req.flash('error', 'Player Not Created');
                return res.redirect('/web/');
            } else {
                let token = jwt.sign({ id: data.email }, jwtcofig.secret, {
                    expiresIn: 300 // expires in 5 minutes
                });

                let textMessage = "\"Hi " + player.firstname + " " + player.lastname + ",\r\n\r\nWelcome to PonoPoker, the Online Home Game.\r\nThank you for registering. To verify your email, please click on the link below.\r\n\r\n<RegisterLink>\r\n\r\nThank you, stay safe, and best of luck at the tables.\r\n\r\nSincerely,\r\nPonoPoker"
                let mailText = textMessage.replace("<RegisterLink>", 'https://' + req.headers.host + '/web/verification/' + token);
                let resetTokenData = {
                    resetPasswordToken: token,
                    resetPasswordExpires: Date.now() + (1000 * 60 * 60) // add 60 minutes into current time
                }
                await Sys.App.Services.AgentServices.updatePlayerData({
                    _id: player._id
                }, resetTokenData);

                let mailOptions = {
                    to: data.email,
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    subject: 'Bingo Game Welcomes You!',
                    text: mailText
                };
                defaultTransport.sendMail(mailOptions, function (err) {
                    if (!err) {
                        defaultTransport.close();
                    } else {
                        console.log("player created but error in sending email", err);
                    }
                });

                req.flash('error', 'Player Successfully Register!');
                return res.redirect('/web/');
            }

            if (!player) {
                req.flash('error', 'Player Not Created');
                return res.redirect('/web/');
            } else {
                req.flash('success', 'Player Successfully Register!');
                return res.redirect('/web/');
            }
        } catch (e) {
            Sys.Log.info('Error in create Player : ' + e);
            let translate = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language)
            req.flash('error', translate.something_went_wrong || 'Something went wrong');
            return res.redirect('/web/');
        }
    },
    emailVerification: async function (req, res) {
        try {
            console.log("emailVerification called",);
            let player = null;
            player = await Sys.App.Services.AgentServices.getSinglePlayerData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });
            console.log(player);

            if (player == null || player instanceof Error) {
                req.flash('error', 'Email token is invalid or has expired.');
                console.log("Email token is invalid or has expired.");
                return res.redirect('/web/');
            } else {
                await Sys.App.Services.AgentServices.updatePlayerData({
                    _id: player._id
                }, {
                    resetPasswordToken: null,
                    resetPasswordExpires: 0,
                    emailVerify: true
                });
                console.log("Email Verification Successfully");
                req.flash('error', 'Email Verification Successfully ');
                return res.redirect('/web/');
            }
        } catch (e) {
            console.log("Error", e);
            return res.send("error");
        }
    },


    /* webPlayerLogin: async function(req, res){
      try {
        console.log("req.body", req.body);
        let data = req.body;
        if(Sys.Setting.maintenance.status =='active'){
          req.flash('error', Sys.Setting.maintenance.message);
          return res.redirect('/web/');
        }

        let passwordTrue = false;
        let player = null;

        // Define Validation Rules
        let playerObj = {
          $or:[
            { username: data.username },
            { email: data.username }
          ]
        };

        player = await Sys.App.Services.AgentServices.getSinglePlayerData(playerObj);
        // console.log("player", player);
        if(!player){
          req.flash('error', 'Wrong Username Or Email');
          return res.redirect('/web/');
        }

        if(bcrypt.compareSync(data.password, player.password)) {
          // check if player is Active or Blocked 
          if(player.status == 'Block'){
            req.flash('error', 'Oops You are Blocked!!');
            return res.redirect('/web/');
          }
          passwordTrue = true;
        }

        if (passwordTrue) {
          console.log("data.forceLogin", data.forceLogin);
          if(data.forceLogin){
            if(player.socketId){
              console.log("Player Force Logout Send.");
              await Sys.Io.to(player.socketId).emit('forceLogOut',{
                playerId: player.id,
                message: "You are logged off due to login from another device.",
              });
            }
          }
          else{
            if (Sys.Io.sockets.connected[player.socketId]) { 
              console.log("socket is already connected");
              req.flash('error', 'Already Logged in!!');
              return res.redirect('/web/');
            }
          }

          player.isFbLogin = false;

          //  await Sys.Game.Common.Services.AgentServices.updatePlayerData({
          //   _id: player.id
          // }, {
          //   socketId: socket.id,
          //   platform_os: data.os,
          // }); 
          console.log("player id on login", player.username);

          // set jwt token
          var token = jwt.sign({ id: player.id }, jwtcofig.secret, {
            expiresIn: 60 // expires in 1 minute
          });

          let loginToken = await randomString(36);
          let loginTokenData = {
            loginToken: loginToken
          }
          await Sys.App.Services.AgentServices.updatePlayerData({
            _id: player._id
          }, loginTokenData);

          // User Authenticate Success
          req.session.web = {};
          req.session.web.login = true;
          req.session.web.details = {
            id: player.id,
            name: player.username,
            jwt_token: token,
            loggedInToken: loginToken
          };
          console.log("postLogin req.session.web.details: ", req.session.web.details);

          req.flash('success', 'Logged In Successfully!!');
          return res.redirect('/web/');
        }
        else{
          req.flash('error', 'Invalid credentials!');
          return res.redirect('/web/');
        }
      }
      catch (error) {
        Sys.Log.info('Error in Login : ' + error);
        req.flash('error', 'Some Error Occurred');
        return res.redirect('/web/');
      }
    },*/

    webPlayerLogin: async function (req, res) {
        try {
            console.log("req.body", req.body);
            let data = req.body;
            if (Sys.Setting.maintenance.status == 'active') {
                req.flash('error', Sys.Setting.maintenance.message);
                return res.redirect('/web/');
            }

            let passwordTrue = false;
            let player = null;

            // Define Validation Rules
            let playerObj = {
                $or: [
                    { username: data.username },
                    { email: data.username }
                ]
            };

            player = await Sys.App.Services.AgentServices.getSinglePlayerData(playerObj);
            // console.log("player", player);
            if (!player) {
                req.flash('error', 'Wrong Username Or Email');
                return res.redirect('/web/');
            }
            if (player.emailVerify != true) {
                req.flash('error', 'Email Verification Is Not Completed');
                return res.redirect('/web/');
            }


            if (bcrypt.compareSync(data.password, player.password)) {
                // check if player is Active or Blocked 
                if (player.status == 'Block') {
                    req.flash('error', 'Oops You are Blocked!!');
                    return res.redirect('/web/');
                }
                passwordTrue = true;
            }

            if (passwordTrue) {
                console.log("data.forceLogin", data.forceLogin);
                if (data.forceLogin) {
                    if (player.socketId) {
                        console.log("Player Force Logout Send.");
                        await Sys.Io.to(player.socketId).emit('forceLogOut', {
                            playerId: player.id,
                            message: "You are logged off due to login from another device.",
                        });
                    }
                } else {
                    if (Sys.Io.sockets.connected[player.socketId]) {
                        console.log("socket is already connected");
                        req.flash('error', 'Already Logged in!!');
                        return res.redirect('/web/');
                    }
                }

                player.isFbLogin = false;

                //  await Sys.Game.Common.Services.AgentServices.updatePlayerData({
                //   _id: player.id
                // }, {
                //   socketId: socket.id,
                //   platform_os: data.os,
                // }); 
                console.log("player id on login", player.username);

                // set jwt token
                var token = jwt.sign({ id: player.id }, jwtcofig.secret, {
                    expiresIn: 60 // expires in 1 minute
                });

                let loginToken = await randomString(36);
                let loginTokenData = {
                    loginToken: loginToken
                }
                await Sys.App.Services.AgentServices.updatePlayerData({
                    _id: player._id
                }, loginTokenData);

                // User Authenticate Success
                req.session.web = {};
                req.session.web.login = true;
                req.session.web.details = {
                    id: player.id,
                    name: player.username,
                    jwt_token: token,
                    loggedInToken: loginToken
                };
                console.log("postLogin req.session.web.details: ", req.session.web.details);

                let allLoggedInTokens = await Sys.App.Services.AgentServices.getLoggedInTokens({});
                console.log("DATAT OF ALL TOKEN", allLoggedInTokens)
                if (allLoggedInTokens instanceof Error) {
                    allLoggedInTokens = [];
                }

                let loggedInToken = req.session.web.details.loggedInToken;
                console.log("LOGGED IN TOKEN", loggedInToken);
                // allLoggedInTokens = JSON.parse(allLoggedInTokens);
                //console.log("ALL JSON LOGGED IN TOKEN",allLoggedInTokens)

                let logIn = null;
                for (let i = 0; i < allLoggedInTokens.length; i++) {
                    if (loggedInToken == allLoggedInTokens[i].loginToken) {
                        logIn = allLoggedInTokens[i].loginToken;
                    }
                }
                console.log("logIn", logIn);

                if (logIn) {
                    let playerId = req.session.web.details.id;
                    if (playerId != "") {
                        console.log("PLAYER ID", playerId);
                        let randomvalue = await randomString(36);
                        console.log("RANDOM VALUE", randomvalue);
                        let player = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: playerId });
                        console.log("player", player);

                        if (player && player.length > 0) {
                            let data = {
                                identifiertoken: randomvalue
                            };
                            console.log("DTATA", data);
                            let my = await Sys.App.Services.AgentServices.updatePlayerData({ _id: playerId }, data);
                            console.log("MYYY", my);
                            return res.redirect("/webgl/index.html?token=" + randomvalue + "&u=" + playerId);
                        } else {
                            return res.send("error");
                        }
                    }
                    req.flash('success', 'Logged In Successfully!!');
                    return res.redirect('/web/');
                } else {
                    req.flash('error', 'New Login Has Made.');
                    return res.redirect('/web/logout');
                }
            } else {
                req.flash('error', 'Invalid credentials!');
                return res.redirect('/web/');
            }
        } catch (error) {
            Sys.Log.info('Error in Login : ' + error);
            let translate = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language)
            req.flash('error', translate.something_went_wrong || 'Something went wrong');
            return res.redirect('/web/');
        }
    },

    webPlayerLogout: async function (req, res) {
        try {
            console.log("Web Logout");
            req.session.web = null;
            req.logout();
            req.flash('success', 'Logged Out.');
            return res.redirect('/web/');
        } catch (e) {
            console.log("Error in logout :", e);
            return res.redirect('/web/');
        }
    },
    webForgotPassword: async function (req, res) {
        try {
            console.log("webForgotPassword called");
            let player = null;
            player = await Sys.App.Services.AgentServices.getSinglePlayerData({ email: req.body.email });
            if (player == null || player.length == 0) {
                req.flash('error', 'No Such Player Found, Please Enter Valid Registered Email.');
                return res.redirect('/web/');
            }
            var token = jwt.sign({ id: req.body.email }, jwtcofig.secret, {
                expiresIn: 300 // expires in 5 minutes
            });

            let resetTokenData = {
                resetPasswordToken: token,
                resetPasswordExpires: Date.now() + (1000 * 60 * 5) // add 5 minutes into current time
            }
            console.log("Date.now()", Date.now());
            console.log("resetTokenData", resetTokenData);

            await Sys.App.Services.AgentServices.updatePlayerData({
                _id: player._id
            }, resetTokenData);
            console.log("req.headers.host", req.headers.host)
            console.log(Sys.Setting.supportMessage)
            let supportMessage = "\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tHello\r\nWelcomes to the Team Pono Poker Team Support Link\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tYou are receiving this because you (or someone else) have requested the reset of the password for your account.\r\n          Please click on the following link, or paste this into your browser to complete the process:\r\n          <token>\r\n\t If you did'nt request for password, mail our support system, we will get back you sortly!\t\t\r\nThanks\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t"

            let textMessage = supportMessage.trim();
            let mailText = textMessage.replace("<token>", 'https://' + req.headers.host + '/web/reset-password.html?t=' + token);
            let mailOptions = {
                to: req.body.email,
                from: Sys.Config.App.mailer.defaultFromAddress,
                subject: 'Bingo Game Password Reset',
                text: mailText
            };
            defaultTransport.sendMail(mailOptions, function (err) {
                if (!err) {
                    req.flash('error', ' E-mail has been sent to ' + req.body.email + ' with further instructions.');
                    // defaultTransport.close();
                    return res.redirect('/web/');
                } else {
                    console.log(err);
                    req.flash('error', 'Error sending e-mail, Please try again after sometime.');
                    return res.redirect('/web/');
                }
            });
        } catch (e) {
            console.log("Error in webForgotPassword :", e);
            req.flash('error', 'Error sending e-mail, Please try again after sometime.');
            return res.redirect('/web/');
        }
    },
    webResetPassword: async function (req, res) {
        try {
            console.log("webResetPassword");

            let player = null;
            player = await Sys.App.Services.AgentServices.getSinglePlayerData({
                resetPasswordToken: req.params.token,
                resetPasswordExpires: { $gt: Date.now() }
            });
            console.log("response:-", player);
            if (player == null || player instanceof Error) {
                req.flash('error', 'Password reset token is invalid or has expired.');
                return res.redirect('/web/');
            }

            await Sys.App.Services.AgentServices.updatePlayerData({
                _id: player._id
            }, {
                password: bcrypt.hashSync(req.body.pass_confirmation, 10),
                resetPasswordToken: null,
                resetPasswordExpires: 0,
                emailVerify: true
            });
            req.flash('error', 'Password updated successfully, Now you can Login with your New Pasword.');
            return res.redirect('/web/');
        } catch (e) {
            console.log("Error in webResetPassword :", e);
            req.flash('error', 'Error while upating password');
            return res.redirect(req.header('Referer'));
        }
    },

    /* This is for custom image uploading game side API */
    playerPicUpdate: async function (req, res) {
        try {
            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ _id: req.params.playerId });
            console.log("player--", player)
            var data = [];
            if (player) {
                if (req.files) {
                    let image = req.files.file;
                    console.log("image", image)
                    console.log("*****************")
                    // var re = /(?:\.([^.]+))?$/;
                    // var ext = re.exec(image.name)[1];
                    let Magic = 'mmm.Magic';
                    let magic = 'new Magic(mmm.MAGIC_MIME_TYPE)';
                    let buf = image.data;
                    var ext = '';
                    console.log("image", image);
                    console.log("buf", buf);
                    await magic.detect(buf, function (err, mimeType) {
                        if (err) throw err;
                        if (mimeType) {
                            if (!mimeType.match(/.(jpg|jpeg|png|octet-stream)$/i)) {
                                data = {
                                    status: 'fail',
                                    result: null,
                                    message: 'Uploaded file is not a valid image. Only JPG, JPEG, PNG and HEIC files are allowed.',
                                    statusCode: 400
                                }
                                return res.send(data);
                            }

                            ext = mimeType.split('/');
                            // if(!ext.match('image.*')){

                            if (ext[1] == "octet-stream") {
                                ext[1] = "heic"
                            }
                            let fileName = Date.now() + '.' + ext[1];
                            let removeFileName = fileName
                            // Use the mv() method to place the file somewhere on your server

                            image.mv('./public/uploads/avatar/' + fileName, async function (err) {
                                if (err) {
                                    data = {
                                        status: 'fail',
                                        result: null,
                                        message: 'Error Uploading avtar',
                                        statusCode: 400
                                    }

                                    return res.send(data);
                                }
                                if (ext[1] == "heic") {
                                    var inputBuffer = await promisify(fs.readFile)('./public/uploads/avatar/' + fileName)
                                    console.log(inputBuffer);
                                    var outputBuffer = await convert({
                                        buffer: inputBuffer, // the HEIC file buffer
                                        format: 'JPEG', // output format
                                        quality: 1 // the jpeg compression quality, between 0 and 1
                                    });
                                    fileName = fileName.replace("heic", "jpg");
                                    await promisify(fs.writeFile)('./public/uploads/avatar/' + fileName, outputBuffer);
                                    if (err) {
                                        data = {
                                            status: 'fail',
                                            result: null,
                                            message: 'Error Uploading avtar',
                                            statusCode: 400
                                        }
                                        return res.send(data);
                                    }
                                    fs.unlinkSync('./public/uploads/avatar/' + removeFileName)
                                }
                                let url = './public/uploads/avatar/' + fileName;
                                console.log("url", url);

                                var imageStats = fs.statSync(url);
                                var fileSizeInMb = filesize(imageStats.size);
                                var sizeArr = fileSizeInMb.split(' ');
                                if (sizeArr[1] == 'KB') {
                                    var newSize = parseFloat(sizeArr[0]) / 1024;
                                } else {
                                    var newSize = sizeArr[0];
                                }
                                let filelimit = 5;
                                if (parseFloat(newSize) > parseFloat(filelimit)) {
                                    fs.unlinkSync(url);
                                    data = {
                                        status: 'fail',
                                        result: null,
                                        message: 'File Size is too large, Maximum allowed file size is 5 MB.',
                                        statusCode: 400
                                    }
                                    return res.send(data);
                                }
                                let playerPic = {
                                    avatar: '/uploads/avatar/' + fileName
                                }
                                await Sys.App.Services.AgentServices.updatePlayerData({ _id: player._id }, playerPic);
                                data = {
                                    status: 'success',
                                    result: { avatar: playerPic.avatar },
                                    message: "Profile Updated Successfully.",
                                    statusCode: 200,
                                }
                                let query = {
                                    status: { "$ne": "Closed" },
                                };
                                let allRooms = await Sys.App.Services.RoomServices.getRoomDataColumns(query, { _id: 1 });
                                console.log("allRooms", allRooms);
                                console.log("player", player);
                                allRooms.forEach(async function (room) {
                                    if (Sys.Rooms[room.id]) {
                                        Sys.Rooms[room.id].players.forEach(function (roomPlayer) {
                                            if (roomPlayer.id == req.params.playerId) {
                                                roomPlayer.profilePicUrl = '/uploads/avatar/' + fileName;
                                            }
                                        });
                                    }
                                });
                                return res.send(data);
                            });
                        }

                    });

                    // if (!image.name.match(/.(jpg|jpeg|png)$/i)){
                } else {
                    data = {
                        status: 'fail',
                        result: null,
                        message: 'Player image not Found.',
                        statusCode: 400
                    }
                    console.log('data', data);
                    return res.send(data);
                }
            } else {
                data = {
                    status: 'fail',
                    result: null,
                    message: 'Player Not Found.',
                    statusCode: 400
                }
                console.log('data', data);
                return res.send(data);
            }
        } catch (e) {
            Sys.Log.info('Error in playerPicUpdate : ' + e);
        }
    },

    // converTojpeg: async function(req,res){
    //   try{
    //     (async () => {
    //       var inputBuffer = await promisify(fs.readFile)( './public/uploads/avatar/sample1.octet-stream');
    //       console.log(inputBuffer);
    //       var outputBuffer = await convert({
    //         buffer: inputBuffer, // the HEIC file buffer
    //         format: 'JPEG',      // output format
    //         quality: 1           // the jpeg compression quality, between 0 and 1
    //       });
    //       await promisify(fs.writeFile)('./public/uploads/avatar/result.jpg', outputBuffer);
    //     })();
    //     console.log("outputBuffer");

    //   }catch(e){
    //   Sys.Log.info('Error in playerPicUpdate : ' + e);
    //   }
    // },


    // resize images given by url
    resizeImage: async function (req, res) {
        try {
            console.log("resizeImage function called", req.query.url);
            Jimp.read(req.query.url, function (err, image) {
                if (err) {
                    console.log(err);
                    return res.send(err);
                }
                console.log('err', err, 'image', image);
                if (image) {
                    image.cover(parseInt(req.params.w), parseInt(req.params.h));
                    image.getBuffer(Jimp.MIME_PNG, function (err, buffer) {
                        if (err) {
                            console.log(err);
                            return res.send(err);
                        }
                        res.set('Content-Type', 'image/png');
                        return res.send(buffer);
                    });
                } else {
                    Jimp.read(path.join(process.cwd(), '/public/uploads/avatar/profile.png'), function (err, image) {
                        if (err) {
                            console.log(err);
                            return res.send(err);
                        }
                        image.cover(parseInt(req.params.w), parseInt(req.params.h));
                        image.getBuffer(Jimp.MIME_PNG, function (err, buffer) {
                            if (err) {
                                console.log(err);
                                return res.send(err);
                            }
                            res.set('Content-Type', 'image/png');
                            return res.send(buffer);
                        });
                    });
                }
            });
        } catch (error) {
            Sys.Log.info('Error in resizeImage : ' + error);
            return new Error('Error in resizeImage');
        }
    },

    authHTMLToken: async function (req, res) {
        console.log("authHtml token is called", req.params.token);
        try {
            console.log("req.session", req.session)
            let token = req.params.token;
            const column = ['username', 'chips'];
            let player = await Sys.App.Services.AgentServices.getSinglePlayerData({ HTMLToken: token }, column);
            console.log("player in authhtmltoken", player)
            if (!player || player instanceof Error) {
                const obj = {
                    'fail': 'fail',
                    'message': 'Wrong auth token'
                }
                return res.send(obj);
            }
            const response = await Sys.Game.Common.Services.AgentServices.updatePlayerData({
                _id: player.id
            }, { $set: { "HTMLToken": null } });
            var jwt_token = jwt.sign({ id: player.id }, jwtcofig.secret, {
                expiresIn: 300 * 60 // expires in 5 hours
            });
            req.session.web = {};
            req.session.login = true;
            req.session.details = {
                id: player.id,
                name: player.username,
                jwt_token: jwt_token,
                avatar: 'user.png',
                is_admin: 'No',
                role: 'player',
                chips: player.chips,
                temp_chips: 0,
                rake_chips: 0,
                extraRakeChips: 0,
                isSuperAdmin: false,
                isTransferAllow: false
            };
            /*const obj = {
              'success': 'success',
              'message': 'Successfully verified',
              'player': player
            }
            return res.send(obj);*/
            return res.redirect('/groups');
        } catch (err) {
            console.log(err)
        }
    },

    updateAgentsInGame: async function (data) {
        try {
            const { agentId, previousHalls, currentHalls } = data;
            let agent = await Sys.App.Services.AgentServices.getSingleAgentData({ _id: agentId });
            if (agent) {
                const { removed, added } = findDifferences(previousHalls, currentHalls, agent._id, agent.name);
                let query = {
                    gameType: "game_1",
                    //halls: { $in: [player.hall.id] }, 
                    status: "active",
                    stopGame: false,
                    'otherData.isClosed': false,
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                    }
                }

                let games = await Sys.Game.Game1.Services.GameServices.getByData(query, { 'otherData.agents': 1 });

                if (games && games.length > 0) {
                    for (let g = 0; g < games.length; g++) {
                        if (games[g].otherData?.agents && games[g].otherData?.agents.length > 0) {

                            const bulkOperations = [];
                            removed.forEach(item => {
                                bulkOperations.push({
                                    updateOne: {
                                        filter: { _id: games[g]._id },
                                        update: {
                                            $pull: {
                                                "otherData.agents": {
                                                    hallId: item.hallId,
                                                    id: item.id
                                                }
                                            }
                                        }
                                    }
                                });
                            });

                            added.forEach(item => {
                                bulkOperations.push({
                                    updateOne: {
                                        filter: { _id: games[g]._id },
                                        update: {
                                            $addToSet: {
                                                "otherData.agents": item
                                            }
                                        }
                                    }
                                });
                            });

                            if (bulkOperations.length > 0) {
                                await Sys.App.Services.GameService.bulkWriteGameData(bulkOperations)
                                await Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: games[g]._id });
                            }

                        }
                    }
                }

                if (removed.length > 0) {
                    let removedIds = removed.map(item => item.hallId.toString());

                    Sys.Helper.gameHelper.checkForLogout({ agentId: agentId, hallIDs: removedIds });
                }
            }
        } catch (e) {
            console.log("Error in agent update in game", e);
        }
    },



}

async function randomString(length) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var result = '';
    for (var i = length; i > 0; --i) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function haveSameIds(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    const idsSet = new Set(arr1.map(item => item.id));
    return arr2.every(item => idsSet.has(item.id));
}

function findDifferences(arr1, arr2, agentId, agentName) {
    const ids1 = new Set(arr1.map(item => item.id));
    const ids2 = new Set(arr2.map(item => item.id));
    const removed = arr1
        .filter(item => !ids2.has(item.id))
        .map(item => ({
            hallId: mongoose.Types.ObjectId(item.id),
            hallName: item.name,
            name: agentName,
            id: agentId,
            isReady: false,
            scannedTickets: { isSold: false, isPending: false, isScanned: false }
        }));
    const added = arr2
        .filter(item => !ids1.has(item.id))
        .map(item => ({
            hallId: mongoose.Types.ObjectId(item.id),
            hallName: item.name,
            name: agentName,
            id: agentId,
            isReady: false,
            scannedTickets: { isSold: false, isPending: false, isScanned: false }
        }));

    return { removed, added };
}
