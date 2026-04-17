var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var parseInt = require('parse-int');
const rolesArray = ['admin'];
var moment = require('moment-timezone');
var Jimp = require('jimp');
var path = require('path');
var filesize = require('filesize');
const mongoose = require('mongoose');
// const mmm = require('mmmagic');
const handlebars = require('handlebars');
var fs = require('fs');
var jwt = require('jsonwebtoken');
var jwtcofig = {
    'secret': process.env.JWT_SECRET
};
const { promisify } = require('util');
const convert = require('heic-convert');
// nodemialer to send email
const nodemailer = require('nodemailer');
const { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } = require('constants');
const { nextTick } = require('process');

const xlsx = require('xlsx');
const axios = require('axios');
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
const {countryNames, validateAddressData, playerVerificationStatus} = require('../../gamehelper/game1-process')
const { getExistingAndAvailableBlockRules } = require('../../gamehelper/player_common');
const { bankIdEmailTranslation } = require('../../gamehelper/common');
const { getAvailableHallLimit } = require('../../gamehelper/all');
const config = Sys.Config.App[Sys.Config.Database.connectionType];
const crypto = require('crypto');
module.exports = {
    //Common
    getGroupHalls: async function (req, res) {
        try {
            console.log("getting groupHall", req.body);
            let query = {
                status: { $eq: "active" }
            }
            let result = await Sys.App.Services.GroupHallServices.getGroupHalls(query, { name: 1 });
            console.log("result", result);
            return res.send(
                {
                    status: "success",
                    groups: result
                }
            );
        } catch (error) {
            console.log("Error :", error);
            return res.send(
                {
                    status: "failed",
                    groups: []
                }
            );
        }
    },

    getHalls: async function (req, res) {
        try {
            console.log("this route called", req.body, req.query);
            // let query = {
            //     _id: req.query.id,
            //     status: { $eq: "active" }
            // }
            // if (req.session.details.role == 'agent') {
            //     query = { name: req.query.id }
            // }
            // let result = await Sys.App.Services.GroupHallServices.getGroupHall(query, { halls: 1, _id: 0 });
            let query = {
                "groupHall.id": req.query.id,
                "status": "active"
            }
            let result = await Sys.App.Services.HallServices.getAllHallDataSelect(query, { name: 1 });
            // result = result.halls.filter(hall => hall.status == 'active');
            console.log("result", result);
            return res.send(
                {
                    status: "success",
                    halls: result
                }
            );
        } catch (error) {
            console.log("Error in getHalls:", error);
            return res.send(
                {
                    status: "failed",
                    halls: []
                }
            );
        }
    },

    getAgents: async function (req, res) {
        try {
            console.log("getAgents called", req.body, req.query);
            let query = {
                _id: req.query.id,
                status: { $eq: "active" }
            }
            let hallName = req.query.hallId;
            let groupHall = await Sys.App.Services.HallServices.getGroupHallById(req.query.id);
            console.log('halls', groupHall);
            let agents = [];
            /* for(let i = 0; i < halls.agents.length; i++){
                let aghalls = halls.agents[i].halls;
                for(let j=0; j < aghalls.length; j++){
                    if(hallName == aghalls[j]){
                        agents.push(halls.agents[i].name);
                    }
                }
            } */

            let hall = groupHall.halls.find(h => h.hallName == hallName);
            for (let i = 0; i < groupHall.agents.length; i++) {
                let aghalls = groupHall.agents[i].halls;
                for (let j = 0; j < aghalls.length; j++) {
                    if (hall.id == aghalls[j]) {
                        agents.push(groupHall.agents[i].name);
                    }
                }
            }

            console.log('agents', agents);
            return res.send(
                {
                    status: "success",
                    agents: agents
                }
            );
        } catch (error) {
            console.log("Error in getHalls:", error);
            return res.send(
                {
                    status: "failed",
                    halls: []
                }
            );
        }
    },

    // Start approved player
    player: async function (req, res) {
        try {

            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let statusFlag = true;
            let addFlag = true;
            let blockFlag = true;
            let view_risk_categoryFlag = true;
            let halls = [];
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];

                let stringReplace =req.session.details.isPermission['Players Management'] || [];
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
                if (stringReplace?.indexOf("status") == -1) {
                    statusFlag = false;
                }
                if (stringReplace?.indexOf("block/unblock") == -1) {
                    blockFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
                if (stringReplace?.indexOf("view_risk_category") == -1) {
                    view_risk_categoryFlag = false;
                }

                halls = req.session.details.hall;
            } else {
                halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "status": "active" }, { name: 1 });
            }

            const keysArray = [
                "player",
                "table",
                "search",
                "all",
                "active",
                "inactive",
                "blockeds",
                "reset",
                "approved",
                "customer_number",
                "phone_number",
                "by",
                "available_balance_in",
                "action",
                "previous",
                "next",
                "show",
                "entries",
                "view_profile",
                "add_balance",
                "translation_history",
                "game_details",
                "delete",
                "unblocked",
                "balance",
                "add",
                "cancel",
                "delete_message",
                "delete_player_message",
                "delete_button",
                "cancel_button",
                "player_not_delete",
                "cancelled",
                "deleted",
                "import_excel",
                "emailId",
                "username",
                "status",
                "hall_name",
                "edit_profile",
                "player_delete_successfully",
                "player_status_update_successfully",
                "player_status_not_update",
                "do_you_want_update_status",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "are_you_sure",
                "success",
                "transaction_history",
                "verify",
                "unverify",
                "do_you_want_to_verify_player",
                "please_select_id_card_expiry_date",
                "please_select_id_card_expiry_date_from_tomorrow_onward",
                "do_you_want_to_unverify_player",
                "failed",
                "something_went_wrong",
                "isVerified",
                "isVerifiedByHall",
                "isVerifiedByBankId",
                "yes",
                "no",
                "risk_category",
                "low",
                "medium",
                "high",
                "reverify_bankid_players",
                "reverify_bankid_players_title",
                "do_you_want_to_reverify_the_bankid_players",
            ];

            let player = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)


            //console.log("final halls for filter dropdown", halls);
            console.log("Agent----", req.session.details)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                PlayersManagement: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                statusFlag: statusFlag,
                blockFlag: blockFlag,
                addFlag: addFlag,
                view_risk_categoryFlag,
                halls: halls,
                player: player,
                navigation: player
            };
            return res.render('player/ApprovedPlayers/player', data);
        } catch (e) {
            console.log("Error in approve players page", e);
        }
    },

    getPlayer: async function (req, res) {
        try {
            let order = req.query.order;
            //console.log("request query", req.query);
            //console.log("request body", req.body);
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
            let query = { isDeleted: { $ne: true }, 'hall.status': 'Approved', 'userType': { "$nin": ["Unique", "Bot"] } };
            // let query = {}; //$or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
            if (req.query.playerStatus != '') {
                query.status = req.query.playerStatus;
            }
            if (req.query.hallId != '') {
                //query['hall.id'] = req.query.hallId;
                query['approvedHalls'] = { $elemMatch: { 'id': req.query.hallId } };
            } else if (req.session.details.role == 'agent') {
                //query['hall.id'] = req.session.details.hall[0].id;
                //query['approvedHalls'] = req.session.details.hall[0].id;
                query['approvedHalls'] = { $elemMatch: { 'id': req.session.details.hall[0].id } };
            }

            if (req.query.riskCategory != '') {
                if (req.query.riskCategory === "Low") {
                    query.riskCategory = "Low";
                } else {
                    query.$and = [
                        { HR: "yes" },
                        { riskCategory: req.query.riskCategory }
                    ];
                }
            }

            if (search != '') {
                query.$or = [
                    // // { customerNumber: isNaN(Number(search)) ? null : Number(search) },
                    // { $expr: { $regexMatch: { input: { $toString: "$customerNumber" }, regex: '.*' + search + '.*', options: 'i' } } },
                    // // { username: { $regex: '.*' + search + '.*' } },
                    // { username: { $regex: '.*' + search + '.*', $options: 'i' } },
                    // { phone: { $regex: '.*' + search + '.*' } },
                    { $expr: { $regexMatch: { input: { $toString: "$customerNumber" }, regex: `^${search}`, options: "i" } } }, // Starts with customerNumber
                    { username: { $regex: `^${search}`, $options: "i" } }, // Starts with username
                    { phone: { $regex: `^${search}`, $options: "i" } }, // Starts with phone number
                ]

                //query.username = { $regex: '.*' + search + '.*' };
            }
            console.log('query:', JSON.stringify(query), length, start, sort);

            let playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
            console.log("approve player count", playersCount);
            let data = await Sys.App.Services.PlayerServices.getPlayerDatatableNew(query, length, start, sort);

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in get aprrove players list", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    viewPlayerDetails: async function (req, res) {
        try {

            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            // flags for view_risk_category permission
            let flags = {
                view_risk_categoryFlag: true,
                view_risk_commentFlag: true,
            };
            if (req.session.details.role == 'agent') {
                const permissions = req.session.details.isPermission?.['Players Management'] || '';
                for (const key of ['view_risk_category', 'view_risk_comment']) {
                    if (!permissions.includes(key)) {
                        flags[key + 'Flag'] = false;
                    }
                }
            } 
            let query = {
                _id: req.params.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query);

            let dt = new Date(dataPlayer.dob);
            let date = dt.getDate();
            let month = parseInt(dt.getMonth() + 1);
            let year = dt.getFullYear();
            let hours = dt.getHours();
            let minutes = dt.getMinutes();
            let ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12;
            hours = hours ? hours : 12;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            let dob = year + '/' + month + '/' + date;

            const keysArray = [
                "view_player_details",
                "date_of_birth",
                "bank_ac_no",
                "is_the_player_high_risk",
                "is_the_player_pep",
                "photo_id",
                "customer_number",
                "emailId",
                "username",
                "hall",
                "available_balance_in",
                "approved",
                "by",
                "phone_number",
                "fullname",
                "cancel",
                "firstname",
                "do_you_have_address_in_norway",
                "name_of_pep",
                "relation_with_pep",
                "type_of_income_used_to_play",
                "salary",
                "sale_lease_property",
                "stocks",
                "social_security_pension_support_scheme",
                "gift_inheritance",
                "other",
                "yes",
                "no",
                "verify",
                "are_you_sure",
                "do_you_want_to_verify_player",
                "please_select_id_card_expiry_date",
                "please_select_id_card_expiry_date_from_tomorrow_onward",
                "cancel_button",
                "success",
                "failed",
                "risk_category",
                "low",
                "medium",
                "high",
                "risk_comment",
                "address",
                "city",
                "zip_code",
                "country",
                "block_rules",
                "block_rule_not_found",
                "games_blocked",
                "expiry_date",
                "delete"
            ];

            let player = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            
            // get player block rules
            const allHalls = dataPlayer.approvedHalls?.map(h => h.id) || [];
            const { existingBlockRules } = await getExistingAndAvailableBlockRules(allHalls, dataPlayer?.blockRules);
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                PlayersManagement: 'active',
                Player: dataPlayer,
                DOB: dob,
                editFlag:editFlag,
                player: player,
                navigation: player,
                pepdateofBirth: moment(dataPlayer?.pepDetails?.dateOfBirth).format("YYYY-MM-DD"),
                permissions: flags,
                existingBlockRules,
            };
            return res.render('player/ApprovedPlayers/viewPlayer', data);
        } catch (e) {
            console.log("Error in view approve player", e);
            req.flash('error', "There Was a Problem while Fetching Details.")
            return res.redirect('/player');
        }
    },

    editPlayer: async function (req, res) {
        try {
            // flags for view_risk_category and edit_risk_category permission
            let flags = {
                view_risk_categoryFlag: true,
                edit_risk_categoryFlag: true,
                view_risk_commentFlag: true,
                edit_risk_commentFlag: true,
            };
            if (req.session.details.role == 'agent') {
                const permissions = req.session.details.isPermission?.['Players Management'] || '';
                for (const key of ['view_risk_category', 'edit_risk_category', 'view_risk_comment', 'edit_risk_comment']) {
                    if (!permissions.includes(key)) {
                        flags[key + 'Flag'] = false;
                    }
                }
            } 
            let player = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: req.params.id });
            if (!player) {
                req.flash("error", "Player Not Found");
                return res.redirect("/player");
            }
            console.log('player.hall', player.hall);
            let halls = await Sys.App.Services.HallServices.getByData({ "status": "active", "agents": { "$exists": true, "$type": "array", "$ne": [] } });
            // let hallData = await Sys.App.Services.HallServices.getHallById(player.hall.id);
            console.log('hallData', halls);
            let dob = moment(player.dob).format('YYYY-MM-DD');
            console.log('dob', dob);


            const keysArray = [
                "edit_player_details",
                "date_of_birth",
                "bank_ac_no",
                "is_the_player_high_risk",
                "is_the_player_pep",
                "photo_id",
                "customer_number",
                "emailId",
                "username",
                "hall",
                "available_balance_in",
                "approved",
                "by",
                "phone_number",
                "fullname",
                "cancel",
                "firstname", "edit_player_details",
                "profile",
                "agent",
                "player",
                "dashboard",
                "do_you_have_address_in_norway",
                "name_of_pep",
                "relation_with_pep",
                "type_of_income_used_to_play",
                "salary",
                "sale_lease_property",
                "stocks",
                "social_security_pension_support_scheme",
                "gift_inheritance",
                "other",
                "yes",
                "no",
                "risk_category",
                "low",
                "medium",
                "high",
                "risk_comment",
                "address",
                "city",
                "zip_code",
                "country",
                "income_source_required",
                "enter",
                "block_rules",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_block_rule",
                "yes_delete",
                "no_cancle",
                "deleted",
                "something_went_wrong",
                "failed",
                "block_rule_not_found",
                "delete",
                "games_blocked",
                "expiry_date"
            ];

            let editPlayer = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            // get player block rules
            const allHalls = player.approvedHalls?.map(h => h.id) || [];
            const { existingBlockRules } = await getExistingAndAvailableBlockRules(allHalls, player?.blockRules);

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                PlayersManagement: 'active',
                player: player,
                photoLength: player.profilePic.length > 0 ? player.profilePic.length == 1 ? 1 : 2 : 0,
                DOB: dob,
                halls: halls,
                editPlayer: editPlayer,
                navigation: editPlayer,
                pepdateofBirth: moment(player?.pepDetails?.dateOfBirth).format("YYYY-MM-DD"),
                countries: countryNames.getCountries(),
                permissions: flags,
                existingBlockRules,
            };
            return res.render('player/ApprovedPlayers/profile', data);
        } catch (e) {
            console.log("Error in edit player page", e);
            req.flash("error", "Internal server error");
            return res.redirect("/player");
        }
    },

    editPlayerPostData: async function (req, res) {
        try {
            // flags for edit_risk_category permission
            let flags = {
                edit_risk_categoryFlag: true,
                edit_risk_commentFlag: true,
            };
            if (req.session.details.role == 'agent') {
                const permissions = req.session.details.isPermission?.['Players Management'] || '';
                for (const key of ['edit_risk_category', 'edit_risk_comment']) {
                    if (!permissions.includes(key)) {
                        flags[key + 'Flag'] = false;
                    }
                }
            } 
            const isAdmin = req.session.details.role === 'admin';
            const isAgent = req.session.details.role === 'agent';

            let player = await Sys.App.Services.PlayerServices.getSinglePlayer({ _id: req.params.id });
            let language = req.session.details.language ??  "norwegian";
            let keys = [
                "email_exists",
                "phone_exists",
                "pep_fields_are_required",
                "player_has_been_successfully_updated"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, language);
            console.log("req.body**************", req.body);
            console.log("files@@@@@@@@@@@@@@", req.files);
            if (player) {

                // check for PEP details and validation
                const {
                    hasNorwegianAddress, // Maps to residentialAddressInNorway
                    nameOfPEP,           // Maps to pepName
                    relationshipToPEP,   // Maps to pepRelationship
                    dateOfBirth,         // Maps to pepDateOfBirth
                    'income[]': income,   // Represents multiple income sources
                    riskCategory,
                    riskComment,
                    isResidentialAddressInNorway,
                    city,
                    zipCode,
                    address,
                    country,
                } = req.body;

                if (req.body.PEP == "yes") {
                    // Validate PEP details
                    if (
                        hasNorwegianAddress === undefined || // Check if Norwegian address is defined
                        !nameOfPEP || // Ensure PEP name is provided
                        !relationshipToPEP || // Ensure PEP relationship is provided
                        !dateOfBirth || // Ensure PEP date of birth is provided
                        (!income || income.length === 0) // Validate at least one income source is selected
                    ) {
                        req.flash('error', translate.pep_fields_are_required);
                        return res.redirect('/player');
                    }
                }
                
                const selectedSources = req.body['incomeSources[]'] || [];  
                const validationResult = validateAddressData({isResidentialAddressInNorway: isResidentialAddressInNorway == "yes", city, zipCode, address, country, incomeSources: { playBySalary: selectedSources.includes('salary'), playByPropertySaleOrLease: selectedSources.includes('propertySaleOrLease'), playByStocks: selectedSources.includes('stocks'), playBySocialSupport: selectedSources.includes('socialSupport'), playByGiftsOrInheritance: selectedSources.includes('giftsOrInheritance'), playByOther: selectedSources.includes('other') } });
                if (!validationResult.isValid && validationResult.error) {
                    req.flash('error', await Sys.Helper.bingo.getSingleTraslateData([validationResult.error], language, "game"));
                    return res.redirect('/playerEdit/' + player.id);
                } 

                // let hallReq = req.body.hallId?.toString().trim();
                // let agentId = req.body.agent;
                // let hallData, agentData;
                // if (hallReq) {
                //     let query = {
                //         "_id": hallReq
                //     }
                //     if (agentId) {
                //         query[`agents.id`] = mongoose.Types.ObjectId(agentId.toString());
                //     }
                //     hallData = await Sys.App.Services.HallServices.getSingleHallData(query,['name','agents']);
                //     console.log('hallData', hallData, query);
                //     if (!hallData) {
                //         req.flash('error', 'Hall Not found.');
                //         return res.redirect('/player');
                //     }
                // }
                // console.log('hallData', hallData);
                // let agent;
                // if (agentId) {
                //     agent = hallData.agents.find(agent => agent.id.toString() == agentId);
                //     agent.id = agent.id.toString();
                // }

                // players in multiple hall
                let approvedHalls = [];
                if (req.body.hallId?.length > 0) {
                    // Get existing approvedHalls from player to preserve other properties
                    let existingApprovedHalls = player.approvedHalls || [];

                    let allHalls = await Sys.App.Services.HallServices.getAllHallDataSelect({ _id: { $in: req.body.hallId } }, ['name', 'groupHall']);
                    if (allHalls && allHalls.length > 0) {
                        for (let a = 0; a < allHalls.length; a++) {
                            // Check if this hall already exists in approvedHalls
                            let existingHallIndex = existingApprovedHalls.findIndex(hall => hall.id === allHalls[a].id.toString());
                            
                            if (existingHallIndex !== -1) {
                                // Hall exists, preserve existing properties and update only necessary ones
                                let existingHall = existingApprovedHalls[existingHallIndex];
                                approvedHalls.push({
                                    ...existingHall, // Preserve all existing properties
                                    name: allHalls[a].name, // Update name if changed
                                    groupHall: allHalls[a].groupHall, // Update groupHall if changed
                                });
                            } else {
                                // New hall, create new entry
                                approvedHalls.push({
                                    status: "Approved",
                                    id: allHalls[a].id,
                                    name: allHalls[a].name,
                                    groupHall: allHalls[a].groupHall,
                                });
                            }
                        }
                    }
                }
                // players in multiple hall

                // Check if email is already taken and not the user's current email
                if (req.body.email && req.body.email !== player.email) {
                    const existingEmail = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ email: req.body.email });
                    if (existingEmail) {
                        req.flash('error', translate.email_exists || "Email already exists"); //Email already exists
                        return res.redirect('/playerEdit/' + player.id);
                    }
                }

                // Check if phone is provided and matches the regex pattern
                const phoneRegex = /^[0-9]+$/;
                if (req.body.phone && req.body.phone !== player.phone) {
                    // Check if phone matches the regex pattern
                    if (!req.body.phone.match(phoneRegex)) {
                        req.flash('error', 'Phone number is required and must contain only numbers.');
                        return res.redirect('/playerEdit/' + player.id);
                    }

                    const existingPhone = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ phone: req.body.phone });
                    if (existingPhone) {
                        req.flash('error', translate.phone_exists || "Phone number already exists"); //Phone number already exists
                        return res.redirect('/playerEdit/' + player.id);
                    }
                }

                // Check if nickname is already taken and not the user's current nickname   
                // if (req.body.nickname && req.body.nickname.toLowerCase() !== player.nickname.toLowerCase()) {
                //     const existingNickname = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ $or: [{ username: req.body.nickname.toLowerCase()  }, { nickname: req.body.nickname.toLowerCase() }] });
                //     console.log("existingNickname----", existingNickname)
                //     if (existingNickname) {
                //         req.flash('error', 'Firstname already exists.');
                //         return res.redirect('/playerEdit/'+ player.id);
                //     }
                // }

                let data = {
                    "email": req.body.email,
                    "nickname": req.body.nickname.toLowerCase(),
                    "phone": req.body.phone,
                    "dob": req.body.dob,
                    //'hall.id': hallData ? (hallData._id).toString() : player.hall.id,
                    //'hall.name': hallData ? hallData.name : player.hall.name,
                    //'hall.agent': agentId ? agent : player.hall.agent,
                    'HR': req.body.HR,
                    "bankId": req.body.bankId,
                    //approvedHalls: approvedHalls,
                    addressDetails: validationResult.addressDetails
                }
                if (req.session.details.role == 'admin') {
                    data.approvedHalls = approvedHalls;
                }

                // edit risk category if admin or agent with edit_risk_category permission
                if (isAdmin || (isAgent && flags.edit_risk_categoryFlag)) {
                    data.riskCategory = riskCategory;
                }
                // edit risk comment if admin or agent with edit_risk_comment permission
                if (isAdmin || (isAgent && flags.edit_risk_commentFlag)) {
                    data.riskComment = riskComment;
                }
                
                if (req.body.PEP == "yes") {
                    data.pepDetails = {
                        residentialAddressInNorway: hasNorwegianAddress.toLowerCase() === "yes", // Convert to boolean
                        name: nameOfPEP,
                        relationship: relationshipToPEP,
                        dateOfBirth: new Date(dateOfBirth), // Convert date to Date object
                        incomeSources: {
                            salary: !!income.includes('salary'), // Convert to boolean (true if salary exists)
                            propertySaleOrLease: !!income.includes('propertySaleOrLease'),
                            stocks: !!income.includes('stocks'),
                            socialSupport: !!income.includes('socialSupport'),
                            giftsOrInheritance: !!income.includes('giftsOrInheritance'),
                            other: !!income.includes('other'),
                        }
                    };

                }
                console.log('req.files.length', req.files?.length);
                data.profilePic = player.profilePic;
                // data.captureImage = player?.captureImage || "";

                // let processImage = async (imageFile) => {
                //     console.log("🚀 ~ processImage ~ imageFile:", imageFile)
                //     if (!imageFile) return null;

                //     var re = /(?:\.([^.]+))?$/;
                //     var extension = re.exec(imageFile.name)[1];
                //     let randomNum = Math.floor(100000 + Math.random() * 900000);
                //     let fileName = req.params.id + '_' + randomNum + '.' + extension;

                //     imageFile.mv('public/assets/profilePic/' + fileName, function (err) {
                //         if (err) {
                //             req.flash('error', 'Error Uploading Profile Avatar');
                //             return res.redirect('/player');
                //         }
                //     });
                //     let imagePath = '/assets/profilePic/' + fileName;
                //     return imagePath;
                // };

                // if (req.files.capturedImage) {
                //     data.captureImage = await processImage(req.files.capturedImage);
                // }

                if (!req.files || req.files.profilePic0 == undefined && req.files.profilePic1 == undefined) {
                    console.log('if');
                    data.profilePic = player.profilePic
                    // data.captureImage = player.captureImage
                } else {
                    console.log('else');
                    let arrayOfPhoto = [];
                    req.files.take_photo = [];
                    if (req.files.profilePic0 && req.files.profilePic1) {
                        req.files.take_photo = [{ one: req.files.profilePic0 }, { two: req.files.profilePic1 }];
                    } else if (req.files.profilePic0 != undefined && req.files.profilePic1 == undefined) {
                        req.files.take_photo = [{ one: req.files.profilePic0 }];
                    } else if (req.files.profilePic0 == undefined && req.files.profilePic1 != undefined) {
                        req.files.take_photo = [{ two: req.files.profilePic1 }];
                    }

                    // Function to process image upload


                    for (let i = 0; i < req.files.take_photo.length; i++) {
                        let image = req.files.take_photo[i].one ? req.files.take_photo[i].one : req.files.take_photo[i].two;
                        console.log(image);
                        var re = /(?:\.([^.]+))?$/;
                        var extension = re.exec(image.name)[1];
                        let randomNum = Math.floor(100000 + Math.random() * 900000);
                        let fileName = req.params.id + '_' + randomNum + '.' + extension;
                        // Use the mv() method to place the file somewhere on your server
                        image.mv('public/assets/profilePic/' + fileName, function (err) {
                            if (err) {
                                req.flash('error', 'Error Uploading Profile Avatar');
                                return res.redirect('/player');
                            }
                        });
                        let imagePath = '/assets/profilePic/' + fileName;
                        // arrayOfPhoto.push(imagePath);
                        if (req.files.take_photo[i].one) {
                            data.profilePic[0] = imagePath
                        } else {
                            data.profilePic[1] = imagePath
                        }
                    }
                    // data.profilePic = arrayOfPhoto;
                }
                console.log('data', data);
                await Sys.App.Services.PlayerServices.updatePlayerData({ _id: req.params.id }, data);

                // send broadcast of playerApprovedHalls to current player
                //const playerApprovedHalls = approvedHalls?.filter(hall => hall.status == "Approved").map(h => h.name)
                const playerApprovedHalls = await getAvailableHallLimit({ playerId: player._id, approvedHalls: approvedHalls, selectedHallId: player?.hall?.id });
                
                // Check if player's hall.id exists in approved halls
                const isLoggedInHall = playerApprovedHalls.some(h => h.hallId === player?.hall?.id);

                if (!isLoggedInHall && playerApprovedHalls.length > 0) {
                    // Update hall.id to the first approved hallId
                    const loggedInHall = playerApprovedHalls[0];
                    loggedInHall.isSelected = true;
                    await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer({
                        _id: player._id
                    }, {
                        hall: {
                            id: loggedInHall.hallId,
                            name: loggedInHall.hallName,
                            status: "Approved"
                        },
                        groupHall: loggedInHall.groupHall
                    });
                }

                await Sys.Io.to(player.socketId).emit('playerApprovedHalls', {
                    approvedHalls: playerApprovedHalls
                });

                req.flash('success', translate.player_has_been_successfully_updated || "Player has been successfully updated");
                // return res.redirect('/playerEdit/'+ req.params.id);
                return res.redirect('/player');
            } else {
                req.flash('error', 'No User found');
                return res.redirect('/player');
            }
        } catch (e) {
            console.log("Error", e);
            req.flash('error', 'User not Edited');
            return res.redirect('/player');
        }
    },

    changePwd: async function (req, res) {
        try {
            console.log("changePwd", req.body);
            let player = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: req.params.id });
            console.log("changePwd", player);

            if (player || player.length > 0) {
                if (bcrypt.compareSync(req.body.oldPassword, player.password)) {
                    if (req.body.verifyNewPassword.length >= 6) {
                        if (req.body.newPassword == req.body.verifyNewPassword) {
                            await Sys.App.Services.PlayerServices.updatePlayerData({ _id: req.params.id }, {
                                password: bcrypt.hashSync(req.body.newPassword, bcrypt.genSaltSync(8), null)
                            });
                            req.flash('success', 'Player password updated successfully');
                            return res.redirect('/player');
                        } else {
                            req.flash('error', 'New password and verify password mismatch.');
                            return res.redirect('/player');
                        }
                    } else {
                        req.flash('error', 'Password must be more than six characters');
                        return res.redirect('/player');
                    }
                } else {
                    req.flash('error', 'Please provide correct old password.');
                    return res.redirect('/player');
                }
            } else {
                req.flash('error', 'No User found');
                return res.redirect('/player');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    hallStatus: async function (req, res) {
        try {
            console.log("hallStatus", req.body);
            let player = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: req.body.playerId });
            if (player || player.length > 0) {

                var hallArrayOfObj = player.hall;

                //Find index of specific object using findIndex method.    
                objIndex = hallArrayOfObj.findIndex((obj => obj._id == req.body.optionId));

                //Log object to Console.
                console.log("Before update: ", hallArrayOfObj[objIndex])

                if (req.body.btn == "accept") {
                    //Update object's status property.
                    hallArrayOfObj[objIndex].status = "Approved";
                } else {
                    //Update object's status property.
                    hallArrayOfObj[objIndex].status = "Disapproved";
                }


                //Log object to console again.
                console.log("After update: ", hallArrayOfObj[objIndex])

                console.log("After update : hallArrayOfObj ", hallArrayOfObj)


                await Sys.App.Services.PlayerServices.updatePlayerData({ _id: player._id }, {
                    hall: hallArrayOfObj
                });

                let playerUpdated = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: player._id });

                res.send({ 'status': 'success', 'message': 'Hall Status Updated successfully', data: playerUpdated.hall });
            } else {
                res.send({ 'status': 'fail', 'message': 'Hall Status Not Updated' });
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.PlayerServices.getPlayerData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.PlayerServices.deletePlayer(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    playerSoftDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.PlayerServices.getPlayerData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.PlayerServices.update(req.body.id, { $set: { isDeleted: true } });
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    active: async function (req, res) {
        try {
            let player = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: req.body.id });
            console.log('player', player);
            if (player || player.length > 0) {
                console.log('player', player);
                if (player.status == 'Active') {
                    await Sys.App.Services.PlayerServices.update({
                        _id: req.body.id
                    }, {
                        status: 'Blocked'
                    })
                } else {
                    await Sys.App.Services.PlayerServices.update({
                        _id: req.body.id
                    }, {
                        status: 'Active'
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

    viwePlayerGameManagementDetail: async function (req, res) {
        try {
            var gameType;
            console.log("Req.params calling", req.params);
            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            console.log("gameType", gameType);
            var theadField;
            if (gameType != undefined) {
                if (gameType.type == "game_1") {
                    theadField = [
                        "GameId",
                        "GameType",
                        "Start Date and Time",
                        "Variant Game",
                        "Ticket Color/Type",
                        "Ticket Number",
                        "Ticket Purchased From",
                        "Before Balance",
                        "Ticket Price",
                        "Winning Price",
                        "After Balance",
                        "Remark",
                        "createdAt"
                    ]
                } else if (gameType.type == "game_2") {
                    theadField = [
                        "GameId",
                        "GameType",
                        "Start Date and Time",
                        "Ticket Number",
                        "Ticket Purchased From",
                        "Before Balance",
                        "Ticket Price",
                        "Winning Price",
                        "After Balance",
                        "Remark"
                    ]
                } else if (gameType.type == "game_3") {
                    theadField = [
                        "GameId",
                        "GameType",
                        "Start Date and Time",
                        "Ticket Number",
                        "Ticket Purchased From",
                        "Before Balance",
                        "Ticket Price",
                        "Winning Price",
                        "After Balance",
                        "Remark"
                    ]
                } else if (gameType.type == "game_4") {
                    theadField = [
                        "GameId",
                        "GameType",
                        "Start Date and Time",
                        "Ticket Number",
                        "Ticket Purchased From",
                        "Before Balance",
                        "Ticket Price",
                        "Winning Price",
                        "After Balance",
                        "Remark"
                    ]
                } else {
                    req.flash('error', 'Game Not Found');
                    return res.redirect('/dashboard');
                }
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }


            var data = {
                gameData: gameType,
                theadField: theadField
            };
            res.send(data);

        } catch (error) {
            console.log('Error in viweGameManagementDetail: ', error);
            return new Error(error);
        }
    },

    playerGetGameManagementDetailList: async function (req, res) {
        try {
            console.log("playerGetGameManagementDetailList calling", req.query, req.body);
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {
                gameType: req.query.gameType,
                playerId: req.query.playerId,
                withdrawType: {
                    $ne: "withdraw"
                }
            };
            if (search != '') {
                query = {
                    gameNumber: { $regex: '.*' + search + '.*' },
                    gameType: req.query.gameType,
                    playerId: req.query.playerId,
                    withdrawType: {
                        $ne: "withdraw"
                    }
                };
            }

            // let startTo = new Date(req.query.start_date);
            // let endFrom = new Date(req.query.end_date);
            // endFrom.setHours(23, 59, 59);

            // if (req.query.is_date_search == "yes" && search == '') {
            //     query = { createdAt: { $gte: startTo, $lt: endFrom } };
            // }

            // if (req.query.is_date_search == "yes" && search != '') {
            //     query = { fullName: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            // }
            //
            //console.log(query);
            let reqCount = await Sys.App.Services.PlayerServices.getPlayerTransactionDataCount(query);
            //console.log(reqCount);
            console.log("sort playerGetGameManagementDetailList", sort);
            let data = await Sys.App.Services.PlayerServices.getTransactionDataTable(query, length, start, sort);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            //console.log("data:::::::::::::", gameData)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in playerGetGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    playerTransactionsClient: async function (req, res) {
        try {
            console.log("External transactions API called", req.params.id, req.body)
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: req.params.id });

            if (player) {
                //let TransactionHistory = await Sys.Game.Common.Services.PlayerServices.transaction100Data({ playerId: player._id, defineSlug: "extraTransaction" });
                let transactionCount = await Sys.App.Services.PlayerServices.getPlayerTransactionDataCount({ playerId: player._id, $or: [{ defineSlug: "extraTransaction" }, { defineSlug: "patternPrizeGame1" }] })
                let perpage = parseInt(req.body.perPageRecords);
                if (!perpage) { perpage = 1 }

                const pageCount = Math.ceil(transactionCount / perpage);
                let page = parseInt(req.body.pageNumber);
                if (!page) { page = 1; }
                if (page > pageCount) {
                    page = pageCount
                }
                let skip = ((page - 1) * perpage)
                let TransactionHistory = await Sys.App.Services.PlayerServices.getTransactionDataTable({ playerId: player._id, $or: [{ defineSlug: "extraTransaction" }, { defineSlug: "patternPrizeGame1" }] }, perpage, skip, { createdAt: -1 });

                let result = [];

                for (let i = 0; i < TransactionHistory.length; i++) {

                    console.log("TransactionHistory[i].typeOfTransaction", TransactionHistory[i].typeOfTransaction);
                    let exp = {
                        //date: moment(new Date(TransactionHistory[i].createdAt)).tz('UTC').format('MMMM-DD-YYYY'), //"SEPTEMBER 10 2020",
                        amount: (TransactionHistory[i].category == "credit") ? "+" + TransactionHistory[i].typeOfTransactionTotalAmount : "-" + TransactionHistory[i].typeOfTransactionTotalAmount,
                        type: TransactionHistory[i].typeOfTransaction, //"gameJoined/gameWon", 
                        id: TransactionHistory[i].transactionId,
                        purchasedFrom: (TransactionHistory[i].amtCategory == "realMoney") ? "Wallet" : "Points",
                        date: moment(new Date(TransactionHistory[i].createdAt)).tz('UTC').format('DD-MM-YYYY HH:mm:ss'),
                    }
                    result.push(exp);
                }
                //console.log("result", result);
                res.status(201).send({
                    status: 'success',
                    currentPageNumber: page,
                    totalPageCount: pageCount,
                    result: result,
                    message: 'Players Transaction History'
                })

            } else {
                res.status(400).send({
                    status: 'fail',
                    result: null,
                    message: 'Player Not Found!',
                    statusCode: 400
                })

            }

        } catch (error) {
            Sys.Log.error('Error in viweGameManagementDetail: ', error);
            return new Error(error);
        }
    },

    depositMoneyClient: async function (req, res, cb) {
        try {
            const XmlReader = require('xml-reader');
            const xmlQuery = require('xml-query');
            console.log("depositMoney data", req.body);

            if (!req.body.amount || parseFloat(req.body.amount) < 0) {
                return cb({ "status": "fail", "message": "Please Enter Deposit Amount" });
            }

            var message, transactionID, paymentBaseUrl;
            let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: req.body.playerId });
            if (player) {
                var ID = Date.now()
                var orderNumber = await Sys.Helper.bingo.ordNumFunction(ID);
                let randomNumber = Math.floor(100000 + Math.random() * 900000);

                var options = {
                    method: 'GET',
                    url: Sys.Config.App[Sys.Config.Database.connectionType].payment.registerurl,
                    qs: {
                        merchantId: Sys.Config.App[Sys.Config.Database.connectionType].payment.merchantId,
                        token: Sys.Config.App[Sys.Config.Database.connectionType].payment.token,
                        orderNumber: 'ORD' + orderNumber + '' + randomNumber,
                        amount: parseInt(req.body.amount),
                        CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].payment.CurrencyCode,
                        redirectUrl: Sys.Config.App[Sys.Config.Database.connectionType].payment.redirectUrl
                    },
                };

                var apiCalling = await Sys.Helper.bingo.paymentGetAPI(options);

                console.log(" depositMoney request apiCalling", apiCalling);

                var ast = XmlReader.parseSync(apiCalling.data);

                console.log("response body ast", xmlQuery(ast).children());
                var errorType = xmlQuery(ast).children().find('Error').attr('xsi:type');
                console.log("response body errorType", errorType);

                if (errorType) {
                    var errorSection = 'Register';
                    var dataSend = {
                        playerId: player.id,
                        hallId: player.hall.id,
                        orderNumber: options.qs.orderNumber,
                        amount: parseInt(req.body.amount),
                    }
                    var errorCheck = await Sys.Helper.bingo.errorCheck(errorType, errorSection, ast, dataSend);
                    res.status(400).send({
                        status: 'fail',
                        result: null,
                        message: "Sorry Payment not proceed forward, Something Went Wrong!"
                    })
                } else {
                    transactionID = xmlQuery(ast).find('TransactionId').text();
                    console.log("***************************************************************************");
                    console.log(" depositMoney response body transactionID", transactionID);
                    console.log("***************************************************************************");
                    if (transactionID !== null) {
                        paymentBaseUrl = 'https://test.epayment.nets.eu/Terminal/default.aspx?merchantId=' + Sys.Config.App[Sys.Config.App.connectionType].payment.merchantId + '&transactionId=' + transactionID + '';

                        let deposit = await Sys.App.Services.depositMoneyServices.insertData({
                            playerId: await Sys.Helper.bingo.obId(player.id),
                            hallId: player.hall.id,
                            playerName: player.username,
                            orderNumber: options.qs.orderNumber,
                            amount: parseInt(req.body.amount),
                            CurrencyCode: Sys.Config.App[Sys.Config.Database.connectionType].payment.CurrencyCode,
                            transactionID: transactionID,
                            status: "pending",
                            createdAt: Date.now()
                        });
                        console.log("deposit Insert", deposit);
                        res.status(201).send({
                            status: 'success',
                            result: paymentBaseUrl,
                            message: "Please open this payment Url in Browser"
                        })
                    } else {
                        res.status(400).send({
                            status: 'fail',
                            result: null,
                            message: "Sorry Payment not proceed forward, Something Went Wrong!"
                        })
                    }
                }
            } else {
                res.status(400).send({
                    status: 'fail',
                    result: null,
                    message: 'Player Not Found!',
                    statusCode: 400
                })
            }

        } catch (error) {
            console.log("Error caught in depositMoneyClient", error);
            Sys.Log.info('Error in depositMoney : ' + error);
        }
    },
    //End Approved player

    //Start Pending Player
    pendingRequests: async function (req, res) {
        try {

            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let statusFlag = true;
            let halls = [];
            //console.log("session details of request sender", req.session.details);
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Players Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("status") == -1) {
                    statusFlag = false;
                }
                halls = req.session.details.hall;
            } else {
                halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "status": "active" }, { name: 1 });
            }
            console.log("halls for filter dropdown", halls);

            const keysArray = [
                "search_by_filter",
                "from_date",
                "to_date",
                "reset",
                "customer_number",
                "emailId",
                "username",
                "phone_number",
                "status",
                "hall_name",
                "action",
                "request_by",
                "request_date_time",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "upload",
                "pending_requests_table",
                "view_details",
                "pending",
                "forward_to_admin"
            ];

            let pendingRequests = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PendingRequests: 'active',
                PlayersManagement: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                statusFlag: statusFlag,
                halls: halls,
                pendingRequests: pendingRequests,
                navigation: pendingRequests
            };
            return res.render('player/PendingRequests/pendingRequests', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPendingPlayer: async function (req, res) {
        try {
            //console.log("pending request datatable params", req.query);
            let order = req.query.order;
            let params = req.query.params;
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
            //let query = { $and: [{ username: { $regex: '.*' + search + '.*' } }] };
            let query = { '$and': [] };
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search)) ? null : Number(search) },
                    { username: { $regex: '.*' + search + '.*' } }
                ]
                //query.username = { $regex: '.*' + search + '.*' };
            }

            if (params.fromDate !== '' || params.toDate !== '') {
                let updatedAt = {};
                if (params.fromDate !== '') {
                    updatedAt.$gte = params.fromDate;
                }
                if (params.toDate !== '') {
                    updatedAt.$lte = params.toDate;
                }
                query['$and'].push({ 'updatedAt': updatedAt });
            }
            query['$and'].push({ "hall.status": { $eq: 'Pending' } });
            if (req.session.details.role == 'admin') {
                if (params.hallId !== '') {
                    //query['$and'].push({ "hall.id": { $eq: params.hallId } });
                    query['approvedHalls'] = { $elemMatch: { 'id': params.hallId } };
                }
                // query['$and'].push({ "hall.agent": { $ne: {} } });
                // query['$and'].push({ "hall.actionBy": { $nin: [{},null] } });
            } else if (req.session.details.role == 'agent') {
                query['approvedHalls'] = { $elemMatch: { 'id': req.session.details.hall[0].id } };
                //query['$and'].push({ "hall.id": { $eq: req.session.details.hall[0].id } });
                // query['$and'].push({ "hall.agent.id": req.session.details.id });
            }


            let playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
            console.log("count of pending request", playersCount, JSON.stringifyquery);
            console.log("final query", JSON.stringify(query));
            let data = await Sys.App.Services.PlayerServices.getPlayerDatatableNew(query, length, start, sort);
            //console.log("final data", data);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getPendingPlayer", e);
            return res.send({
                'status': 500,
                'message': 'Server Side Error, Try Again after Sometime.',
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    viewPendingRequestDetails: async function (req, res) {
        try {
            console.log("viewPendingRequestDetails", req.params.id);
            let query = {
                _id: req.params.id
            };
            let acceptFlag = true;
            let rejectFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Players Management'];

                if (stringReplace?.indexOf("accept") == -1) {
                    acceptFlag = false;
                }
                if (stringReplace?.indexOf("reject") == -1) {
                    rejectFlag = false;
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            const dataPlayer = await Sys.App.Services.PlayerServices.getById(query);
            console.log("pending player found", dataPlayer._id);
            const dt = new Date(dataPlayer.dob);
            const date = dt.getDate();
            const month = parseInt(dt.getMonth() + 1);
            const year = dt.getFullYear();
            let hours = dt.getHours();
            let minutes = dt.getMinutes();
            let ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12;
            hours = hours ? hours : 12;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            const dob = date + '/' + month + '/' + year; // + ' ' + hours + ':' + minutes + ' ' + ampm;
            const halls = [];
            const agents = [];
            let forwarded = false;
            if (req.session.details.role == 'agent') {
                if (dataPlayer.hall?.actionBy?.name) {
                    forwarded = true;
                }
                console.log("hall length", req.session.details);
                for (let i = 0; i < req.session.details.hall.length; i++) {
                    const element = req.session.details.hall[i].id;
                    let hall = await Sys.App.Services.HallServices.getSingleHall({ _id: new mongoose.Types.ObjectId(element) });
                    if (hall) {
                        halls.push({
                            id: hall._id,
                            name: hall.name
                        });
                    }
                }
            } else {
                const hall = await Sys.App.Services.HallServices.getSingleHall({ _id: dataPlayer.hall.id });
                agents.push(...hall.agents)
            }

            const keysArray = [
                "customer_number",
                "firstname",
                "emailId",
                "username",
                "phone_number",
                "status",
                "hall_name",
                "action",
                "request_by",
                "request_date_time",
                "is_the_player_high_risk",
                "is_the_player_pep",
                "photo_id",
                "date_of_birth",
                "bank_ac_no",
                "request_by",
                "agent", "hall", "cancel",
                "approve",
                "reject",
                "forward_to_admin",
                "upload",
                "do_you_have_address_in_norway",
                "name_of_pep",
                "relation_with_pep",
                "type_of_income_used_to_play",
                "salary",
                "sale_lease_property",
                "stocks",
                "social_security_pension_support_scheme",
                "gift_inheritance",
                "other",
                "yes",
                "no",
                "are_you_sure_want_to_approve_the_request",
                "once_performed_can_not_revert",
                "no_cancle",
                "yes_approve_it",
                "are_you_sure_want_to_reject_the_request",
                "yes_reject_it",
                "provide_reason_to_reject",
                "enter_reason",
                "reason_required",
                "can_not_reject_without_reason",
                "cancelled",
                "view_player_details",
                "address",
                "city",
                "zip_code",
                "country",
            ];

            let pendingRequests = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
           
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PendingRequests: 'active',
                halls: halls,
                agents: agents,
                PlayersManagement: 'active',
                Player: dataPlayer,
                DOB: dob,
                forwarded: forwarded,
                penddingRequest: pendingRequests,
                navigation: pendingRequests,
                pepdateofBirth: moment(dataPlayer?.pepDetails?.dateOfBirth).format("YYYY-MM-DD"),
                acceptFlag: acceptFlag,
                rejectFlag: rejectFlag,
                editFlag: editFlag,
            };
            return res.render('player/PendingRequests/viewPendingPlayer', data);
        } catch (e) {
            console.log("Error in View Pending Request", e);
        }
    },

    approvePendingRequest: async function (req, res) {
        try {
            console.log("approvePendingRequest", req.body);
            let language = req.session.details.language ??  "norwegian";
            let keys = [
                "player_already_approved_or_rejected",
                "pep_fields_are_required",
                "player_not_found",
                "player_has_been_successfully_approved",
                "approved",
                "failed",
                "request_approved_sms_desc"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, language);
            let query = {
                _id: req.body.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query);
            console.log("playerFound", dataPlayer);
            if (dataPlayer) {
                if (dataPlayer.hall.status !== "Pending") {
                    return res.send({
                        action: translate.failed || "Failed",
                        status: "error",
                        message: translate.player_already_approved_or_rejected || "Player is already approved or rejected"
                    })
                }
                let agent = {};
                if (req.session.details.role == 'agent') {
                    agent.id = req.session.details.id.toString();
                    agent.name = req.session.details.name;
                } else {
                    agent = req.body.agent;
                }

                // check for PEP details and validation
                const {
                    residentialAddressInNorway,
                    pepName,
                    pepRelationship,
                    pepDateOfBirth,
                    salary,
                    propertySaleOrLease,
                    stocks,
                    socialSupport,
                    giftsOrInheritance,
                    other,
                } = req.body;

                if (req.body.PEP == "yes") {
                    // Validate PEP details
                    if (
                        residentialAddressInNorway === undefined ||
                        !pepName ||
                        !pepRelationship ||
                        !pepDateOfBirth ||
                        !(
                            (salary === 'true') ||
                            (propertySaleOrLease === 'true') ||
                            (stocks === 'true') ||
                            (socialSupport === 'true') ||
                            (giftsOrInheritance === 'true') ||
                            (other === 'true')
                        )
                    ) {
                        return res.send({
                            action: translate.failed || "Failed",
                            status: "error",
                            message: translate.pep_fields_are_required
                        });
                    }
                }

                let query = {
                    '$set': {
                        'hall.status': "Approved",
                        // 'hall.actionBy': {
                        //     "id": req.session.details.id,
                        //     "name": req.session.details.name,
                        //     "role": req.session.details.role
                        // },
                        // 'hall.agent': agent,
                        // 'hall.name': req.body.hallName,
                        // 'hall.id': req.body.hallId,
                        'approvedHalls.0.status': "Approved",
                        hallApprovedBy: {
                            "id": req.session.details.id,
                            "name": req.session.details.name,
                            "role": req.session.details.role
                        },
                        playerAgent: agent
                    }
                }
                if (req.body.HR) {
                    query['$set']['HR'] = req.body.HR.toLowerCase()
                }
                if (req.body.PEP) {
                    query['$set']['PEP'] = req.body.PEP.toLowerCase()
                }
                if (req.body.PEP == "yes") {
                    query['$set']['pepDetails'] = {
                        residentialAddressInNorway,
                        name: pepName,
                        relationship: pepRelationship,
                        dateOfBirth: new Date(pepDateOfBirth),
                        incomeSources: {
                            salary: salary === 'true', // Convert 'true' to true, 'false' to false
                            propertySaleOrLease: propertySaleOrLease === 'true',
                            stocks: stocks === 'true',
                            socialSupport: socialSupport === 'true',
                            giftsOrInheritance: giftsOrInheritance === 'true',
                            other: other === 'true'
                        },
                    }

                }
                await Sys.App.Services.PlayerServices.update(dataPlayer._id, query);
            } else {
                return res.send({
                    action: translate.failed || "Failed",
                    status: "error",
                    message: translate.player_not_found || "Player Not Found!"
                });
            }

            const playerLanguage = dataPlayer.selectedLanguage ? (dataPlayer.selectedLanguage === 'en' ? 'english' : 'norwegian') : language;
            
            if( dataPlayer.phone && !dataPlayer.email){
                const smsMessage = `Spillorama Bingo : ${translate?.request_approved_sms_desc}`;
                Sys.App.Controllers.advertisementController.sendBulkSMS([dataPlayer.phone], smsMessage, playerLanguage);
            }else{
                const templatePath = path.join(__dirname, '../Views/templateHtml/player_notification.html');
                const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));
                const emailTitle = await Sys.Helper.bingo.getSingleTraslateData(["request_approved_email_title"], playerLanguage) + ` - ${dataPlayer.hall.name}`;
                const html = template({
                    title: emailTitle,
                    username: dataPlayer.username || dataPlayer.email,
                    message: await Sys.Helper.bingo.getSingleTraslateData(["request_approved_email_desc"], playerLanguage),
                    thank_you: await Sys.Helper.bingo.getSingleTraslateData(["thank_you"], playerLanguage),
                });
                
                const info = {
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    to: dataPlayer.email,
                    subject: emailTitle,
                    html
                };
                
                module.exports.sendReminderEmail(info).catch(err => {
                    console.error('Failed to send pending player approve request email:', err);
                });
            }
            
            return res.send({
                action: translate.approved || "Approved!",
                status: "success",
                message: translate.player_has_been_successfully_approved || "Player has been successfully approved"
            });
        } catch (error) {
            console.log("Error in approvePendingRequest :", error);
            return res.send({
                action: "Failed",
                status: "error",
                message: "Server Error :("
            });
        }
    },

    rejectPendingRequest: async function (req, res) {
        try {
            console.log("rejectPendingRequest", req.body);
            let language = req.session.details.language ??  "norwegian";
            let keys = [
                "player_already_approved_or_rejected",
                "pep_fields_are_required",
                "player_not_found",
                "player_has_been_successfully_approved",
                "approved",
                "failed",
                "rejected",
                "player_has_been_successfully_rejected",
                "request_rejected_sms_desc"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, language);
            let query = {
                _id: req.body.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query);
            console.log("playerFound", dataPlayer);
            if (dataPlayer) {
                if (dataPlayer.hall.status !== "Pending") {
                    return res.send({
                        action: translate.failed || "Failed",
                        status: "error",
                        message: translate.player_already_approved_or_rejected || "Player is already approved or rejected"
                    });
                }
                let agent = {};
                if (req.session.details.role == 'agent') {
                    agent.id = req.session.details.id.toString();
                    agent.name = req.session.details.name;
                } else {
                    agent = req.body.agent;
                }

                // check for PEP details and validation
                const {
                    residentialAddressInNorway,
                    pepName,
                    pepRelationship,
                    pepDateOfBirth,
                    salary,
                    propertySaleOrLease,
                    stocks,
                    socialSupport,
                    giftsOrInheritance,
                    other,
                } = req.body;

                if (req.body.PEP == "yes") {
                    // Validate PEP details
                    if (
                        residentialAddressInNorway === undefined ||
                        !pepName ||
                        !pepRelationship ||
                        !pepDateOfBirth ||
                        !(
                            (salary === 'true') ||
                            (propertySaleOrLease === 'true') ||
                            (stocks === 'true') ||
                            (socialSupport === 'true') ||
                            (giftsOrInheritance === 'true') ||
                            (other === 'true')
                        )
                    ) {
                        return res.send({
                            action: translate.failed || "Failed",
                            status: "error",
                            message: translate.pep_fields_are_required
                        });
                    }
                }

                let query = {
                    '$set': {
                        'hall.status': 'Rejected',
                        'hall.actionBy': {
                            "id": req.session.details.id,
                            "name": req.session.details.name,
                            "role": req.session.details.role
                        },
                        'hall.agent': agent,
                        'hall.reason': req.body.reason,
                    }
                }
                if (req.body.HR) {
                    query['$set']['HR'] = req.body.HR.toLowerCase()
                }
                if (req.body.PEP) {
                    query['$set']['PEP'] = req.body.PEP.toLowerCase()
                }
                if (req.body.PEP == "yes") {
                    query['$set']['pepDetails'] = {
                        residentialAddressInNorway,
                        name: pepName,
                        relationship: pepRelationship,
                        dateOfBirth: new Date(pepDateOfBirth),
                        incomeSources: {
                            salary: salary === 'true', // Convert 'true' to true, 'false' to false
                            propertySaleOrLease: propertySaleOrLease === 'true',
                            stocks: stocks === 'true',
                            socialSupport: socialSupport === 'true',
                            giftsOrInheritance: giftsOrInheritance === 'true',
                            other: other === 'true'
                        },
                    }

                }
                await Sys.App.Services.PlayerServices.update(dataPlayer._id, query);
            } else {
                return res.send({
                    action: translate.failed || "Failed",
                    status: "error",
                    message: translate.player_not_found || "Player Not Found!"
                })
            }

            const playerLanguage = dataPlayer.selectedLanguage ? (dataPlayer.selectedLanguage === 'en' ? 'english' : 'norwegian') : language;
            
            if( dataPlayer.phone && !dataPlayer.email){
                const smsMessage = `Spillorama Bingo : ${translate?.request_rejected_sms_desc}`;
                Sys.App.Controllers.advertisementController.sendBulkSMS([dataPlayer.phone], smsMessage, playerLanguage);
            }else{
                const templatePath = path.join(__dirname, '../Views/templateHtml/player_notification.html');
                const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));
                const emailTitle = await Sys.Helper.bingo.getSingleTraslateData(["request_rejected_email_title"], playerLanguage) + ` - ${dataPlayer.hall.name}`;
                const html = template({
                    title: emailTitle,
                    username: dataPlayer.username || dataPlayer.email,
                    message: await Sys.Helper.bingo.getSingleTraslateData(["request_rejected_email_desc"], playerLanguage),
                    thank_you: await Sys.Helper.bingo.getSingleTraslateData(["thank_you"], playerLanguage),
                });
                
                const info = {
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    to: dataPlayer.email,
                    subject: emailTitle,
                    html
                };
                
                module.exports.sendReminderEmail(info).catch(err => {
                    console.error('Failed to send pending player reject request email:', err);
                });
            }

            return res.send({
                action: translate.rejected || "Rejected!",
                status: "success",
                message: translate.player_has_been_successfully_rejected || "Player Rejected Successfully!"
            });
        } catch (error) {
            console.log("Error in approvePendingRequest :", error);
            return res.send({
                action: "Failed",
                status: "error",
                message: "Server Error :("
            });
        }
    },

    forwardToAdmin: async function (req, res) {
        try {
            console.log("forwardRequest", req.body, req.files);
            let language = req.session.details.language ??  "norwegian";
            let keys = [
                "player_already_approved_or_rejected",
                "pep_fields_are_required",
                "player_not_found",
                "approved",
                "failed",
                "forwarded",
                "request_forwarded_to_admin"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, language);
            let query = {
                _id: req.body.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query);
            if (dataPlayer) {
                if (dataPlayer.hall.status !== "Pending") {
                    return res.send({
                        action: translate.failed || "Failed",
                        status: "error",
                        message: translate.player_already_approved_or_rejected || "Player is already approved or rejected!"
                    });
                }

                // check for PEP details and validation
                const {
                    residentialAddressInNorway,
                    pepName,
                    pepRelationship,
                    pepDateOfBirth,
                    salary,
                    propertySaleOrLease,
                    stocks,
                    socialSupport,
                    giftsOrInheritance,
                    other,
                } = req.body;

                if (req.body.PEP == "yes") {
                    // Validate PEP details
                    if (
                        residentialAddressInNorway === undefined ||
                        !pepName ||
                        !pepRelationship ||
                        !pepDateOfBirth ||
                        (!salary &&
                            !propertySaleOrLease &&
                            !stocks &&
                            !socialSupport &&
                            !giftsOrInheritance &&
                            !other)
                    ) {
                        req.flash('error', translate.pep_fields_are_required);
                        return res.send({
                            action: translate.failed || "Failed",
                            status: "error",
                            message: translate.pep_fields_are_required
                        });
                    }
                }

                let photoIds = [];
                if (req.files?.photoId) {
                    let photos = req.files.photoId
                    let dataPath = path.join(__dirname, '../../public/assets/profilePic/');
                    if (Array.isArray(photos)) {
                        for (let i = 0; i < photos.length; i++) {
                            let re = /(?:\.([^.]+))?$/;
                            let ext = re.exec(photos[i].name)[1];
                            let fileName = Date.now() + Math.floor(Math.random() * 15) + '.' + ext;

                            photos[i].mv(dataPath + fileName, async function (err) {
                                if (err) {
                                    console.log(err);
                                    return res.send({
                                        action: "Failed",
                                        status: "error",
                                        message: "Document Upload Failed!"
                                    });
                                }
                            });
                            photoIds.push(`/assets/profilePic/${fileName}`)
                        }
                    } else {
                        console.log("here 3");
                        let re = /(?:\.([^.]+))?$/;
                        let ext = re.exec(photos.name)[1];
                        let fileName = Date.now() + Math.floor(Math.random() * 15) + '.' + ext;
                        photos.mv(dataPath + fileName, async function (err) {
                            if (err) {
                                console.log(err);
                                return res.send({
                                    action: "Failed",
                                    status: "error",
                                    message: "Document Upload Failed!"
                                });
                            }
                        });
                        photoIds.push(`/assets/profilePic/${fileName}`)
                    }
                } else {
                    return res.send({
                        action: "Failed",
                        status: "error",
                        message: "You need to Attach Photo Id!"
                    })
                }

                let query = {
                    '$set': {
                        'hall.actionBy': {
                            "id": req.session.details.id,
                            "name": req.session.details.name,
                            "role": req.session.details.role
                        },
                        'hall.agent': {
                            "id": req.session.details.id.toString(),
                            "name": req.session.details.name
                        },
                        'hall.name': req.body.hallName,
                        'hall.id': req.body.hallId,
                        'PEP': (req.body.PEP && req.body.PEP == "yes") ? req.body.PEP : "no",
                        'HR': (req.body.HR && req.body.HR == "yes") ? req.body.HR : "no",
                        'pepDetails': (req.body.PEP == "yes")
                            ? {
                                residentialAddressInNorway,
                                name: pepName,
                                relationship: pepRelationship,
                                dateOfBirth: new Date(pepDateOfBirth),
                                incomeSources: {
                                    salary: salary === 'true', // Convert 'true' string to true, 'false' string to false
                                    propertySaleOrLease: propertySaleOrLease === 'true',
                                    stocks: stocks === 'true',
                                    socialSupport: socialSupport === 'true',
                                    giftsOrInheritance: giftsOrInheritance === 'true',
                                    other: other === 'true',
                                },
                            }
                            : undefined
                    }
                }
                if (photoIds.length) {
                    query['$set'].photoId = photoIds;
                }
                console.log("forward query--", {
                    salary: !!salary,
                    propertySaleOrLease: !!propertySaleOrLease,
                    stocks: !!stocks,
                    socialSupport: !!socialSupport,
                    giftsOrInheritance: !!giftsOrInheritance,
                    other: !!other,
                })
                await Sys.App.Services.PlayerServices.update(dataPlayer._id, query);
            } else {
                return res.send({
                    action: translate.failed || "Failed",
                    status: "error",
                    message: translate.player_not_found || "Player Not Found!"
                })
            }

            req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["request_forwarded_to_admin"], req.session.details.language));
            // return res.redirect('/pendingRequests');
            return res.send({
                action: translate.forwarded || "Forwarded!",
                status: "success",
                message: "Player Forwarded Successfully!"
            });
        } catch (error) {
            console.log("Error in forwardRequests :", error);
            return res.send({
                action: "Failed",
                status: "error",
                message: "Server Error :("
            });
        }
    },
    //End Pending Player

    //Start Rejected Player
    rejectedRequests: async function (req, res) {
        try {

            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            // let statusFlag = true;
            let halls = [];

            //console.log("session detail of req sender", req.session.details);
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Players Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                halls = req.session.details.hall;
            } else {
                halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "status": "active" }, { name: 1 });
            }
            console.log("halls for filter dropdown", halls);

            const keysArray = [
                "search_by_filter",
                "from_date",
                "to_date",
                "reset",
                "customer_number",
                "emailId",
                "username",
                "phone_number",
                "status",
                "hall_name",
                "action",
                "request_by",
                "reject_date_time",
                "reject_request",
                "rejection_reason",
                "reject_by",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_player",
                "delete_button",
                "cancel_button",
                "player_delete_successfully",
                "player_not_deleted",
                "success",
                "cancelled",
                "approve_player",
                "delete_player",
                "view_player",
                "yes_approve_it",
            ];

            let rejectRequest = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                RejectedRequests: 'active',
                // PlayerMenu: 'active menu-open',
                PlayersManagement: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                // statusFlag: statusFlag,
                halls: halls,
                rejectRequest: rejectRequest,
                navigation: rejectRequest
            };
            return res.render('player/RejectedRequests/rejected', data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getRejectedPlayer: async function (req, res) {
        try {
            let order = req.query.order;
            let params = req.query.params;
            //console.log("request query", req.query);
            //console.log("request body", req.body);
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
            let query = { userType: { $ne: "Unique" }, "hall.status": { $eq: "Rejected" } }; //userType:"Online"  // username: { $regex: '.*' + search + '.*' },

            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search)) ? null : Number(search) },
                    { username: { $regex: '.*' + search + '.*' } }
                ]
            }

            if (params.fromDate !== '' || params.toDate !== '') {
                query.updatedAt = {};
                if (params.fromDate !== '') {
                    query.updatedAt.$gte = params.fromDate;
                }
                if (params.toDate !== '') {
                    query.updatedAt.$lte = params.toDate;
                }
            }
            if (params.hallId !== '') {
                //query['hall.id'] = { $eq: params.hallId };
                query['approvedHalls'] = { $elemMatch: { 'id': params.hallId } };
            } else if (req.session.details.role == 'agent') {
                //query['hall.id'] = { $eq: req.session.details.hall[0].id };
                query['approvedHalls'] = { $elemMatch: { 'id': req.session.details.hall[0].id } };
            }
            console.log("final query", JSON.stringify(query));
            let playersCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
            console.log("rejected players count", playersCount);
            let data = await Sys.App.Services.PlayerServices.getPlayerDatatableNew(query, length, start, sort);
            //console.log("final data", data);
            var obj = {
                'draw': req.query.draw,
                'recordsTotal': playersCount,
                'recordsFiltered': playersCount,
                'data': data
            };
            return res.send(obj);
        } catch (e) {
            console.log("Error in getrejected player", e);
            return res.send({
                'status': 500,
                'message': 'Server Side Error, Try Again after Sometime.',
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },
    viewRejectedPlayerDetails: async function (req, res) {
        try {

            let query = {
                _id: req.params.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query);

            let dt = new Date(dataPlayer.dob);
            let date = dt.getDate();
            let month = parseInt(dt.getMonth() + 1);
            let year = dt.getFullYear();
            let hours = dt.getHours();
            let minutes = dt.getMinutes();
            let ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12;
            hours = hours ? hours : 12;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            let dob = year + '/' + month + '/' + date; // + ' ' + hours + ':' + minutes + ' ' + ampm;

            // var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            // var gameData = [];
            // var dataGame = {};
            // for (var i = 0; i < gameType.length; i++) {
            //     dataGame = {
            //         _id: gameType[i]._id,
            //         name: gameType[i].name,
            //     }
            //     gameData.push(dataGame);
            // }

            let countAp = 0;
            let countDp = 0;
            // for (var j = 0; j < dataPlayer.hall.length; j++) {
            //     if (dataPlayer.hall[j].status == "Approved") {
            //         countAp++;
            //     } else if (dataPlayer.hall[j].status == "Disapproved") {
            //         countDp++;
            //     }
            // }

            const keysArray = [
                "search_by_filter",
                "from_date",
                "to_date",
                "reset",
                "customer_number",
                "emailId",
                "username",
                "phone_number",
                "status",
                "hall_name",
                "action",
                "request_by",
                "reject_date_time",
                "reject_request",
                "rejection_reason",
                "reject_by",
                "photo_id", "hall", "cancel",
                "is_the_player_pep",
                "is_the_player_high_risk",
                "hall",
                "bank_ac_no",
                "date_of_birth",
                "firstname",
                "do_you_have_address_in_norway",
                "name_of_pep",
                "relation_with_pep",
                "type_of_income_used_to_play",
                "salary",
                "sale_lease_property",
                "stocks",
                "social_security_pension_support_scheme",
                "gift_inheritance",
                "other",
                "yes",
                "no",
                "do_you_have_address_in_norway",
                "type_of_income_used_to_play",
                "salary",
                "sale_lease_property",
                "stocks",
                "social_security_pension_support_scheme",
                "gift_inheritance",
                "other",
                "address",
                "city",
                "zip_code",
                "country",
            ];

            let rejectRequest = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                RejectedRequests: 'active',
                PlayersManagement: 'active',
                Player: dataPlayer,
                assginAccess: (countAp > countDp) ? "Approved" : "Disapproved",
                DOB: dob,
                DataOfGames: dataPlayer,
                rejectRequest: rejectRequest,
                navigation: rejectRequest
            };
            return res.render('player/RejectedRequests/viewRejectedPlayer', data);
        } catch (e) {
            console.log("Error in viewRejected request", e);
        }
    },
    deleteRejected: async function (req, res) {
        try {
            let player = await Sys.App.Services.PlayerServices.getPlayerData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.PlayerServices.deletePlayer(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error in delete rejected player", e);
            return res.send("error");
        }
    },

    //Approve Rejected player by admin
    approveRejected: async function (req, res) {
        const language = req.session.details.language ?? "norwegian";
        try {
            const { role, id: sessionId, name: sessionName } = req.session.details;
            const playerId = req.body.id;
            // Role-based access restriction, only admin is allowed to approve rejetced player
            if (role === 'agent') {
                return res.status(400).json({
                    status: "fail",
                    action: await Sys.Helper.bingo.getSingleTraslateData(["failed"], language),
                    message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_perform_this_operation"], language),
                });
            }
    
            // Fetch player
            const dataPlayer = await Sys.Game.Game2.Services.PlayerServices.getOneByData(
                { _id: playerId },
                { status: 1, email: 1, username: 1, selectedLanguage: 1, hall: 1, phone: 1 }
            );
    
            if (!dataPlayer) {
                return res.status(400).json({
                    status: "fail",
                    action: await Sys.Helper.bingo.getSingleTraslateData(["failed"], language),
                    message: await Sys.Helper.bingo.getSingleTraslateData(["player_not_found"], language)
                });
            }
    
            // Prepare update
            const updateData = {
                $set: {
                    'hall.status': "Approved",
                    'approvedHalls.0.status': "Approved",
                    hallApprovedBy: { id: sessionId, name: sessionName, role },
                    playerAgent: { id: sessionId, name: sessionName }
                }
            };
    
            // Perform update
            await Sys.App.Services.PlayerServices.update(playerId, updateData);
           
            // Fire off mail in background
            const playerLanguage = dataPlayer.selectedLanguage ? (dataPlayer.selectedLanguage === 'en' ? 'english' : 'norwegian') : language;
            
            if( dataPlayer.phone && !dataPlayer.email ){
                const smsMessage = `Spillorama Bingo : ${await Sys.Helper.bingo.getSingleTraslateData(["request_approved_sms_desc"], playerLanguage)}`;
                Sys.App.Controllers.advertisementController.sendBulkSMS([dataPlayer.phone], smsMessage, playerLanguage);
            }else{
                const templatePath = path.join(__dirname, '../Views/templateHtml/player_notification.html');
                const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));
                const emailTitle = await Sys.Helper.bingo.getSingleTraslateData(["request_approved_email_title"], playerLanguage) + ` - ${dataPlayer.hall.name}`;
                const html = template({
                    title: emailTitle,
                    username: dataPlayer.username || dataPlayer.email,
                    message: await Sys.Helper.bingo.getSingleTraslateData(["request_approved_email_desc"], playerLanguage),
                    thank_you: await Sys.Helper.bingo.getSingleTraslateData(["thank_you"], playerLanguage),
                });
                
                const info = {
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    to: dataPlayer.email,
                    subject: emailTitle,
                    html
                };
                
                module.exports.sendReminderEmail(info).catch(err => {
                    console.error('Failed to send pending player approve reject request email:', err);
                });
            }
            
            // Final response
            return res.json({
                action: await Sys.Helper.bingo.getSingleTraslateData(["approved"], language) || "Approved!",
                status: "success",
                message: await Sys.Helper.bingo.getSingleTraslateData(["player_has_been_successfully_approved"], language) || "Player has been successfully approved"
            });
    
        } catch (e) {
            console.error("Error in approveRejected:", e);
            //return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            return res.status(500).json({
                status: "fail",
                action: "Failed",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
            });
        }
    },
    
    //End Rejected Player

    // import player
    // importPlayersAgent: async function(req, res){
    //     let loggedInUserId = req.session.id;
    //     try{console.log("import player called", req.body, req.files)
    //         if(!req.session.details.hall[0].id){
    //             res.status(400).json({ errors: ["valid hall not found"]});
    //         }
    //         if (!req.files || !req.files.file) {
    //             return res.status(400).send('No file uploaded');
    //         }

    //         let playersData;
    //         const file = req.files.file;
    //         const buffer = file.data;

    //         if (file.name.endsWith('.csv')) {
    //             const workbook = xlsx.read(buffer, { type: 'buffer' });
    //             const firstSheetName = workbook.SheetNames[0];
    //             const worksheet = workbook.Sheets[firstSheetName];
    //             playersData = xlsx.utils.sheet_to_json(worksheet);
    //         } else {
    //             const workbook = xlsx.read(buffer, { type: 'buffer' });
    //             const firstSheetName = workbook.SheetNames[0];
    //             const worksheet = workbook.Sheets[firstSheetName];
    //             playersData = xlsx.utils.sheet_to_json(worksheet);
    //         }

    //         let errorMessages = [];
    //         let playersToImport = [];

    //         for (const player of playersData) {
    //             let { Firstname, Lastname, Username, DOB, Email, phone, Password, Wallet, Photo, BankId } = player;

    //             // Username adn password should be present
    //             if (!Username) {
    //                 errorMessages.push(`Username is Required: Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             if (!isValidUsername(Username)) {
    //                 errorMessages.push(`Invalid username format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             // Firstname and lastname
    //             if(Firstname && !startsWithAlpha(Firstname)){
    //                 errorMessages.push(`Invalid Firstname format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             if(Lastname && !startsWithAlpha(Lastname)){
    //                 errorMessages.push(`Invalid Lastname format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             if (!Password) {
    //                 errorMessages.push(`Password is Required: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             // Validate email format
    //             if (Email && !isValidEmail(Email)) {
    //                 errorMessages.push(`Invalid email format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             // Validate phone number format (minimum 8 digits)
    //             if (phone && !isValidPhoneNumber(phone)) {
    //                 errorMessages.push(`Invalid phone number format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, phone: ${phone}`);
    //                 continue;
    //             }

    //             if (!Email && !phone) {
    //                 errorMessages.push(`This Player is missing both email and phone: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname},`);
    //                 continue;
    //             }

    //             // Parse date if DOB is a number
    //             if (typeof DOB === 'number') {
    //                 DOB = parseExcelDate(DOB);
    //             } else if (DOB && isNaN(Date.parse(DOB))) {
    //                 errorMessages.push(`Invalid date format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }
    //             if (DOB && !isValidDOB(DOB)) {
    //                 errorMessages.push(`Invalid date format for player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}`);
    //                 continue;
    //             }

    //             if(BankId && !isAlphanumeric(BankId)){
    //                 errorMessages.push(`Invalid Bank Id: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}, BankId: ${BankId}`);
    //                 continue;
    //             }

    //             const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: [{ email: Email}, { phone: phone }, {username: Username}] }, {username: 1});
    //             //console.log("existingPlayer---", existingPlayer)
    //             if (existingPlayer) {
    //                 errorMessages.push(`Duplicate Player Found: Username=${Username},  Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}, phone: ${phone}`);
    //                 continue;
    //             }


    //             playersToImport.push({
    //                 Username: Username.toLowerCase(),
    //                 Email: Email,
    //                 phone: phone,
    //                 Firstname: Firstname?.toLowerCase(),
    //                 DOB: moment(DOB),
    //                 Wallet: +Wallet,
    //                 BankId: BankId,
    //                 Photo: Photo,
    //                 Password: bcrypt.hashSync(Password.toString(), 10),
    //                 Lastname: Lastname?.toLowerCase(),
    //             });
    //         }

    //         if (errorMessages.length > 0) {
    //            // fs.unlinkSync(req.files.path); // Clean up uploaded file
    //             return res.status(400).json({ errors: errorMessages });
    //         }

    //         const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
    //         fs.writeFileSync(filePath, JSON.stringify(playersToImport));

    //         res.status(200).json({
    //             playersCount: playersToImport.length,
    //             message: `${playersToImport.length} players ready to be imported. Confirm?`,
    //             filePath: `import_player_${loggedInUserId}` // Send back the file path for confirmation
    //         });

    //     }catch(e){
    //         console.log("Error while imporing players", e)
    //         res.status(400).json({ errors: ["Something went wrong"]});
    //     }
    // },

    // confirmImportPlayersAgent: async function(req, res){
    //     try{
    //         let loggedInUserId = req.session.id;
    //         if(!req.session.details.hall[0].id){
    //             res.status(400).json({ errors: ["valid hall not found"]});
    //         }
    //         console.log("confirm import player called", req.body);
    //         const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
    //         if(req.body.isConfirm == 'Yes'){
    //             console.log("import player to database");

    //             if (!fs.existsSync(filePath)) {
    //                 return res.status(400).json({status: "fail", message: "No file found. Please re-import the players."} );
    //             }


    //             let hall = {
    //                 id: req.session.details.hall[0].id.toString(),
    //                 name: req.session.details.hall[0].name,
    //                 status: 'Approved',
    //                 actionBy: {
    //                     id: req.session.details.id.toString(),
    //                     name: req.session.details.name,
    //                     role: "agent"
    //                 },
    //                 agent: {
    //                     id: req.session.details.id.toString(),
    //                     name: req.session.details.name,
    //                 }
    //             }

    //             const playersToImport = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    //             let errorMessages = [];
    //             let importedPlayerCount = 0;
    //             for (const player of playersToImport) {
    //                 const { Firstname, Lastname, Username,  DOB, Email, phone, Password, Wallet, Photo, BankId } = player;

    //                 let query = { $or: [] };
    //                 if (Email) {
    //                     query.$or.push({ email: Email });
    //                 }
    //                 if (phone) {
    //                     query.$or.push({ phone: phone });
    //                 }
    //                 query.$or.push({ username: Username });
    //                 const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1 });
    //                 console.log("existingPlayer---", existingPlayer);


    //                 //const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: [{ email: Email}, { phone: phone }, {username: Username}] }, {username: 1});
    //                 if (existingPlayer) {
    //                     errorMessages.push(`Duplicate Player Not Imported: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}, phone: ${phone}`);
    //                     continue;
    //                 }

    //                 const customer = await Sys.Game.Common.Controllers.PlayerController.generateUniqueCustomerNumber();
    //                 console.log("Generated customerNumber", customer)
    //                 let customerNumber;
    //                 if(customer.status== "success" && customer.newCustomerNumber){
    //                     customerNumber = customer.newCustomerNumber
    //                 }else{
    //                     errorMessages.push(`Error Importing Player: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname}, Email: ${Email}, phone: ${phone}`);
    //                     continue;
    //                 }

    //                 let uploadPhoto = "";
    //                 if(Photo && isValidUrl(Photo)){
    //                     let filename = path.basename(new URL(Photo).pathname)
    //                     let extention = path.extname(filename);
    //                     let randomNum = Math.floor(100000 + Math.random() * 900000);
    //                     uploadPhoto = await downloadImage(Photo, `${Date.now()}_${randomNum}${extention}`);
    //                     console.log("uploadPhoto---", uploadPhoto, `${Date.now()}_${randomNum}${extention}`)
    //                 }else{
    //                     console.log("valid image url not found", Photo)
    //                 }
    //                 let playerObj = {
    //                     username: Username,
    //                     email: Email,
    //                     phone: phone,
    //                     nickname: Firstname,
    //                     dob: DOB,
    //                     walletAmount: Wallet,
    //                     points: 0,
    //                     bankId: BankId,
    //                     hall: hall,
    //                     profilePic: uploadPhoto,
    //                     password: Password,
    //                     socketId: '1234',
    //                     platform_os: "other",
    //                     HR: "yes",
    //                     PEP: "no",
    //                     surname: Lastname,
    //                     customerNumber: customerNumber
    //                 };
    //                 await Sys.Game.Common.Services.PlayerServices.create(playerObj);
    //                 importedPlayerCount += 1;

    //             }
    //             fs.unlinkSync(filePath);

    //             res.status(200).json({ status: "success", message: "Players have been imported Successfully.", errors: errorMessages});


    //         }else {
    //             console.log("unlink file");
    //             fs.unlinkSync(filePath); // Clean up uploaded file
    //             res.status(200).json({ status: "success", message: "file has been unliked successfully"});
    //         }
    //     }catch(e){
    //         console.log("Error while imporing players", e)
    //         res.status(400).json({status: "fail", message: "Something went wrong"});
    //     }
    // },

    // importPlayers: async function(req, res){
    //     let loggedInUserId = req.session.id;
    //     try{console.log("import player called", req.body, req.files)

    //         if (!req.files || !req.files.file) {
    //             return res.status(400).send('No file uploaded');
    //         }

    //         let playersData;
    //         const file = req.files.file;
    //         const buffer = file.data;

    //         if (file.name.endsWith('.csv')) {
    //             const workbook = xlsx.read(buffer, { type: 'buffer' });
    //             const firstSheetName = workbook.SheetNames[0];
    //             const worksheet = workbook.Sheets[firstSheetName];
    //             playersData = xlsx.utils.sheet_to_json(worksheet);
    //         } else {
    //             const workbook = xlsx.read(buffer, { type: 'buffer' });
    //             const firstSheetName = workbook.SheetNames[0];
    //             const worksheet = workbook.Sheets[firstSheetName];
    //             playersData = xlsx.utils.sheet_to_json(worksheet);
    //         }

    //         let errorMessages = [];
    //         let playersToImport = [];

    //         const seen = {
    //             customerNumber: new Set(),
    //             phone: new Set(),
    //             email: new Set(),
    //             username: new Set(),
    //         };

    //         const duplicates = {
    //             customerNumber: new Set(),
    //             phone: new Set(),
    //             email: new Set(),
    //             username: new Set(),
    //         };

    //         for (const player of playersData) {
    //             const customerNumber = player['Customer Number'];
    //             const FullName = player['Full Name']; 
    //             const Username = player.Username;
    //             const phone = player['Mobile Number'];
    //             const Email = player.Email;
    //             const HallNumber = player['Hall Number'];
    //             console.log("customerNumber, FullName, Username, phone, Email, HallNumber", customerNumber, FullName, Username, phone, Email, HallNumber)
    //            // let { Customer Number as customerNumber,  Firstname, Lastname, Username, DOB, Email, phone, Password, Wallet, Photo, BankId } = player;

    //             // Username should be present
    //             if (!Username) {
    //                 errorMessages.push(`Username is Required: Customer Number=${customerNumber}, FullName: ${FullName}, Email: ${Email}, phone: ${phone}`);
    //                 continue;
    //             }

    //             if (!customerNumber) {
    //                 errorMessages.push(`Customer Number is Required: Username=${Username}, FullName: ${FullName}, Email: ${Email}, phone: ${phone}`);
    //                 continue;
    //             }

    //             const {Firstname, Lastname} = splitName(FullName);

    //             // Validate email format
    //             if (Email && !isValidEmail(Email)) {
    //                 errorMessages.push(`Invalid email format for player: Customer Number=${customerNumber}, Username=${Username}, Full Name: ${FullName}, Email: ${Email}, phone: ${phone}`);
    //                 continue;
    //             }

    //             // Validate phone number format (minimum 8 digits)
    //             if (phone && !isValidPhoneNumber(phone)) {
    //                 errorMessages.push(`Invalid phone number format for player: Customer Number=${customerNumber}, Username=${Username}, Full Name: ${FullName}, Email: ${Email}, phone: ${phone}`);
    //                 continue;
    //             }

    //             // According to new requirement we also need to insert player without email and phone
    //             // if (!Email && !phone) {
    //             //     errorMessages.push(`This Player is missing both email and phone: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname},`);
    //             //     continue;
    //             // }

    //             const conditions = [
    //                 Email && { email: Email },
    //                 phone && { phone: phone },
    //                 Username && { username: Username },
    //                 customerNumber && { customerNumber: customerNumber }
    //             ].filter(Boolean); 

    //             if (conditions.length > 0) {
    //                 const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: conditions }, {username: 1});
    //                 //console.log("existingPlayer---", existingPlayer)
    //                 if (existingPlayer) {
    //                     errorMessages.push(`Duplicate Player Found: Customer Number=${customerNumber}, Username=${Username}, Full Name: ${FullName}, Email: ${Email}, phone: ${phone}`);
    //                     continue;
    //                 }
    //             } 

    //             // Check and track Customer Number
    //             if (customerNumber && seen.customerNumber.has(customerNumber)) {
    //                 duplicates.customerNumber.add(customerNumber);
    //             } else if (customerNumber) {
    //                 seen.customerNumber.add(customerNumber);
    //             }

    //             // Check and track Mobile Number
    //             if (phone && seen.phone.has(phone)) {
    //                 duplicates.phone.add(phone);
    //             } else if (phone) {
    //                 seen.phone.add(phone);
    //             }

    //             // Check and track Email
    //             if (Email && seen.email.has(Email)) {
    //                 duplicates.email.add(Email);
    //             } else if (Email) {
    //                 seen.email.add(Email);
    //             }

    //             // Check and track Username
    //             if (Username && seen.username.has(Username)) {
    //                 duplicates.username.add(Username);
    //             } else if (Username) {
    //                 seen.username.add(Username);
    //             }

    //             let userFinalHallNumber = "";
    //             if(HallNumber){
    //                 userFinalHallNumber = extractDynamicSegment(HallNumber);
    //             }

    //             playersToImport.push({
    //                 Username: Username, // Username.toLowerCase(),
    //                 Email: Email,
    //                 phone: phone,
    //                 Firstname: Firstname, // Firstname?.toLowerCase(),
    //                 //DOB: moment(DOB),
    //                 //Wallet: +Wallet,
    //                 //BankId: BankId,
    //                 //Photo: Photo,
    //                 //Password: bcrypt.hashSync( `${userFinalHallNumber}${customerNumber}${Username}` , 10),
    //                 Lastname: Lastname, // Lastname?.toLowerCase(),
    //                 customerNumber: customerNumber, 
    //                 HallNumber: userFinalHallNumber
    //             });
    //         }

    //         if(duplicates.customerNumber.size > 0 || duplicates.phone.size > 0 || duplicates.email.size > 0 || duplicates.username.size > 0){
    //             let importFileDuplicateError = [];
    //             if(duplicates.customerNumber.size > 0){
    //                 importFileDuplicateError.push(`Duplicate Customer Number Found in imported File: ${Array.from(duplicates.customerNumber)}`);
    //             }
    //             if(duplicates.phone.size > 0){
    //                 importFileDuplicateError.push(`Duplicate Mobile Number Found in imported File: ${Array.from(duplicates.phone)}`);
    //             }
    //             if(duplicates.email.size > 0){
    //                 importFileDuplicateError.push(`Duplicate Email Found in imported File: ${Array.from(duplicates.email)}`);
    //             }
    //             if(duplicates.username.size > 0){
    //                 importFileDuplicateError.push(`Duplicate Username Found in imported File: ${Array.from(duplicates.username)}`);
    //             }
    //             //return res.status(400).json({ errors: importFileDuplicateError });
    //         }

    //         if (errorMessages.length > 0) {
    //             //return res.status(400).json({ errors: errorMessages });
    //         }
    //         console.log("playersToImport---", playersToImport)
    //         const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
    //         fs.writeFileSync(filePath, JSON.stringify(playersToImport));

    //         res.status(200).json({
    //             playersCount: playersToImport.length,
    //             message: `${playersToImport.length} players ready to be imported. Confirm?`,
    //             filePath: `import_player_${loggedInUserId}` // Send back the file path for confirmation
    //         });

    //     }catch(e){
    //         console.log("Error while imporing players", e)
    //         res.status(400).json({ errors: ["Something went wrong"]});
    //     }
    // },

    // Working
    // importPlayers: async function (req, res) {
    //     let loggedInUserId = req.session.id;
    //     try {
    //         console.log("import player called", req.body, req.files)
    //         req.setTimeout(300000);  // 5 minutes
    //         res.setTimeout(300000);
    //         if (!req.files || !req.files.file) {
    //             return res.status(400).send('No file uploaded');
    //         }

    //         let playersData;
    //         const file = req.files.file;
    //         const buffer = file.data;

    //         const workbook = xlsx.read(buffer, { type: 'buffer' });
    //         const firstSheetName = workbook.SheetNames[0];
    //         const worksheet = workbook.Sheets[firstSheetName];
    //         playersData = xlsx.utils.sheet_to_json(worksheet);

    //         let errorMessages = [];
    //         let playersToImport = [];

    //         const seen = {
    //             customerNumber: new Map(),
    //             phone: new Map(),
    //             Email: new Map(),
    //             Username: new Map(),
    //         };

    //         const duplicates = {
    //             customerNumber: new Set(),
    //             phone: new Set(),
    //             Email: new Set(),
    //             Username: new Set(),
    //         };

    //         // Track records by duplicate fields
    //         const recordsByDuplicate = {
    //             customerNumber: new Map(),
    //             phone: new Map(),
    //             Email: new Map(),
    //             Username: new Map(),
    //         };

    //         for (const player of playersData) {
    //             const customerNumber = player['Customer Number'];
    //             const FullName = player['Full Name'];
    //             const Username = player.Username;
    //             const phone = player['Phone Number'];
    //             const Email = player.Email;
    //             const HallNumber = player['Hall Number'];
    //             //console.log("customerNumber, FullName, Username, phone, Email, HallNumber", customerNumber, FullName, Username, phone, Email, HallNumber)
    //             // let { Customer Number as customerNumber,  Firstname, Lastname, Username, DOB, Email, phone, Password, Wallet, Photo, BankId } = player;

    //             // Username should be present
    //             if (!Username) {
    //                 errorMessages.push(`Username is Required: Customer Number: ${customerNumber}, FullName: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
    //                 continue;
    //             }

    //             if (!customerNumber) {
    //                 errorMessages.push(`Customer Number is Required: Username: ${Username}, FullName: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
    //                 continue;
    //             }

    //             const { Firstname, Lastname } = splitName(FullName);

    //             // Validate email format
    //             if (Email && !isValidEmail(Email)) {
    //                 errorMessages.push(`Invalid email format for player: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
    //                 continue;
    //             }

    //             // Validate phone number format (minimum 8 digits)
    //             if (phone && !isValidPhoneNumber(phone)) {
    //                 errorMessages.push(`Invalid phone number format for player: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
    //                 continue;
    //             }

    //             // According to new requirement we also need to insert player without email and phone
    //             // if (!Email && !phone) {
    //             //     errorMessages.push(`This Player is missing both email and phone: Username=${Username}, Firstname: ${Firstname}, Lastname: ${Lastname},`);
    //             //     continue;
    //             // }

    //             const conditions = [
    //                 Email && { email: Email },
    //                 phone && { phone: phone },
    //                 Username && { username: (Username && typeof Username === 'string') ? Username.toLowerCase() : String(Username).toLowerCase() },
    //                 customerNumber && { customerNumber: customerNumber }
    //             ].filter(Boolean);

    //             if (conditions.length > 0) {
    //                 const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: conditions }, { username: 1 });
    //                 //console.log("existingPlayer---", existingPlayer)
    //                 if (existingPlayer) {
    //                     errorMessages.push(`Duplicate Player Found: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
    //                     continue;
    //                 }
    //             }

    //             // Track records for Customer Number
    //             if (customerNumber) {
    //                 if (seen.customerNumber.has(customerNumber)) {
    //                     duplicates.customerNumber.add(customerNumber);
    //                     recordsByDuplicate.customerNumber.get(customerNumber).push({ customerNumber, Username });
    //                 } else {
    //                     seen.customerNumber.set(customerNumber, { customerNumber, Username });
    //                     recordsByDuplicate.customerNumber.set(customerNumber, [{ customerNumber, Username }]);
    //                 }
    //             }

    //             // Track records for Mobile Number
    //             if (phone) {
    //                 if (seen.phone.has(phone)) {
    //                     duplicates.phone.add(phone);
    //                     recordsByDuplicate.phone.get(phone).push({ customerNumber, Username });
    //                 } else {
    //                     seen.phone.set(phone, { customerNumber, Username });
    //                     recordsByDuplicate.phone.set(phone, [{ customerNumber, Username }]);
    //                 }
    //             }

    //             // Track records for Email
    //             if (Email) {
    //                 if (seen.Email.has(Email)) {
    //                     duplicates.Email.add(Email);
    //                     recordsByDuplicate.Email.get(Email).push({ customerNumber, Username });
    //                 } else {
    //                     seen.Email.set(Email, { customerNumber, Username });
    //                     recordsByDuplicate.Email.set(Email, [{ customerNumber, Username }]);
    //                 }
    //             }

    //             // Track records for Username
    //             if (Username) {
    //                 if (seen.Username.has(Username)) {
    //                     duplicates.Username.add(Username);
    //                     recordsByDuplicate.Username.get(Username).push({ customerNumber, Username });
    //                 } else {
    //                     seen.Username.set(Username, { customerNumber, Username });
    //                     recordsByDuplicate.Username.set(Username, [{ customerNumber, Username }]);
    //                 }
    //             }

    //             let userFinalHallNumber = "";
    //             if (HallNumber) {
    //                 userFinalHallNumber = extractDynamicSegment(HallNumber);
    //             }

    //             playersToImport.push({
    //                 Username: (Username && typeof Username === 'string') ? Username.toLowerCase() : String(Username).toLowerCase(), // Username.toLowerCase(),
    //                 Email: Email,
    //                 phone: phone,
    //                 Firstname: Firstname, // Firstname?.toLowerCase(),
    //                 //DOB: moment(DOB),
    //                 //Wallet: +Wallet,
    //                 //BankId: BankId,
    //                 //Photo: Photo,
    //                 //Password: bcrypt.hashSync( `${userFinalHallNumber}${customerNumber}${Username}` , 10),
    //                 Lastname: Lastname, // Lastname?.toLowerCase(),
    //                 customerNumber: customerNumber,
    //                 HallNumber: userFinalHallNumber
    //             });
    //         }

    //         if (duplicates.customerNumber.size > 0 || duplicates.phone.size > 0 || duplicates.Email.size > 0 || duplicates.Username.size > 0) {
    //             //let importFileDuplicateError = [];

    //             // for (const duplicate of duplicates.customerNumber) {
    //             //     console.log(`Records with duplicate Customer Number ${duplicate}:`);
    //             //     console.log(recordsByDuplicate.customerNumber.get(duplicate));

    //             //     importFileDuplicateError.push(`Duplicate Customer Number Found in imported File: ${recordsByDuplicate.customerNumber.get(duplicate)}`);
    //             // }

    //             // for (const duplicate of duplicates.phone) {
    //             //     console.log(`Records with duplicate Mobile Number ${duplicate}:`);
    //             //     console.log(recordsByDuplicate.phone.get(duplicate));

    //             //     importFileDuplicateError.push(`Duplicate Mobile Number Found in imported File: ${recordsByDuplicate.phone.get(duplicate)}`);
    //             // }

    //             // for (const duplicate of duplicates.Email) {
    //             //     console.log(`Records with duplicate Email ${duplicate}:`);
    //             //     console.log(recordsByDuplicate.Email.get(duplicate));

    //             //     importFileDuplicateError.push(`Duplicate Email Found in imported File: ${recordsByDuplicate.Email.get(duplicate)}`);
    //             // }

    //             // for (const duplicate of duplicates.Username) {
    //             //     console.log(`Records with duplicate Username ${duplicate}:`);
    //             //     console.log(recordsByDuplicate.Username.get(duplicate));

    //             //     importFileDuplicateError.push(`Duplicate Username Found in imported File: ${recordsByDuplicate.Username.get(duplicate)}`);
    //             // }

    //             function serializeDuplicates(duplicates, recordsByDuplicate) {
    //                 return {
    //                     duplicates: {
    //                         customerNumber: Array.from(duplicates.customerNumber),
    //                         phone: Array.from(duplicates.phone),
    //                         Email: Array.from(duplicates.Email),
    //                         Username: Array.from(duplicates.Username),
    //                     },
    //                     recordsByDuplicate: {
    //                         customerNumber: Object.fromEntries(recordsByDuplicate.customerNumber),
    //                         phone: Object.fromEntries(recordsByDuplicate.phone),
    //                         Email: Object.fromEntries(recordsByDuplicate.Email),
    //                         Username: Object.fromEntries(recordsByDuplicate.Username),
    //                     }
    //                 };
    //             }
    //             const serializedData = serializeDuplicates(duplicates, recordsByDuplicate);

    //             if (serializedData.duplicates.customerNumber.length > 0 ||
    //                 serializedData.duplicates.phone.length > 0 ||
    //                 serializedData.duplicates.Email.length > 0 ||
    //                 serializedData.duplicates.Username.length > 0) {

    //                 return res.status(400).json({ errors: serializedData, isInternalError: true });
    //             }
    //         }

    //         if (errorMessages.length > 0) {
    //             return res.status(400).json({ errors: errorMessages });
    //         }
    //         console.log("playersToImport---", playersToImport, playersToImport.length);
    //         if (playersToImport.length > 0) {
    //             const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
    //             fs.writeFileSync(filePath, JSON.stringify(playersToImport));

    //             return res.status(200).json({
    //                 playersCount: playersToImport.length,
    //                 message: `${playersToImport.length} players ready to be imported. Confirm?`,
    //                 filePath: `import_player_${loggedInUserId}` // Send back the file path for confirmation
    //             });
    //         } else {
    //             return res.status(200).json({
    //                 playersCount: playersToImport.length,
    //                 message: `${playersToImport.length} players ready to be imported. Confirm?`,
    //             });
    //         }


    //     } catch (e) {
    //         console.log("Error while imporing players", e)
    //         res.status(400).json({ errors: ["Something went wrong"] });
    //     }
    // },

    // confirmImportPlayers: async function (req, res) {
    //     try {
    //         let loggedInUserId = req.session.id;

    //         const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
    //         if (req.body.isConfirm == 'Yes') {
    //             console.log("import player to database");

    //             if (!fs.existsSync(filePath)) {
    //                 return res.status(400).json({ status: "fail", message: "No file found. Please re-import the players." });
    //             }
    //             let allHalls = [];
    //             let groupHall = {};
    //             let defaultHall = await Sys.App.Services.HallServices.getSingleHallData({ name: "Inactive Players" }, { agents: 1, name: 1, groupHall: 1 });

    //             // let hall = {
    //             //     id: "",
    //             //     name: "",
    //             //     status: 'Approved',
    //             //     actionBy: {
    //             //         id: req.session.details.id.toString(),
    //             //         name: req.session.details.name,
    //             //         role: req.session.details.role
    //             //     },
    //             //     agent: {}
    //             // }

    //             const playersToImport = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    //             let errorMessages = [];
    //             let allPlayersToInsert = [];
    //             let importedPlayerCount = 0;
    //             for (const player of playersToImport) {
    //                 let hall = {
    //                     status: 'Approved',
    //                     actionBy: {
    //                         id: req.session.details.id.toString(),
    //                         name: req.session.details.name,
    //                         role: req.session.details.role
    //                     },
    //                 };
    //                 const { Username, Email, phone, Firstname, Lastname, customerNumber, HallNumber, Photo } = player;

    //                 let query = { $or: [] };
    //                 if (Email) {
    //                     query.$or.push({ email: Email });
    //                 }
    //                 if (phone) {
    //                     query.$or.push({ phone: phone });
    //                 }
    //                 query.$or.push({ username: Username });
    //                 const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1 });

    //                 //const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: [{ email: Email}, { phone: phone }, {username: Username}] }, {username: 1});
    //                 if (existingPlayer) {
    //                     console.log("existingPlayer---", existingPlayer);
    //                     errorMessages.push(`Duplicate Player Not Imported: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${Firstname} ${Lastname}, Email: ${Email}, Phone Number: ${phone}`);
    //                     continue;
    //                 }

    //                 if (!customerNumber) {
    //                     const customer = await Sys.Game.Common.Controllers.PlayerController.generateUniqueCustomerNumber();
    //                     console.log("Generated customerNumber", customer)
    //                     if (customer.status == "success" && customer.newCustomerNumber) {
    //                         customerNumber = customer.newCustomerNumber
    //                     } else {
    //                         errorMessages.push(`Error Importing Player: Customer Number=${customerNumber}, Username=${Username}, Full Name: ${Firstname} ${Lastname}, Email: ${Email}, Phone Number: ${phone}`);
    //                         continue;
    //                     }
    //                 }

    //                 let uploadPhoto = "";
    //                 if (Photo && isValidUrl(Photo)) {
    //                     let filename = path.basename(new URL(Photo).pathname)
    //                     let extention = path.extname(filename);
    //                     let randomNum = Math.floor(100000 + Math.random() * 900000);
    //                     uploadPhoto = await downloadImage(Photo, `${Date.now()}_${randomNum}${extention}`);
    //                     console.log("uploadPhoto---", uploadPhoto, `${Date.now()}_${randomNum}${extention}`)
    //                 } else {
    //                     //console.log("valid image url not found", Photo)
    //                 }

    //                 let playerStatus = "Active";
    //                 const foundHall = allHalls.find(item => item.number == HallNumber);
    //                 if (allHalls.length > 0 && foundHall) {
    //                     hall.id = foundHall.id.toString();
    //                     hall.name = foundHall.name;
    //                     hall.agent = foundHall.agent;
    //                     groupHall = foundHall.groupHall;
    //                 } else {

    //                     let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ number: HallNumber }, { agents: 1, name: 1, groupHall: 1 });
    //                     if (hallsData) {
    //                         if (!allHalls.find(obj => obj.number == HallNumber)) {
    //                             allHalls.push({ number: HallNumber, agent: hallsData.agents[0], id: hallsData._id, name: hallsData.name, groupHall: hallsData.groupHall });
    //                         }
    //                         hall.id = hallsData._id.toString();
    //                         hall.name = hallsData.name;
    //                         hall.agent = hallsData.agents[0];
    //                         groupHall = hallsData.groupHall;
    //                     } else {
    //                         hall.id = defaultHall._id.toString();
    //                         hall.name = defaultHall.name;
    //                         hall.agent = defaultHall.agents[0];
    //                         groupHall = defaultHall.groupHall;
    //                         playerStatus = "Inactive";
    //                         //hall.status = 'Pending';
    //                     }
    //                 }

    //                 let playerObj = {
    //                     username: Username,
    //                     email: Email,
    //                     phone: phone,
    //                     nickname: Firstname,
    //                     //dob: DOB,
    //                     walletAmount: 0, //Wallet,
    //                     points: 0,
    //                     bankId: "", //BankId,
    //                     hall: hall,
    //                     groupHall: groupHall,
    //                     profilePic: uploadPhoto,
    //                     password: "1234567890",  //bcrypt.hashSync( `${hall.name}${customerNumber}${Username}` , 10),
    //                     socketId: '1234',
    //                     platform_os: "other",
    //                     HR: "no",
    //                     PEP: "no",
    //                     surname: Lastname,
    //                     customerNumber: customerNumber,
    //                     userType: "Online",
    //                     status: playerStatus,
    //                     'otherData.isImportPlayerEmailSent': false,
    //                     'otherData.isImportPlayerPasswordReset': false,
    //                     'otherData.importPlayerResetPasswordToken': "",
    //                 };

    //                 allPlayersToInsert.push(playerObj);
    //                 //await Sys.Game.Common.Services.PlayerServices.create(playerObj);
    //                 importedPlayerCount += 1;

    //             }
    //             if (allPlayersToInsert.length > 0) {
    //                 await Sys.Game.Common.Services.PlayerServices.insertManyPlayers(allPlayersToInsert);
    //             }
    //             fs.unlinkSync(filePath);

    //             module.exports.sendEmailsToImportedPlayers();
    //             console.log("errorMessages---", errorMessages)
    //             res.status(200).json({ status: "success", message: "Players have been imported Successfully.", errors: errorMessages });


    //         } else {
    //             console.log("unlink file");
    //             fs.unlinkSync(filePath); // Clean up uploaded file
    //             res.status(200).json({ status: "success", message: "file has been unliked successfully" });
    //         }
    //     } catch (e) {
    //         console.log("Error while imporing players", e)
    //         res.status(400).json({ status: "fail", message: "Something went wrong" });
    //     }
    // },

    sendEmailsToImportedPlayers: async function () {
        try {
            console.log("sendEmailsToImportedPlayers called")
            const BATCH_SIZE = 1000;
            let batchIndex = 0;

            while (true) {

                const players = await Sys.Game.Game1.Services.PlayerServices.getByData({ 'otherData': { $exists: true }, 'otherData.isImportPlayerEmailSent': false }, { email: 1, hall: 1, phone: 1, username: 1 }, { limit: BATCH_SIZE, skip: (batchIndex * BATCH_SIZE) });
                //console.log("all players,", players, players.length)
                if (players.length == 0) {
                    break;
                }

                // Process each player in the batch
                const smsBaseUrl = 'https://sveve.no/SMS/SendMessage';
                const sveveUser = config.sveve_username;
                const svevePasswd = config.sveve_password;
                const sveveFrom = config.sveve_sender;
                // const sveveMsg = `
                //     Hi. We have a new gaming system we are switching to. your user has been transfered to this system and all we need you to do is login to a terminal or web with your phone number and the password is: 123456

                //     after you have logged in you can change your password OR you can use this link to reset the password. 

                //     Link to service of web: https://spillorama.aistechnolabs.info/web/

                // `
                for (let player of players) {
                    try {
                        //let token = jwt.sign({ id: player._id.toString(), hall: player.hall.id }, jwtcofig.secret);
                        let token = `${Date.now()}${crypto.randomBytes(12).toString('base64url')}`; // sorten the token, if we need to verify id from jwt then we can use jwt
                        await Sys.App.Services.PlayerServices.update({
                            _id: player._id
                        }, {
                            'otherData.importPlayerResetPasswordToken': token,
                        });

                        let resetLink = Sys.Config.App[Sys.Config.Database.connectionType].url + 'player/reset-password/' + token;
                        if (player.email) {
                            let otpobj = {
                                uname: player.email,
                                msg: `Hi, we have moved to a new gaming system. Your user account has been transferred.
                                
                                Please log in through a terminal or the web using your phone number.
                                
                                Your Username is: ${player.username} ,
                                
                                Your temporary password is: 123456

                                After logging in, you can change your password.
                                
                                Alternatively, you can reset it directly using below button.
                                
                                Link to service of web: https://spillorama.aistechnolabs.info/web/`,
                                buttonName: 'Change Your Password',
                                note: 'Click Above Button to Reset Your Password',
                                baseUrl: Sys.Config.App[Sys.Config.Database.connectionType].url,
                                resetLink: resetLink,
                            }

                            let mailOptions = {
                                to_email: player.email,
                                subject: 'Spillorama Bingo Game : Reset Password',
                                templateName: 'forgot_mail_template',
                                dataToReplace: otpobj //<json containing data to be replaced in template>
                            };

                            let templateName = mailOptions.templateName; //must be html file name
                            let templatePath = path.join(__dirname, '../../', 'App/Views/templateHtml/', templateName + '.html');
                            let htmlData = fs.readFileSync(templatePath, 'utf-8');
                            let template = handlebars.compile(htmlData);
                            let dataToReplace = mailOptions.dataToReplace;
                            let newHtmlData = template(dataToReplace);

                            let info = {
                                from: Sys.Config.App.mailer.defaultFromAddress,
                                to: mailOptions.to_email,
                                subject: mailOptions.subject,
                                html: newHtmlData
                            };

                            defaultTransport.sendMail(info, function (error) {
                                if (error) {
                                    console.log(error);
                                } else {
                                    console.log("Email sent to player", player.email)
                                    defaultTransport.close();
                                }
                            });
                        }
                        
                        if(player.phone) {
                            const safeResetLink = encodeURI(resetLink);
                            const sveveMsg = `Hi, we have moved to a new gaming system. Your user account has been transferred. Please log in using your phone number. Your temporary password is 123456. After logging in, you can change your password OR Reset your password here: ${safeResetLink}, Web login: https://spillorama.aistechnolabs.info/web/`;
                            const params = {
                                user: sveveUser,
                                passwd: svevePasswd,
                                to: player.phone,
                                msg: sveveMsg,
                                from: sveveFrom,
                                f: 'json',  // Request JSON response
                                reply: false,
                                //test: true
                            };
                            
                            const response = await axios.get(smsBaseUrl, { params });
                          
                            const res = response.data.response;
                           
                            if (res.fatalError) {
                                console.error(' Fatal error:', res.fatalError);
                            } 

                            if (res?.errors?.length >0 ) {
                                console.error(' Fatal error:', res?.errors);
                            } 
                
                            if (res.msgOkCount > 0) {
                                console.log(`SMS sent to ${res.msgOkCount} recipient(s). Units used: ${res.stdSMSCount}`);
                            }
                        }

                        await Sys.App.Services.PlayerServices.update({ _id: player.id }, { 'otherData.isImportPlayerEmailSent': true });

                    } catch (error) {
                        console.error(`Failed to send to ${player.email}:`, error);
                    }
                }

                // Move to the next batch
                batchIndex++;

            }

        } catch (e) {
            console.log("Error in sending to imported players", e);
        }
    },

    updatePlayerSchemaMultihall: async function () {
        try {
            let players = await Sys.Game.Game1.Services.PlayerServices.getByData({}, { hall: 1, groupHall: 1, approvedHalls: 1, username: 1 });
            if (players.length > 0) {
                let groupHalls = await Sys.App.Services.GroupHallServices.getGroupHalls({ status: "active" }, { name: 1, halls: 1 });
                const hallToGroupHallMap = {};
                if (Array.isArray(groupHalls)) {
                    groupHalls.forEach(groupHall => {
                        if (Array.isArray(groupHall.halls)) { // Safeguard for missing or undefined halls
                            groupHall.halls.forEach(hall => {
                                hallToGroupHallMap[hall.id] = {
                                    id: groupHall.id,
                                    name: groupHall.name
                                };
                            });
                        } else {
                            console.warn(`groupHall ${groupHall.groupHallId} has no halls array`);
                        }
                    });
                } else {
                    console.error("No groupHalls data fetched or invalid format:", groupHalls);
                }
                console.log("hallToGroupHallMap---", hallToGroupHallMap);

                for (let p = 0; p < players.length; p++) {
                    let player = players[p];
                    if (!Array.isArray(player.approvedHalls)) {
                        player.approvedHalls = [];
                    }
                    const updatedGroupHall = hallToGroupHallMap[player.hall?.id] || { id: "", name: "" };
                    if (player.approvedHalls.length === 0 && player.hall) {
                        player.approvedHalls.push({
                            id: player.hall.id,
                            name: player.hall.name,
                            status: player.hall.status,
                            groupHall: updatedGroupHall
                        });

                        await Sys.App.Services.PlayerServices.update({ _id: player.id }, { approvedHalls: player.approvedHalls, playerAgent: player.hall.agent, hallApprovedBy: player.hall.actionBy, hall: { id: player.hall.id, name: player.hall.name, status: player.hall.status, } });
                    } else {
                        console.log("not updated", player.username);
                    }
                }
            }
            return { "status": "Success" };
        } catch (e) {
            console.log("Error in updating player schema for multi hall", e);
        }
    },

    importPlayers: async function(req, res){
        let loggedInUserId = req.session.id;
        try {
            console.log("import player called", req.body, req.files);
            req.setTimeout(300000);  // 5 minutes
            res.setTimeout(300000); 

            if (!req.files || !req.files.file) {
                return res.status(400).send('No file uploaded');
            }

            let playersData;
            const file = req.files.file;
            const buffer = file.data;

            const workbook = xlsx.read(buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            playersData = xlsx.utils.sheet_to_json(worksheet, {
                //range: 1 // skip the first row
            });

            let errorMessages = [];
            let playersToImport = [];

            const seen = {
                customerNumber: new Map(),
                phone: new Map(),
                Email: new Map(),
                Username: new Map(),
            };

            const duplicates = {
                customerNumber: new Set(),
                phone: new Set(),
                Email: new Set(),
                Username: new Set(),
            };

            const recordsByDuplicate = {
                customerNumber: new Map(),
                phone: new Map(),
                Email: new Map(),
                Username: new Map(),
            };

            for (const player of playersData) {
                const customerNumber = player['Customer Number'];
                const FullName = player['Full Name']; 
                const Username = player.Username;
                let phone = (player['Phone Number'] || '').toString().trim(); //player['Phone Number'] || ''; 
                let Email = (player.Email || '').toString().trim(); //player.Email || ''; 
                const HallNumber = player['Hall Number'];
                console.log("customerNumber, FullName, Username, phone, Email, HallNumber", customerNumber, FullName, Username, phone, Email, HallNumber)
                // Username should be present
                if (!Username) {
                    errorMessages.push(`Username is Required: Customer Number: ${customerNumber}, FullName: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
                    continue;
                }

                if (!customerNumber) {
                    errorMessages.push(`Customer Number is Required: Username: ${Username}, FullName: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
                    continue;
                }

                const { Firstname, Lastname } = splitName(FullName);

                // Validate email format
                if (Email && !isValidEmail(Email)) {
                    errorMessages.push(`Invalid email format for player: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
                    continue;
                }

                // Validate phone number format (minimum 8 digits)
                if (phone && !isValidPhoneNumber(phone)) {console.log("phone---", phone)
                    errorMessages.push(`Invalid phone number format for player: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${FullName}, Email: ${Email}, Phone Number: ${phone}`);
                    continue;
                }

                let userFinalHallNumber = "";
                if (HallNumber) {
                    userFinalHallNumber = extractDynamicSegment(HallNumber);
                }

                // Track records for Customer Number
                if (customerNumber) {
                    const hallKey = `${customerNumber}-${userFinalHallNumber}`;
                    if (seen.customerNumber.has(hallKey)) {
                        duplicates.customerNumber.add(hallKey);
                        recordsByDuplicate.customerNumber.get(hallKey).push({customerNumber, Username, Email, phone});
                    } else {
                        seen.customerNumber.set(hallKey, {customerNumber, Username});
                        recordsByDuplicate.customerNumber.set(hallKey, [{customerNumber, Username, Email, phone}]);
                    }
                }

                // Track records for Mobile Number
                if (phone) {
                    const hallKey = `${phone}-${userFinalHallNumber}`;
                    if (seen.phone.has(hallKey)) {
                        duplicates.phone.add(hallKey);
                        recordsByDuplicate.phone.get(hallKey).push({customerNumber, Username, Email, phone});
                    } else {
                        seen.phone.set(hallKey, {customerNumber, Username});
                        recordsByDuplicate.phone.set(hallKey, [{customerNumber, Username, Email, phone}]);
                    }
                }

                // Track records for Email
                if (Email) {
                    const hallKey = `${Email}-${userFinalHallNumber}`;
                    if (seen.Email.has(hallKey)) {
                        duplicates.Email.add(hallKey);
                        recordsByDuplicate.Email.get(hallKey).push({customerNumber, Username, Email, phone});
                    } else {
                        seen.Email.set(hallKey, {customerNumber, Username});
                        recordsByDuplicate.Email.set(hallKey, [{customerNumber, Username, Email, phone}]);
                    }
                }

                // Track records for Username
                if (Username) {
                    const hallKey = `${Username}-${userFinalHallNumber}`;
                    if (seen.Username.has(hallKey)) {
                        duplicates.Username.add(hallKey);
                        recordsByDuplicate.Username.get(hallKey).push({customerNumber, Username, Email, phone});
                    } else {
                        seen.Username.set(hallKey, {customerNumber, Username});
                        recordsByDuplicate.Username.set(hallKey, [{customerNumber, Username, Email, phone}]);
                    }
                }


                // Only add new records to playersToImport
                let existingPlayerNew = playersToImport.find(p => 
                    p.Username === (Username && typeof Username === 'string' ? Username.toLowerCase() : String(Username).toLowerCase()) || 
                    (phone && p.phone === phone) || 
                    (Email && p.Email === Email)
                );

                if (existingPlayerNew) {
                    // If player already exists, merge Hall Numbers if not already present
                    if (!existingPlayerNew.HallNumber.includes(userFinalHallNumber)) {
                        existingPlayerNew.HallNumber.push(userFinalHallNumber);
                    }
                } else {
                    // Add new player if not already in the list
                    playersToImport.push({
                        Username: (Username && typeof Username === 'string') ? Username.toLowerCase() : String(Username).toLowerCase(),
                        Email: Email,
                        phone: phone,
                        Firstname: Firstname,
                        Lastname: Lastname,
                        customerNumber: customerNumber,
                        HallNumber: [userFinalHallNumber] // Ensure HallNumber is added to the player data
                    });
                }

            }

            if (duplicates.customerNumber.size > 0 || duplicates.phone.size > 0 || duplicates.Email.size > 0 || duplicates.Username.size > 0) {
                function serializeDuplicates(duplicates, recordsByDuplicate) {
                    return {
                        duplicates: {
                            customerNumber: Array.from(duplicates.customerNumber),
                            phone: Array.from(duplicates.phone),
                            Email: Array.from(duplicates.Email),
                            Username: Array.from(duplicates.Username),
                        },
                        recordsByDuplicate: {
                            customerNumber: Object.fromEntries(recordsByDuplicate.customerNumber),
                            phone: Object.fromEntries(recordsByDuplicate.phone),
                            Email: Object.fromEntries(recordsByDuplicate.Email),
                            Username: Object.fromEntries(recordsByDuplicate.Username),
                        }
                    };
                }
                const serializedData = serializeDuplicates(duplicates, recordsByDuplicate);

                if (serializedData.duplicates.customerNumber.length > 0 ||
                    serializedData.duplicates.phone.length > 0 ||
                    serializedData.duplicates.Email.length > 0 ||
                    serializedData.duplicates.Username.length > 0) {

                    // remove duplicate players all entries without selecting any
                    console.log("recordsByDuplicate---", recordsByDuplicate, duplicates);
                    /*await processDuplicates("customerNumber", duplicates, recordsByDuplicate, playersToImport);
                    await processDuplicates("phone", duplicates, recordsByDuplicate, playersToImport);
                    await processDuplicates("Email", duplicates, recordsByDuplicate, playersToImport);
                    await processDuplicates("Username", duplicates, recordsByDuplicate, playersToImport);*/

                    return res.status(400).json({ errors: serializedData, isInternalError: true });
                }
            }

            if (errorMessages.length > 0) {
                return res.status(400).json({ errors: errorMessages });
            }


            let databaseErrors = []
            if(playersToImport.length > 0){
                for(let p=0; p < playersToImport.length; p++){
                    const conditions = [
                        playersToImport[p].Email && { email: playersToImport[p].Email },
                        playersToImport[p].phone && { phone: playersToImport[p].phone },
                        playersToImport[p].Username && { username: (playersToImport[p].Username && typeof playersToImport[p].Username === 'string') ? playersToImport[p].Username.toLowerCase() : String(playersToImport[p].Username).toLowerCase() },
                        playersToImport[p].customerNumber && { customerNumber: playersToImport[p].customerNumber }
                    ].filter(Boolean);
                    //console.log("conditions---", conditions)
                    if (conditions.length > 0) {
                        const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: conditions, userType: {$ne: "Bot"} }, {username: 1, approvedHalls: 1, email: 1, phone: 1, customerNumber: 1});
                        console.log("existingPlayer---", existingPlayer)
                        if (existingPlayer) {
                            //databaseErrors.push(`Duplicate Player Found: Customer Number: ${playersToImport[p].customerNumber}, Username: ${playersToImport[p].Username}, Full Name: ${playersToImport[p].Firstname}${playersToImport[p].Lastname }, Email: ${playersToImport[p].Email}, Phone Number: ${playersToImport[p].phone }`);

                            if(existingPlayer.approvedHalls && existingPlayer.approvedHalls.length > 0){
                                let allHalls = [];
                                for(let i=0; i < existingPlayer.approvedHalls.length; i++){
                                    allHalls.push(existingPlayer.approvedHalls[i].id);
                                }
                                let hallNumbers = [];
                                let hallNumberArray = await Sys.App.Services.HallServices.getAllHallDataSelect({_id: {$in: allHalls } }, {number: 1});
                                if(hallNumberArray && hallNumberArray.length > 0){
                                    for(let h=0; h < hallNumberArray.length; h++){
                                        hallNumbers.push(hallNumberArray[h].number);
                                    }
                                }
                                console.log("hallNumbers----", hallNumbers, hallNumberArray, allHalls, existingPlayer.approvedHalls)
                                // Compare the hall numbers of the player with the existing hall numbers
                                if (playersToImport[p].HallNumber) {
                                    let missingHallNumbers = playersToImport[p].HallNumber = playersToImport[p].HallNumber.filter(
                                        (number) => !hallNumbers.includes(number)
                                    );

                                    console.log("missingHallNumbers---", missingHallNumbers, playersToImport[p].HallNumber, hallNumbers)
                                    if (missingHallNumbers.length === 0) {
                                        playersToImport[p].HallNumber = [];
                                        playersToImport[p].needToUpdate = false;  
                                    } else {
                                        playersToImport[p].HallNumber = missingHallNumbers;
                                        playersToImport[p].needToUpdate = true;  
                                        playersToImport[p].updatePlayerId =  existingPlayer.id
                                        //console.log("need to be updated", playersToImport[p])
                                    }

                                }

                            }

                        }
                    } 
                }
            }

            if (databaseErrors.length > 0) {
                return res.status(400).json({ errors: databaseErrors });
            }

            console.log("playersToImport---", playersToImport, playersToImport.length);
            if (playersToImport.length > 0) {
                const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
                fs.writeFileSync(filePath, JSON.stringify(playersToImport));

                return res.status(200).json({
                    playersCount: playersToImport.length,
                    message: `${playersToImport.length} players ready to be imported. Confirm?`,
                    filePath: `import_player_${loggedInUserId}` // Send back the file path for confirmation
                });
            } else {
                return res.status(200).json({ playersCount: 0, message: 'No valid players to import' });
            }
        } catch (e) {
            console.log("Error importing players", e);
            return res.status(500).json({ errors: e.message });
        }
    },

    confirmImportPlayers: async function(req, res){
        try{
            let loggedInUserId = req.session.id;

            const filePath = path.join(__dirname, `../../public/assets/import_player_${loggedInUserId}.json`);
            if(req.body.isConfirm == 'Yes'){
                console.log("import player to database");

                if (!fs.existsSync(filePath)) {
                    return res.status(400).json({status: "fail", message: "No file found. Please re-import the players."} );
                }
                let allHalls = [];
                let groupHall = {};
                let defaultHall = await Sys.App.Services.HallServices.getSingleHallData({name: "Inactive Players"}, {agents: 1, name: 1, groupHall: 1});

                const playersToImport = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                let errorMessages = [];
                let allPlayersToInsert = [];
                let importedPlayerCount = 0;
                for (const player of playersToImport) {

                    const { Username, Email, phone, Firstname, Lastname, customerNumber, HallNumber, Photo, needToUpdate, updatePlayerId } = player;

                    if(HallNumber && HallNumber.length == 0){
                        continue;
                    }

                    let query = { $or: [], userType: {$ne: "Bot"} };
                    if (Email) {
                        query.$or.push({ email: Email });
                    }
                    if (phone) {
                        query.$or.push({ phone: phone });
                    }
                    query.$or.push({ username: Username });
                    //const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1 });

                    //const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData({ $or: [{ email: Email}, { phone: phone }, {username: Username}] }, {username: 1});
                    // if (existingPlayer) {
                    //     console.log("existingPlayer---", existingPlayer);
                    //     errorMessages.push(`Duplicate Player Not Imported: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${Firstname} ${Lastname}, Email: ${Email}, Phone Number: ${phone}`);
                    //     continue;
                    // }

                    if(!customerNumber) {
                        const customer = await Sys.Game.Common.Controllers.PlayerController.generateUniqueCustomerNumber();
                        console.log("Generated customerNumber", customer)
                        if(customer.status== "success" && customer.newCustomerNumber){
                            customerNumber = customer.newCustomerNumber
                        }else{
                            errorMessages.push(`Error Importing Player: Customer Number=${customerNumber}, Username=${Username}, Full Name: ${Firstname} ${Lastname}, Email: ${Email}, Phone Number: ${phone}`);
                            continue;
                        }
                    }



                    let uploadPhoto = "";
                    if(Photo && isValidUrl(Photo)){
                        let filename = path.basename(new URL(Photo).pathname)
                        let extention = path.extname(filename);
                        let randomNum = Math.floor(100000 + Math.random() * 900000);
                        uploadPhoto = await downloadImage(Photo, `${Date.now()}_${randomNum}${extention}`);
                        console.log("uploadPhoto---", uploadPhoto, `${Date.now()}_${randomNum}${extention}`)
                    }else{
                        //console.log("valid image url not found", Photo)
                    }

                    let playerStatus = "Active";

                    let hall = {};
                    let approvedHalls = [];
                    let allPlayerAgents = [];
                    let playerAgent = {};
                    let hallApprovedBy = {};

                    if(HallNumber && HallNumber.length > 0){
                        for(let h=0; h < HallNumber.length; h++){
                            const foundHall = allHalls.find(item => item.number == HallNumber[h]);
                            if( allHalls.length > 0 && foundHall ){
                                approvedHalls.push({
                                    id: foundHall.id.toString(),
                                    name: foundHall.name,
                                    status: 'Approved',
                                    groupHall: foundHall.groupHall,
                                });
                                if(foundHall.agent){
                                    allPlayerAgents.push(foundHall.agent);
                                }

                            }else{
                                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({number: HallNumber}, {agents: 1, name: 1, groupHall: 1});
                                if(hallsData){
                                    if (!allHalls.find(obj => obj.number == HallNumber[h])) {
                                        allHalls.push({number: HallNumber[h], agent: hallsData.agents[0], id: hallsData._id, name: hallsData.name, groupHall: hallsData.groupHall});
                                    }
                                    approvedHalls.push({
                                        id: hallsData.id.toString(),
                                        name: hallsData.name,
                                        status: 'Approved',
                                        groupHall: hallsData.groupHall,
                                    });
                                    if(hallsData.agent){
                                        allPlayerAgents.push(hallsData.agent);
                                    }

                                }else{
                                    approvedHalls.push({
                                        id: defaultHall.id.toString(),
                                        name: defaultHall.name,
                                        status: 'Approved',
                                        groupHall: defaultHall.groupHall,
                                    });
                                    if(defaultHall.agent){
                                        allPlayerAgents.push(defaultHall.agent);
                                    }

                                }
                            }
                        }
                    }
                    console.log("approvedHalls,allPlayerAgents", approvedHalls, allPlayerAgents)
                    if(approvedHalls.length > 0){
                        playerAgent = allPlayerAgents[0];
                        hallApprovedBy = {
                            id: allPlayerAgents[0]?.id.toString(),
                            name: allPlayerAgents[0]?.name,
                            role: "agent"
                        }
                        hall = {
                            id: approvedHalls[0]?.id.toString(),
                            name: approvedHalls[0]?.name,
                            status: 'Approved',
                        }
                        groupHall = approvedHalls[0]?.groupHall
                    }

                    if(needToUpdate == true && updatePlayerId){
                        await Sys.App.Services.PlayerServices.updatePlayerData({_id: updatePlayerId}, {$push: { approvedHalls: { $each: approvedHalls } }  });
                        continue;
                    }

                    const existingPlayer = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1 });

                    if (existingPlayer) {
                        console.log("existingPlayer---", existingPlayer);
                        errorMessages.push(`Duplicate Player Not Imported: Customer Number: ${customerNumber}, Username: ${Username}, Full Name: ${Firstname} ${Lastname}, Email: ${Email}, Phone Number: ${phone}`);
                        continue;
                    }

                    let playerObj = {
                        username: Username,
                        email: Email,
                        phone: phone,
                        nickname: Firstname,
                        //dob: DOB,
                        walletAmount: 0, //Wallet,
                        points: 0,
                        bankId: "", //BankId,
                        hall: hall,
                        groupHall: groupHall,
                        profilePic: uploadPhoto,
                        password: bcrypt.hashSync("123456", 10),
                        socketId: '1234',
                        platform_os: "other",
                        HR: "no",
                        PEP: "no",
                        surname: Lastname,
                        customerNumber: customerNumber,
                        userType: "Online",
                        status: playerStatus,
                        'otherData.isImportPlayerEmailSent': false,
                        'otherData.isImportPlayerPasswordReset': false,
                        'otherData.importPlayerResetPasswordToken': "",
                        approvedHalls: approvedHalls,
                        playerAgent: playerAgent,
                        hallApprovedBy: hallApprovedBy
                    };

                    allPlayersToInsert.push(playerObj);
                    //await Sys.Game.Common.Services.PlayerServices.create(playerObj);
                    importedPlayerCount += 1;

                }
                if(allPlayersToInsert.length > 0){
                    await Sys.Game.Common.Services.PlayerServices.insertManyPlayers(allPlayersToInsert);
                }
                fs.unlinkSync(filePath);

                module.exports.sendEmailsToImportedPlayers();
                console.log("errorMessages---", errorMessages)
                res.status(200).json({ status: "success", message: "Players have been imported Successfully.", errors: errorMessages});


            }else {
                console.log("unlink file");
                fs.unlinkSync(filePath); // Clean up uploaded file
                res.status(200).json({ status: "success", message: "file has been unliked successfully"});
            }
        }catch(e){
            console.log("Error while imporing players", e)
            res.status(400).json({status: "fail", message: "Something went wrong"});
        }
    },

    // update status of already approved players and then no need of this function
    updateIfPlayerAlreadyApproved: async function (req, res) {
        try {
            await Sys.App.Services.PlayerServices.updateManyDataDailyAttendance(
                { 'hall.status': "Approved" },
                { $set: { isAlreadyApproved: true } }
            );

            await Sys.App.Services.PlayerServices.updateManyDataDailyAttendance(
                { 'hall.status': { $ne: "Approved" } },
                { $set: { isAlreadyApproved: false } }
            );
            res.send("success")
        } catch (e) {
            Sys.Log.info("Error in update if player already approved", e)
        }
    },

    /**
     * Verify a player
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @returns {Object} - Response object with status, message and isVerified
     */
    verifyPlayer: async function (req, res) {
        const language = req.session.details?.language || "norwegian";
        const {playerId, idExpiryDate} = req.body;
        try {

            if(!idExpiryDate){
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_select_id_card_expiry_date"], language) });
            }

            const inputDate = moment(idExpiryDate, "YYYY-MM-DD");
            const tomorrow = moment().startOf('day').add(1, 'day');
            console.log("date errors--", inputDate, tomorrow, inputDate.isValid(), inputDate.isBefore(tomorrow))
            if (!inputDate.isValid() || inputDate.isBefore(tomorrow))
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["please_select_id_card_expiry_date_from_tomorrow_onward"], language) });

            // Get player data
            const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
                { _id: playerId },
                { isVerifiedByHall: 1, username: 1, socketId: 1 }
            );

            if (!player) {
                // If player not found
                return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["player_not_found"], language) });
            }

            if (player.isVerifiedByHall) {
                // If player is already verified
                return res.send({ status: "success", isVerified: true, message: `${await Sys.Helper.bingo.getSingleTraslateData(["player"], language)} "${player.username}" ${await Sys.Helper.bingo.getSingleTraslateData(["already_verified"], language)}` });
            }

            // Verify player, for date set startOf the day but we will only conisder date part not time so it will be for the complete day
            // if expired at 15th we will set 16th start of the day so it will be 16th 00:00:00
            const updatedPlayer = await Sys.App.Services.PlayerServices.findOneandUpdatePlayer({ _id: playerId }, { isVerifiedByHall: true,  'otherData.hallVerification': {idExpiryDate: moment(idExpiryDate).add(1, 'day').startOf('day').toDate(), remindersSent: []}}, { new: true });

            // Get player verification status
            const { isVerifiedByBankID, isVerifiedByHall, canPlayGames, isBankIdReverificationNeeded, idExpiryDate: updatedIdExpiryDate } = await playerVerificationStatus(updatedPlayer);
        
            // Emit event to player
            await Sys.Io.to(player.socketId).emit('playerVerificationStatus', {
                isVerifiedByBankID,
                isVerifiedByHall,
                canPlayGames,
                isBankIdReverificationNeeded,
                idExpiryDate: updatedIdExpiryDate
            });

            // Check if need to send reminder email of id card expiry of 30 days
            module.exports.checkBankIdAndIdCardExpiryAndSendReminders(player._id, 'IDCard');

            // Return response
            const message = `${await Sys.Helper.bingo.getSingleTraslateData(["player"], language)} "${player.username}" ${await Sys.Helper.bingo.getSingleTraslateData(["is_verify_success"], language)}`;
            return res.send({ status: "success", isVerified: true, message: message });
        } catch (error) {
            console.error("Error in verifyPlayer:", error, language);
            // Return error response
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
        }
    },

    /**
     * Show track spending view to the player
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @returns {Object} - Response object with status and rendered view
     */
    trackSpendingView: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Tracking Player Spending'] || [];
                let stringReplace =req.session.details.isPermission['Tracking Player Spending'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            // Get translated text
            const keysArray = [
                "you_are_not_allowed_to_access_that_page",
                "dashboard",
                "deposit_amount",
                "customer_number",
                "phone_number",
                "bet_amount",
                "bet_percentage",
                "date_range",
                "username",
                "emailId",
                "hall_name",
                "status",
                "enter",
                "search",
                "all",
                "reset",
                "action",
                "previous",
                "next",
                "show",
                "entries",
            ];
            const translate = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            
            // Render track spending view
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                trackSpendingActive: 'active',
                viewFlag: viewFlag,
                translate: translate,
                navigation: translate
            };
            return res.render('player/track-spending/index', data);
        } catch (e) {
            console.log("Error in view of track spending", e);
        }
    },

    /**
     * Returns the data for the track spending table
     * @param {Object} req - The request object
     * @param {Object} res - The response object
     * @returns {Object} The data for the track spending table
     */
    getTrackSpendingData: async function (req, res) {
        try {
            const { dateRange, amount, percentage } = req.query;
            if (!amount) {
                const obj = {
                    'draw': req.query.draw,
                    'recordsTotal': 0,
                    'recordsFiltered': 0,
                    'data': [],
                };
                return res.send(obj);
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            // Split the date range into start and end dates
            const [startd, end] = dateRange.split(" - ").map(date => {
                const [dd, mm, yyyy] = date.split("-");
                return moment.tz(`${yyyy}-${mm}-${dd}`, "YYYY-MM-DD", "UTC");
            });

            // Set the start and end dates to the start and end of the day respectively
            const startDate = startd.startOf('day').toDate();  // 00:00:00
            const endDate = end.endOf('day').toDate();        // 23:59:59

            // Log the time taken to execute the query
            console.time("queryTime of track player");
            // Create the match condition for the query
            // let matchCondition = {
            //     createdAt: { $gte: startDate, $lte: endDate },
            //     userType: "Online",
            //     $or: [
            //         { typeOfTransaction: "Deposit By Pay in Hall", category: "credit", status: "success" },
            //         { typeOfTransaction: "Add Money By Agent", paymentBy: "Cash", category: "credit", status: "success" },
            //         { game1Slug: { $in: ["buyTicket", "replaceTicket", "cancelTicket"] } },
            //         { defineSlug: { $in: ["buyTicket", "cancelTicket"] } },
            //         { $and: [{ gameType: "game_5" }, { typeOfTransaction: "Game Joined" }] }
            //     ]
            // };

            // Create new optimised match condition to faster reponse
            let matchCondition = {
                createdAt: { $gte: startDate, $lte: endDate },
                userType: "Online",
                defineSlug: "extraTransaction",
                typeOfTransaction: { $in: ["Deposit By Pay in Hall", "Add Money By Agent", "Game Joined", "Replaced Tickets", "Cancel Ticket", "Refund"] }
            };
            // Add the username filter to the match condition if the search field is not empty
            if (search != '') {
                const isNumber = !isNaN(search) && typeof search !== 'boolean';
                if (!isNumber) {
                    matchCondition.playerName = { $regex: search.trim(), $options: "i" }; // Case-insensitive search
                }
            }
            // Create the threshold match condition
            let thresoldMatch = {
                totalDeposit: { $gte: +amount }
            }
            if (percentage) {
                thresoldMatch.betPercentage = { $lte: +percentage };
            }
            // Create the query
            let query = [
                { $match: matchCondition },
                {
                    $project: {
                        playerId: 1,
                        playerName: 1,
                        typeOfTransaction: 1,
                        typeOfTransactionTotalAmount: 1,
                        //game1Slug: 1,
                        defineSlug: 1,
                        //gameType: 1,
                        category: 1,
                        status: 1, 
                        paymentBy: 1
                    }
                },
                {
                    $group: {
                        _id: "$playerId",
                        // totalDeposit: {
                        //     $sum: {
                        //         $cond: [
                        //             {
                        //                 $or: [
                        //                     { $eq: ["$typeOfTransaction", "Deposit By Pay in Hall"] },
                        //                     { $eq: ["$typeOfTransaction", "Add Money By Agent"] }
                        //                 ]
                        //             },
                        //             "$typeOfTransactionTotalAmount",
                        //             0
                        //         ]
                        //     }
                        // },
                        // totalBuy: {
                        //     $sum: {
                        //         $cond: [
                        //             {
                        //                 $or: [
                        //                     { $eq: ["$game1Slug", "buyTicket"] },
                        //                     { $eq: ["$defineSlug", "buyTicket"] },
                        //                     { $and: [{ $eq: ["$gameType", "game_5"] }, { $eq: ["$typeOfTransaction", "Game Joined"] }] },
                        //                     { $eq: ["$game1Slug", "replaceTicket"] }
                        //                 ]
                        //             },
                        //             "$typeOfTransactionTotalAmount",
                        //             0
                        //         ]
                        //     }
                        // },
                        // totalCancel: {
                        //     $sum: {
                        //         $cond: [
                        //             {
                        //                 $or: [
                        //                     { $eq: ["$game1Slug", "cancelTicket"] },
                        //                     { $eq: ["$defineSlug", "cancelTicket"] }
                        //                 ]
                        //             },
                        //             "$typeOfTransactionTotalAmount",
                        //             0
                        //         ]
                        //     }
                        // },
                        totalDeposit: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ["$category", "credit"] },
                                            { $eq: ["$status", "success"] },
                                            {
                                                $or: [
                                                    { $eq: ["$typeOfTransaction", "Deposit By Pay in Hall"] },
                                                    {
                                                        $and: [
                                                            { $eq: ["$typeOfTransaction", "Add Money By Agent"] },
                                                            { $eq: ["$paymentBy", "Cash"] }
                                                        ]
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    "$typeOfTransactionTotalAmount",
                                    0
                                ]
                            }
                        },
                        // totalBuy: {
                        //     $sum: {
                        //         $cond: [
                        //             { $in: ["$typeOfTransaction", ["Game Joined", "Replaced Tickets"]] },
                        //             "$typeOfTransactionTotalAmount",
                        //             0
                        //         ]
                        //     }
                        // },
                        // totalCancel: {
                        //     $sum: {
                        //         $cond: [
                        //             { $in: ["$typeOfTransaction", ["Cancel Ticket", "Refund"]] },
                        //             "$typeOfTransactionTotalAmount",
                        //             0
                        //         ]
                        //     }
                        // },
                        totalBet: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $in: ["$typeOfTransaction", ["Game Joined", "Replaced Tickets", "Cancel Ticket", "Refund"]] }
                                        ]
                                    },
                                    {
                                        $cond: [
                                            { $eq: ["$category", "debit"] }, // Buy (bets)
                                            "$typeOfTransactionTotalAmount",
                                            { $multiply: ["$typeOfTransactionTotalAmount", -1] } // Cancel (refunds)
                                        ]
                                    },
                                    0
                                ]
                            }
                        },
                        username: { $first: "$playerName" }
                    }
                },
                {
                    $addFields: {
                        //totalBet: { $subtract: ["$totalBuy", "$totalCancel"] },
                        betPercentage: {
                            $cond: [
                                { $gt: ["$totalDeposit", 0] },
                                { $multiply: [{ $divide: ["$totalBet", "$totalDeposit"] }, 100] },
                                // { $multiply: [{ $divide: [{ $subtract: ["$totalBuy", "$totalCancel"] }, "$totalDeposit"] }, 100] },
                                0
                            ]
                        }
                    }
                },
                {
                    $match: thresoldMatch
                },
                {
                    $set: {
                        playerId: { $toObjectId: "$_id" }
                    }
                },
                {
                    $lookup: {
                        from: "player",
                        localField: "playerId", // _id is playerId from transactions
                        foreignField: "_id", // Assuming _id in players collection
                        as: "playerData"
                    }
                },
                {
                    $addFields: {
                        customerNumber: { $arrayElemAt: ["$playerData.customerNumber", 0] }
                    }
                },
                {
                    $project: {
                        playerData: 0,
                        playerId: 0 // Optional: remove if not needed
                    }
                },
                ...(search && search.trim() !== "" && !isNaN(Number(search.trim()))
                    ? [{
                        $match: {
                            $expr: {
                                $regexMatch: {
                                    input: { $toString: "$customerNumber" },
                                    regex: search.trim(),
                                    options: "i"
                                }
                            }
                        }
                    }]
                    : []),
                {
                    $facet: {
                        paginatedResults: [
                            { $sort: { totalDeposit: -1 } }, // Sort by totalDeposit descending
                            { $skip: start }, // **Pagination: Skip records**
                            { $limit: length } // **Pagination: Limit records**
                        ],
                        totalRecords: [
                            { $count: "count" } // Get total count
                        ]
                    }
                }
            ];
            
            // Execute the query
            const result = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(query);
            console.timeEnd("queryTime of track player");
            const data = result[0]?.paginatedResults || [];
            const totalRecords = result[0]?.totalRecords?.[0]?.count || 0;
            const obj = {
                'draw': req.query.draw,
                'recordsTotal': totalRecords,
                'recordsFiltered': totalRecords,
                'data': data,
            };
            return res.send(obj);

        } catch (e) {
            console.log("Error in get of track spending", e);
        }
    },

    /**
     * Controller function to show the track spending transactions view.
     * 
     * This function checks if the user is allowed to access this page and
     * redirects to the dashboard if not. It also gets the player data and
     * renders the view with the translated text.
     * 
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    trackSpendingTxView: async function (req, res) {
        try {
            const { totaldeposit, totalbet } = req.query;
            // Get translated text
            const keysArray = [
                "you_are_not_allowed_to_access_that_page",
                "dashboard",
                "player_details",
                "deposit_amount",
                "customer_number",
                "phone_number",
                "bet_amount",
                "bet_percentage",
                "date_range",
                "username",
                "emailId",
                "hall_name",
                "status",
                "enter",
                "search",
                "all",
                "reset",
                "action",
                "previous",
                "next",
                "show",
                "entries",
                "date"
            ];
            const translate = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            // Check if agent is allowed to access this page
            if (req.session.details.role == 'agent') {
                // if agent, show error message and redirect to dashboard
                req.flash('error', translate.you_are_not_allowed_to_access_that_page)
                return res.redirect('/dashboard');
            }

            const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
                { _id: req.params.id },
                { username: 1, customerNumber: 1 }
            );
            // Render track spending view
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                trackSpendingActive: 'active',
                translate: translate,
                navigation: translate,
                playerId: req.params.id,
                player: player,
                totalDeposit: totaldeposit,
                totalBet: totalbet
            };
            return res.render('player/track-spending/transactions', data);
        } catch (e) {
            console.log("Error in view of track spending transactions", e);
        }
    },

    /**
     * Controller function to get track spending transactions data.
     * 
     * This function takes start, length, dateRange, amount, and percentage as query parameters.
     * It fetches the transactions data from the database and returns it in the required format.
     * 
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getTrackSpendingTxData: async function (req, res) {
        try {
            const { dateRange, amount } = req.query;
            const start = parseInt(req.query.start);
            const length = parseInt(req.query.length);
            const sort = { createdAt: -1 };
            const [startd, end] = dateRange.split(" - ").map(date => {
                const [dd, mm, yyyy] = date.split("-");
                return moment.tz(`${yyyy}-${mm}-${dd}`, "YYYY-MM-DD", "UTC");
            });

            const startDate = startd.startOf('day').toDate();  // 00:00:00
            const endDate = end.endOf('day').toDate();        // 23:59:59
            console.time("queryTime of track plyer transaction");
            // const query = {
            //     createdAt: { $gte: startDate, $lte: endDate },
            //     userType: "Online",
            //     playerId: req.params?.id,
            //     $or: [
            //         { typeOfTransaction: "Deposit By Pay in Hall", category: "credit", status: "success" },
            //         { typeOfTransaction: "Add Money By Agent", paymentBy: "Cash", category: "credit", status: "success" },
            //         { game1Slug: { $in: ["buyTicket", "replaceTicket", "cancelTicket"] } },
            //         { defineSlug: { $in: ["buyTicket", "cancelTicket"] } },
            //         { $and: [{ gameType: "game_5" }, { typeOfTransaction: "Game Joined" }] }
            //     ]
            // };

            // Create new optimised match condition to faster reponse
            const query = {
                createdAt: { $gte: startDate, $lte: endDate },
                userType: "Online",
                defineSlug: "extraTransaction",
                $or: [
                    { typeOfTransaction: "Deposit By Pay in Hall", category: "credit", status: "success" },
                    { typeOfTransaction: "Add Money By Agent", category: "credit", status: "success", paymentBy: "Cash" },
                    { typeOfTransaction: { $in: [ "Game Joined", "Replaced Tickets", "Cancel Ticket", "Refund"] } },
                ],
                playerId: req.params?.id,
            };

            // Get the count of the transactions
            let reqCount = await Sys.App.Services.transactionServices.getCount(query);

            // Get the transactions data
            let data = await Sys.App.Services.transactionServices.getTransactionsByData(query, { createdAt: 1, playerName: 1, category: 1, typeOfTransaction: 1, game1Slug: 1, defineSlug: 1, typeOfTransactionTotalAmount: 1 }, { sort: sort, limit: length, skip: start });

            // Map the transactions data to the required format
            // const transactions = data.map(({ createdAt, playerName, typeOfTransaction, game1Slug, defineSlug, typeOfTransactionTotalAmount }) => {
            //     // Deposit transaction types
            //     const depositTypes = ["Deposit By Pay in Hall", "Add Money By Agent"];
            //     // Buy ticket transaction types
            //     const buyTypes = ["buyTicket", "Game Joined"];
            //     // Cancel ticket transaction types
            //     const cancelTypes = ["cancelTicket"];

            //     // Deposit amount
            //     let depositAmount = depositTypes.includes(typeOfTransaction) ? typeOfTransactionTotalAmount : 0;
            //     // Buy or cancel ticket amount
            //     let beAmount = buyTypes.includes(game1Slug) || buyTypes.includes(defineSlug) ? typeOfTransactionTotalAmount :
            //         game1Slug === "replaceTicket" ? typeOfTransactionTotalAmount :
            //             cancelTypes.includes(game1Slug) || cancelTypes.includes(defineSlug) ? typeOfTransactionTotalAmount : 0;

            //     // Transaction type
            //     let tnxType = depositAmount ? "Deposit" : beAmount ? (game1Slug === "replaceTicket" ? "Replace Ticket" : cancelTypes.includes(game1Slug) || cancelTypes.includes(defineSlug) ? "Cancel Ticket" : "Ticket Purchase") : "";

            //     return { date: createdAt, playerName, depositAmount: +depositAmount.toFixed(2), beAmount: +beAmount.toFixed(2), tnxType };
            // });

            const transactions = data.map(({ createdAt, playerName, typeOfTransaction, game1Slug, defineSlug, typeOfTransactionTotalAmount }) => {
                // Deposit transaction types
                const depositTypes = ["Deposit By Pay in Hall", "Add Money By Agent"];
                // Buy ticket transaction types
                const buyTypes = ["Game Joined", "Replaced Tickets"];
                // Cancel ticket transaction types
                const cancelTypes = [ "Cancel Ticket", "Refund"];

                // Deposit amount
                let depositAmount = depositTypes.includes(typeOfTransaction) ? typeOfTransactionTotalAmount : 0;
                // Buy or cancel ticket amount
                let beAmount = ( buyTypes.includes(typeOfTransaction) || game1Slug === "replaceTicket" || cancelTypes.includes(typeOfTransaction) ) ? typeOfTransactionTotalAmount : 0;

                // Transaction type
                let tnxType = depositAmount 
                    ? "Deposit" 
                    : beAmount 
                        ? ({
                            "Refund": "Refund",
                            "Replaced Tickets": "Replace Ticket",
                            "Cancel Ticket": "Cancel Ticket",
                            "Game Joined": "Ticket Purchase"
                        }[typeOfTransaction] || "")
                        : "";
                return { date: createdAt, playerName, depositAmount: +depositAmount.toFixed(2), beAmount: +beAmount.toFixed(2), tnxType };
            });
            console.timeEnd("queryTime of track plyer transaction");

            const obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': transactions,
            };
            return res.send(obj);

        } catch (e) {
            console.log("Error in get of track spending transaction", e);
        }
    },

    // Controller function to reverify bankid for all players by admin from approved players section
    reverifyBankid: async function (req, res) {
        const language = req.session.details?.language || "norwegian";
    
        try {
            const players = await Sys.App.Services.PlayerServices.getAllPlayersData(
                { 'bankIdAuth.status': 'COMPLETED' },
                { _id: 1, username: 1, email: 1, socketId: 1, isVerifiedByHall: 1, bankIdAuth: 1, selectedLanguage: 1 }
            );
    
            if (!players?.length) {
                return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["no_players_found_to_reverify_bankid"], language) || "No players found to re verify BankID" });
            }
            
            const expiryDate = moment().add(30, 'days').startOf('day').toDate();
            
            await Sys.App.Services.PlayerServices.updateManyPlayers(
                { 'bankIdAuth.status': 'COMPLETED' },
                {
                    $set: {
                        'bankIdAuth.expiryDate': expiryDate,
                        'bankIdAuth.remindersSent': [],
                        'bankIdAuth.reverifyDetails': {}
                    }
                }
            );
    
            const socketPayload = {
                //message: await Sys.Helper.bingo.getSingleTraslateData(["your_bankid_needs_to_be_reverified_to_continue_playing"], language) || "Your BankID needs to be re-verified to continue playing",
                isVerifiedByBankID: false,
                expiryDate
            };

            const {englishTranslations, norwegianTranslations } = await bankIdEmailTranslation("BankID");

            const templatePath = path.join(__dirname, '../../App/Views/templateHtml/bankid_reminder.html');
            const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));

            for (const player of players) {
                const lang = player.selectedLanguage === 'en' ? 'english' : 'norwegian';
                const translations = lang === 'english' ? englishTranslations : norwegianTranslations;
                const subject = `Spillorama Bingo: BankID ${translations.verification_reminder}`;
                socketPayload.message = translations.your_bankid_needs_to_be_reverified_to_continue_playing;
                
                // Send reminder email
                const html = template({
                    username: player.username,
                    daysRemaining: 30,
                    expiryDate: moment.utc(player.bankIdAuth?.expiryDate).format('DD MMM YYYY [at] HH:mm [UTC]'),
                    verificationType: 'BankID',
                    translations
                });

                const info = {
                    from: Sys.Config.App.mailer.defaultFromAddress,
                    to: player.email,
                    subject,
                    html
                };
                module.exports.sendReminderEmail(info)
                    .then(() => {
                        return Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
                            { _id: player._id },
                            { $push: { 'bankIdAuth.remindersSent': 30 } }
                        );
                    })
                    .catch(err => {
                        console.log(`Email failed for ${player.username}:`, err);
                    });
                
    
                // Send socket notification
                if (player.socketId) {
                    try {
                        await Sys.Io.to(player.socketId).emit('bankIdReverificationRequired', {
                            ...socketPayload,
                            canPlayGames: player.isVerifiedByHall || false
                        });
                    } catch (err) {
                        console.log(`Socket error for ${player.username}:`, err);
                    }
                }
            }
    
            return res.send({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["players_notified_to_reverify_bankid"], language) || "Players have been successfully notified to reverify their BankID." });
    
        } catch (e) {
            console.error("Error in reverifyBankid:", e);
            return res.send({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) || "Something went wrong while processing BankID reverification" });
        }
    },

    // Function to send reminder email of bankid and id card expiry
    sendReminderEmail: async function (info) {
        try {
            return new Promise((resolve, reject) => {
                defaultTransport.sendMail(info, (err) => {
                    if (err) {
                        console.log("Error sending reminder email:", err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        } catch (err) {
            console.log("Error in sendReminderEmail:", err);
            throw err;
        }
    },
    
    // Function to process reminders of bankid and id card expiry
    processReminder: async function ({
        query,
        projection,
        datePath,
        remindersPath,
        subject,
        updatePath,
        expiredQuery,
        expiredUpdate,
        verificationType
    }) {
        try {
            const today = moment().startOf('day');
            const reminderDays = [30, 15, 7, 3, 1];
    
            const templatePath = path.join(__dirname, '../../App/Views/templateHtml/bankid_reminder.html');
            const template = handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));

            const {englishTranslations, norwegianTranslations } = await bankIdEmailTranslation(verificationType);
           
            const players = await Sys.App.Services.PlayerServices.getAllPlayersData(query, projection);
            
            for (const player of players) {
                const expiryDate = moment(getNestedValue(player, datePath));
                const remindersSent = getNestedValue(player, remindersPath) || [];
                const daysUntilExpiry = expiryDate.diff(today, 'days');
               
                if (reminderDays.includes(daysUntilExpiry) && !remindersSent.includes(daysUntilExpiry)) {
                    try {

                        const lang = player.selectedLanguage === 'en' ? 'english' : 'norwegian';
                        const translations = lang === 'english' ? englishTranslations : norwegianTranslations;
                        //const subject = `Spillorama Bingo: BankID ${translations.verification_reminder}`;
                        
                        // if( player.phone && !player.email ){
                        //     const translationKeys = ['sms_verification_reminder'];
                        //     const translationPairs = translationKeys.map(key => [key, { number1: verificationType, number2: expiryDate.utc().format('DD MMM YYYY [at] HH:mm [UTC]')}]);
                        //     const smsMessage = await Sys.Helper.bingo.getMultipleTranslateData(translationPairs, lang);
                        //     Sys.App.Controllers.advertisementController.sendBulkSMS([player.phone], smsMessage?.sms_verification_reminder, lang);
                        // }else{
                            const html = template({
                                username: player.username,
                                daysRemaining: daysUntilExpiry,
                                expiryDate: expiryDate.utc().format('DD MMM YYYY [at] HH:mm [UTC]'),
                                verificationType: verificationType,
                                translations
                            });
    
                            const info = {
                                from: Sys.Config.App.mailer.defaultFromAddress,
                                to: player.email,
                                subject: `Spillorama Bingo: ${verificationType == "BankID" ? translations.bankid_verification_reminder : translations.id_card_expiry_reminder}`,
                                html
                            };
    
                            await module.exports.sendReminderEmail(info);
                        //}

                        await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
                            { _id: player._id },
                            { $push: { [updatePath]: daysUntilExpiry } }
                        );
    
                        console.log(`Reminder sent to ${player.username} for ${daysUntilExpiry} days remaining`);
                    } catch (err) {
                        console.log(`Failed to send reminder to ${player.username}:`, err);
                    }
                }
            }
    
            if (expiredQuery && expiredUpdate) {
                await Sys.App.Services.PlayerServices.updateManyPlayers(expiredQuery, { $set: expiredUpdate });
                console.log("Expired players updated.");
            }
        } catch (err) {
            console.log("Error in processReminder:", err);
        }
    },

    // Function to check bankid and id card expiry and send reminders, Also used as a Cron
    checkBankIdAndIdCardExpiryAndSendReminders: async function (playerId = null, typeOfVerification = null) {
        try {
            console.log("Running BankID and ID Card expiry check and reminder system...");
            const today = moment().startOf('day').toDate();
            // Check for bankid expiry
            if (!typeOfVerification || typeOfVerification === 'BankID') {
                await module.exports.processReminder({
                    query: {
                        'bankIdAuth.status': 'COMPLETED',
                        'bankIdAuth.expiryDate': { $exists: true, $gte: today }
                    },
                    projection: {
                        _id: 1, username: 1, email: 1, bankIdAuth: 1, selectedLanguage: 1, phone: 1
                    },
                    datePath: 'bankIdAuth.expiryDate',
                    remindersPath: 'bankIdAuth.remindersSent',
                    subject: 'Spillorama Bingo Game: BankID Verification Reminder',
                    updatePath: 'bankIdAuth.remindersSent',
                    expiredQuery: {
                        'bankIdAuth.status': 'COMPLETED',
                        'bankIdAuth.expiryDate': { $exists: true, $lte: today }
                    },
                    expiredUpdate: {
                        'bankIdAuth.status': 'EXPIRED'
                    },
                    verificationType: 'BankID'
                });
            }

            // Check for id card expiry
            if (!typeOfVerification || typeOfVerification === 'IDCard') {
                const query = {
                    isVerifiedByHall: true,
                    'otherData.hallVerification.idExpiryDate': {
                        $exists: true,
                        $gte: today
                    }
                };
                if (playerId) query._id = playerId;
        
                const expiredQuery = {
                    isVerifiedByHall: true,
                    'otherData.hallVerification.idExpiryDate': {
                        $exists: true,
                        $lte: today
                    }
                };
                if (playerId) expiredQuery._id = playerId;
        
                await module.exports.processReminder({
                    query,
                    projection: {
                        _id: 1, username: 1, email: 1, otherData: 1, selectedLanguage: 1, phone: 1
                    },
                    datePath: 'otherData.hallVerification.idExpiryDate',
                    remindersPath: 'otherData.hallVerification.remindersSent',
                    subject: 'Spillorama Bingo Game: ID Card Expiry Reminder',
                    updatePath: 'otherData.hallVerification.remindersSent',
                    expiredQuery,
                    expiredUpdate: {
                        isVerifiedByHall: false
                    },
                    verificationType: 'ID Card'
                });
            }
            
        } catch (error) {
            console.log("Error in checkBankIdAndIdCardExpiryAndSendReminders:", error);
        }
    },

    // Function to delete block rule by super admin only
    deleteBlockRule: async function (req, res) {
        try {
            const { playerId, ruleId } = req.body;
            const language = req.session.details?.language || "norwegian";
            
            // Check if user is super admin
            if (!req.session.details?.isSuperAdmin) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_perform_this_operation"], language) });
            }
            
            const player = await Sys.App.Services.PlayerServices.getSinglePlayerByData({ _id: playerId }, { blockRules: 1 });
            if (!player) {
                return res.json({ status: "fail", message:  await Sys.Helper.bingo.getSingleTraslateData(["player_not_found"], language) });
            }
            const blockRules = player.blockRules || [];
            const ruleExists = blockRules.some(rule => rule._id.toString() === ruleId);
            
            if (!ruleExists) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["block_rule_not_found"], language) });
            }
            
            const result = await Sys.App.Services.PlayerServices.updatePlayerData(
                { _id: playerId },
                { $pull: { blockRules: { _id: ruleId } } }
            );
        
            if (result && result.modifiedCount > 0) {
                return res.json({ status: "success", message: await Sys.Helper.bingo.getSingleTraslateData(["block_rule_deleted_successfully"], language) });
            } else {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            }
        } catch (error) {
            console.log("Error in deleteBlockRule:", error);
            return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
        }
    }
}

async function randomString(length) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = length; i > 0; --i) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

// Helper function to validate email format
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Helper function to validate phone number format (minimum 8 digits)
function isValidPhoneNumber(phone) {
    return /^\d{8,}$/.test(phone);
}

// Helper function to validate username format
function isValidUsername(username) {
    const usernameRegex = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
    return usernameRegex.test(username);
}

// Helper function to parse Excel dates
// Helper function to parse Excel dates
function parseExcelDate(excelDate) {
    const jsDate = new Date((excelDate - 25569) * 86400000);
    return jsDate;
}

function isValidDOB(dateString) {
    console.log("dateString---", dateString)
    // Define accepted formats
    let formats = ["YYYY-MM-DD", "YYYY/MM/DD", "MM-DD-YYYY", "MM/DD/YYYY"];

    // Check if dateString matches any format and is a valid date
    if (!moment(dateString, formats, true).isValid()) {
        console.log("Invalid date format:", dateString);
        return false;
    }

    // Check if the parsed date is on or before today's date
    return moment(dateString).isSameOrBefore(moment(), 'day');
}

function isAlphanumeric(inputString) {
    const alphanumericRegex = /^[a-zA-Z0-9]+$/;
    return alphanumericRegex.test(inputString);
}

function startsWithAlpha(inputString) {
    const alphaRegex = /^[a-zA-Z]/;
    return alphaRegex.test(inputString);
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (err) {
        return false;
    }
}

// Function to download image from URL and return local path
const downloadImage = async (url, filename) => {
    console.log("url and filename", url, filename)
    const imagePath = path.join(__dirname, `../../public/assets/profilePic`, filename);
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
    });
    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);
    return `/assets/profilePic/${filename}`;
};

function splitName(name) {
    let Firstname = '';
    let Lastname = '';
    if (name) {
        const nameParts = name.toString().trim().split(/\s+/); // Split by any whitespace and remove extra spaces

        if (nameParts.length === 2) {
            Firstname = nameParts[0];
            Lastname = nameParts[1];
        } else if (nameParts.length > 2) {
            Firstname = nameParts.slice(0, 2).join(' ');
            Lastname = nameParts.slice(2).join(' ');
        } else {
            Firstname = nameParts[0];
        }
    }
    return { Firstname, Lastname };
}

function extractDynamicSegment(input) {
    const segments = String(input).split('-');

    if (segments.length === 3) {
        const [firstPart, dynamicSegment, lastPart] = segments;

        if (firstPart === '47' && lastPart === '01') {
            return dynamicSegment;
        } else {
            return "";
        }
    } else {
        return "";
    }
}


async function processDuplicates(type, duplicates, recordsByDuplicate, playersToImport) {
    if (duplicates[type]?.size > 0) {
        for (const duplicate of duplicates[type]) {

            const lastIndex = duplicate.lastIndexOf('-');
            const finalName = duplicate.slice(0, lastIndex);
            const hallNumber = duplicate.slice(lastIndex + 1);

            const records = recordsByDuplicate[type]?.get(duplicate) || [];
            for (const record of records) {
                console.log(`Record for ${type} Duplicate:`, record);
                updateImportPlayer(record, hallNumber, type, playersToImport);
            }
        }
    }
}

async function updateImportPlayer(record, hallNumber, type, playersToImport) {

    const { Username, Email, customerNumber, phone } = record;

    // Find player index in playersToImport
    // const playerIndex = playersToImport.findIndex(player =>
    //     player.Username === Username.toLowerCase() &&
    //     player.Email === Email &&
    //     player.customerNumber === customerNumber &&
    //     player.phone === phone &&
    //     player.HallNumber.includes(hallNumber)
    // );

    const typeToFieldMapping = {
        "Username": Username.toLowerCase(),
        "Email": Email,
        "customerNumber": customerNumber,
        "phone": phone
    };

    // Get the value to compare for the given type
    const identifierValue = typeToFieldMapping[type];
    const playerIndex = playersToImport.findIndex(player =>
        player[type] === identifierValue &&
        player.HallNumber.includes(hallNumber)
    );

    if (playerIndex !== -1) {
        // Remove specific HallNumber if multiple exist
        const hallIndex = playersToImport[playerIndex].HallNumber.indexOf(hallNumber);
        if (hallIndex !== -1) {
            playersToImport[playerIndex].HallNumber.splice(hallIndex, 1);

            if (playersToImport[playerIndex].HallNumber.length === 0) {
                // Remove the player from the playersToImport array
                playersToImport.splice(playerIndex, 1);
                console.log("Removed player from playersToImport:", Username, Email, customerNumber, phone);
            }
        }
    }
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}