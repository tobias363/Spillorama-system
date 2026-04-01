var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
const { uploadToCloudinary } = require('../../Helper/cloudinaryUpload');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');
const { date } = require('joi');
const { log } = require('handlebars');
var ETICKETCOLORS = [
    'Small White', 'Large White', 'Small Yellow', 'Large Yellow', 'Small Purple',
    'Large Purple', 'Small Blue', 'Large Blue'
];
let eventEmitter = Sys.App.get('eventEmitter');
const { translate } = require('../../Config/i18n');
module.exports = {

    // [ Game Type ]


    gameType: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Game Type'] || [];
                let stringReplace =req.session.details.isPermission['Game Type'] || [];
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
            }

            const keysArray = [
                "action",
                "game_table",
                "games",
                "game_name",
                "photo",
                "row",
                "column",
                "dashboard",
                "game",
                "previous",
                "next",
                "game_name"
            ];

            let game = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            let reqCount = await Sys.App.Services.GameService.getGameTypeCount();
            console.log('length: ', reqCount);
            reqCount = (reqCount >= 5) ? false : true;
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                reqCount: reqCount,
                gameTypeActive: 'active',
                viewFlag:viewFlag,
                editFlag:editFlag,
                game: game,
                navigation: game
            };
            return res.render('gameType/list', data);
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    getGameType: async function (req, res) {
        try {
            console.log("req.body", req.body, req.params, req.query);
            let order = req.query.order;
            let sort = {};
            // if (order.length) {
            //     let columnIndex = order[0].column;
            //     let sortBy = req.query.columns[columnIndex].data;
            //     sort = {
            //         [sortBy]: order[0].dir == "asc" ? 1 : -1
            //     }
            // }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let reqCount = await Sys.App.Services.GameService.getGameTypeCount(query);

            let data = await Sys.App.Services.GameService.getGameTypeDatatable(query, length, start, sort);

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };
            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGameType: async function (req, res) {
        try {
            let keys = []
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameCount: await Sys.App.Services.GameService.getGameTypeCount() + 1,
                translate: translate,
                navigation: translate
            };
            return res.render('gameType/add', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGameTypePostData: async function (req, res) {
        let keys = ["error_uploading_profile_avatar", "game_create_successfully", "game_not_created"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            console.log('pattern: ', req.body);
            if (req.files) {
                let image = req.files.avatar;
                let photoUrl;
                try {
                    const { url } = await uploadToCloudinary(image);
                    photoUrl = url;
                } catch (uploadErr) {
                    console.log("Cloudinary upload error:", uploadErr);
                    req.flash('error', translate.error_uploading_profile_avatar);
                    return res.redirect('/profile');
                }

                let pattern = (req.body.pattern == 'on') ? true : false;
                var pickLuckyNumber = [];
                if ((await Sys.App.Services.GameService.getGameTypeCount() + 1) == 1 || (await Sys.App.Services.GameService.getGameTypeCount() + 1) == 3) {
                    pickLuckyNumber = [
                        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
                        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
                        '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
                        '31', '32', '33', '34', '35', '36', '37', '38', '39', '30',
                        '41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
                        '51', '52', '53', '54', '55', '56', '57', '58', '59', '60',
                        '61', '62', '63', '64', '65', '66', '67', '68', '69', '70',
                        '71', '72', '73', '74', '75'
                    ];
                } else if ((await Sys.App.Services.GameService.getGameTypeCount() + 1) == 2) {
                    pickLuckyNumber = [
                        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
                        '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'
                    ];
                }

                let game = await Sys.App.Services.GameService.insertGameTypeData({
                    createrId: req.session.details.id,
                    type: "game_" + (await Sys.App.Services.GameService.getGameTypeCount() + 1),
                    name: req.body.name,
                    row: req.body.row,
                    columns: req.body.columns,
                    photo: photoUrl,
                    pickLuckyNumber: pickLuckyNumber,
                    pattern: pattern,
                    // totalNoTickets: req.body.totalNoTickets,
                    // userMaxTickets: req.body.userMaxTickets,
                    rangeMin: req.body.rangeMin,
                    rangeMax: req.body.rangeMax,
                });
                req.flash('success', translate.game_create_successfully);
                return res.redirect('/gameType');
            } else {
                req.flash('error', translate.game_not_created);
                return res.redirect('/gameType');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    editGameType: async function (req, res) {
        try {
            let query = { _id: req.params.id };
            console.log('req.session.details',req.session.details)
            let gameType = await Sys.App.Services.GameService.getGameTypeById(query);
            const keysArray = [
                "action",
                "edit_game",
                "game_name",
                "how_many_rows_allocate_in_a_ticket",
                "how_many_column_allocate_in_a_ticket",
                "pattern",
                "cancel",
                "dashboard",
                "game"
            ];
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                let stringReplace =req.session.details.isPermission['Game Type'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace?.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }

            let game = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameType: gameType,
                gameCount: await Sys.App.Services.GameService.getGameTypeCount() + 1,
                game: game,
                navigation: game,
                editFlag: editFlag
            };
            return res.render('gameType/add', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editGameTypePostData: async function (req, res) {
        try {
            console.log('req data:', req.params.id, req.body);
            let alreadyExist = await Sys.App.Services.GameService.getGameTypeByData({ _id: { $ne: req.params.id }, name: req.body.name });
            if (alreadyExist) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["game_name_already_exists"], req.session.details.language))//'Game Name already exist');
                return res.redirect('/gameType');
            }
            let UpdateGameTwo = await Sys.App.Services.GameService.getGameTypeById(req.params.id);
            console.log('pattern: ', req.body);
            if (UpdateGameTwo != undefined) {
                let pattern = (req.body.pattern == 'on') ? true : false;
                if (req.files && req.files.avatar && req.files.avatar.name) {
                    let image = req.files.avatar;
                    let photoUrl;
                    try {
                        const { url } = await uploadToCloudinary(image);
                        photoUrl = url;
                    } catch (uploadErr) {
                        console.log("Cloudinary upload error:", uploadErr);
                        req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["error_uploading_profile_avatar"], req.session.details.language));
                        return res.redirect('/profile');
                    }
                    let game = await Sys.App.Services.GameService.updateOneGameType({
                        _id: req.params.id
                    }, {
                        name: req.body.name,
                        photo: photoUrl,
                        pattern: pattern,
                        totalNoTickets: req.body.totalNoTickets,
                        userMaxTickets: req.body.userMaxTickets,
                        rangeMin: req.body.rangeMin,
                        rangeMax: req.body.rangeMax,
                    });
                    req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["game_type_updated_successfully"], req.session.details.language));
                    return res.redirect('/gameType');
                } else {
                    let game = await Sys.App.Services.GameService.updateOneGameType({
                        _id: req.params.id
                    }, {
                        name: req.body.name,
                        // row: req.body.row,
                        // columns: req.body.columns,
                        pattern: pattern,
                        totalNoTickets: req.body.totalNoTickets,
                        userMaxTickets: req.body.userMaxTickets,
                        rangeMin: req.body.rangeMin,
                        rangeMax: req.body.rangeMax,
                    });
                    req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["game_type_updated_successfully"], req.session.details.language))//'Game Updated successfully');
                    return res.redirect('/gameType');
                }
            } else {
                req.flash('error', 'No Game found');
                return res.redirect('/gameType');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteGameType: async function (req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleGameType({ _id: req.body.id });
            if (game || game.length > 0) {
                await Sys.App.Services.GameService.deleteGameType(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameType: async function (req, res) {
        try {

            let query = { _id: req.params.id };
            let gameType = await Sys.App.Services.GameService.getGameTypeById(query);


            const keysArray = [
                "view_game",
                "game_name",
                "how_many_rows_allocate_in_a_ticket",
                "how_many_column_allocate_in_a_ticket",
                "pattern",
                "cancel",
                "dashboard",
                "game"
            ];

            let game = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameTypeActive: 'active',
                gameType: gameType,
                game: game,
                navigation: game,
            };
            return res.render('gameType/view', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    // [ New Documention wise ] Game Management DropDowm
    viweGameManagement: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let startFlag = true;
            let pauseFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Games Management'] || [];
                let stringReplace =req.session.details.isPermission['Games Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Games Management'];

                if (stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }

                if (stringReplace.indexOf("start") == -1) {
                    startFlag = false;
                }

                if (stringReplace.indexOf("pause") == -1) {
                    pauseFlag = false;
                }

            }
            let keys = [
                "choose_a_game",
                "choose_game_type",
                "table",
                "view_schedule",
                "delete_schedule",
                "add_close_day",
                "all",
                "active",
                "upcoming",
                "search_game_name",
                "search",
                "add_special_game",
                "create_daily_schedule",
                "sure_want_to_stop_game",
                "not_be_able_to_recover_game",
                "yes",
                "no",
                "stop_after_completing_running_game",
                "game_will_stop_after_completing_running_game",
                "sorry_game_not_stopeed",
                "game_not_stopped",
                "stopped",
                "cancelled",
                "not_be_able_to_resume_if_stopped",
                "show",
                "entries",
                "previous",
                "next",
                "add",
                "are_you_sure",
                "not_able_to_recover_after_delete",
                "yes_delete",
                "no_cancle",
                "deleted",
                "game_delete_success",
                "game_not_deleted_as_about_to_start",
                "game_not_deleted",
                "view_game",
                "edit_game",
                "stop_game",
                "add_close_day",
                "you_will_not_be_able_to_recover_this_schedule",
                "schedule_delete_success",
                "schedule_not_deleted_as_about_to_start",
                "schedule_not_deleted",
                "transfer_hall_access",
                "master_hall",
                "update",
                "cancel",
                "select",
                "are_you_sure",
                "do_you_want_to_transfer_hall_access",
                "success",
                "cancel_button",
                "stop_schedule",
                "edit_schedule",
                "auto_stop",
                "active",
                "upcoming",
                "special_game",
                "normal_game"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            //let shiv = await redisClient.get('game3')
            //console.log("shiv", shiv);
            let gameData = [];
            let dataGame = {};
            for (let i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                DataOfGames: gameData,
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                startFlag: startFlag,
                pauseFlag: pauseFlag,
                gameManage: translate,
                navigation: translate,
                current_language: req.session.details.language
            };
            
            return res.render('GameManagement/game', data);


        } catch (error) {
            Sys.Log.error('Error in viweGameManagement: ', error);
            return new Error(error);
        }
    },


    viweGameManagementDetail: async function (req, res) {
        try {
            let gameType;
            let keys = ["choose_a_game","choose_game_type",
            "daily_schedule_id",
            "start_date_and_end_date",
            "time_slot",
            "group_of_halls",
            "master_hall",
            "game_type",
            "status",
            "action",
            "game_id",
            "game_name",
            "start_date_and_time",
            "end_date_and_time",
            "prize_of_lucky_number",
            "notification_start_time",
            "group_of_halls",
            "total_seconds_to_display_ball",
            "number_of_minimum_tickets_to_start_the_game",
            "status",
            "action",
            "game_id",
            "game_name",
            "start_date_and_end_date",
            "group_of_hall",
            "status",
            "action",
            "game_id",
            "pattern_name",
            "pattern_price",
            "action",
            "game_id",
            "pattern_name",
            "pattern_price",
            "action",
            "pattern_name_prize",
            "bet_multiplier",
            "bet_amount",
            "game4_is_bot_game",
            "game4_bot_count",
            "total_bot_game_to_run",
            "game_4_second_1_18",
            "game_4_second_19_end",
        ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            let Game;
            if (gameType.type == 'game_4') {
                Game = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_4' });
            } else if (gameType.type == 'game_5') {
                Game = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_5' });
            } else {
                Game = 0;
            }

            let addBtn = (Game >= 1) ? false : true;
            
            let theadField;
            if (gameType.type == "game_1") {
                theadField = [
                    translate.daily_schedule_id,//'Daily Schedule Id',
                    translate.start_date_and_end_date,//'Start Date and End Date',
                    translate.time_slot,//'Time Slot',
                    translate.group_of_halls,//'Group Of Halls',
                    translate.master_hall,//'Master Hall',
                    translate.game_type,//'Game Type',
                    translate.status,//'Status',
                    translate.action,//'Action'
                    // 'Game Id',
                    // 'Game Type',
                    // 'Start Date and Time',
                    // 'Game Name',
                    // 'Ticket Color/Type',
                    // 'Seconds',
                    // 'Action'
                ]
            } else if (gameType.type == "game_2") {

                theadField = [
                    translate.game_id, //'Game Id',
                    translate.game_name, //'Game Name',
                    translate.start_date_and_time, //'Start Date and Time',
                    translate.end_date_and_time,//'End Date and Time',
                    // 'Price Per Ticket',
                    translate.prize_of_lucky_number,//'Prize of Lucky Number',
                    translate.notification_start_time,//'Notification Start Time',
                    translate.group_of_halls,//'Group Of Halls',
                    translate.total_seconds_to_display_ball,//'Total Seconds to display ball',
                    translate.number_of_minimum_tickets_to_start_the_game,//'Number of minimum tickets to start the game',
                    translate.status,//'Status',
                    translate.action//'Action'
                ]

                //Old
                // theadField = [
                //     'Game Id',
                //     'Game Type',
                //     'Start Date and Time',
                //     'Ticket price',
                //     'Jack pot number',
                //     'Price in number',
                //     'Total numbers of tickets sold',
                //     'Total Earned from tickets sold',
                //     'Total Winning in the game',
                //     'Seconds',
                //     'Action'
                // ]

            } else if (gameType.type == "game_3") {
                theadField = [
                    translate.game_id,//'Game Id',
                    translate.game_name,//'Game Name',
                    translate.start_date_and_end_date,//'Start Date and End Date',
                    translate.group_of_hall,//'Group of Hall',
                    translate.status,//'Status',
                    translate.action//'Action'
                ]
            } else if (gameType.type == "game_4") {
                theadField = [
                    translate.game_id,//'Game Id',
                    translate.pattern_name,//'Pattern Name',
                    translate.pattern_price,//'Pattern Price',
                    translate.action//'Action'
                ]
            } else if (gameType.type == "game_5") {
                theadField = [
                    translate.game_id,//'Game Id',
                    translate.pattern_name,//'Pattern Name',
                    translate.pattern_price,//'Pattern Price',
                    translate.action,//'Action'
                ]
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            let data = {
                gameData: gameType,
                theadField: theadField,
                addBtn: addBtn,
                Game: Game
            };
            return res.send(data);

        } catch (error) {
            Sys.Log.error('Error in viweGameManagementDetail: ', error);
            return new Error(error);
        }
    },


    getGameManagementDetailList: async function (req, res) {
        try {
            //console.log("getGameManagementDetailList calling", req.query, req.query.gameType);
            let order = req.query.order;
            let sort = {};
            if (req.query.gameType !== "game_2" && req.query.gameType != "game_1") {
                if (order.length) {
                    let columnIndex = order[0].column;
                    let sortBy = req.query.columns[columnIndex].data;
                    sort = {
                        [sortBy]: order[0].dir == "asc" ? 1 : -1
                    }
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;
            let query = {};
            if (req.query.gameType == "game_1") {
                // gameName = "Game1";
                // query = { gameType: req.query.gameType, status: "active", isMasterGame: true , isAllSubGamesCompleted:false };
                query = { isSavedGame: false, status: { $in: ["active", "running"] } };
            } else if (req.query.gameType == "game_2") {
                gameName = "Game2";
                query = { gameType: "game_2", status: { $in: ["active", "running"] } };
            } else if (req.query.gameType == "game_3") {
                gameName = "Game3";
                // query = { gameName: gameName, status: "active" };
                query = { gameType: "game_3", status: { $in: ["active", "running"] } };
            } else if (req.query.gameType == "game_4") {
                gameName = "Game4";
                query = { gameName: gameName, status: "active" };
            } else if (req.query.gameType == "game_5") {
                query = { gameName: "Game5", status: "active" };
            }

            if (search != '') {
                if (req.query.gameType == "game_1") {
                    query = { dailyScheduleId: { $regex: '.*' + search + '.*', $options: 'i' }, isSavedGame: false, status: { $in: ["active", "running"] } };
                } else {
                    query = { gameName: { $regex: '.*' + search + '.*', $options: 'i' }, gameType: req.query.gameType, status: { $in: ["active", "running"] } };
                }
            }



            //console.log(" AAAAAAAAA getGameManagementDetailList ", JSON.stringify(query));
            let reqCount;
            let data;
            if (req.query.gameType == "game_2" || req.query.gameType == "game_3") {
                //Agent should only see games in his cureent logged in hall
                if (req.session.details.role == 'agent') {
                    query['allHallsId'] = req.session.details.hall[0].id;
                }
                query.stopGame = false;
                reqCount = await Sys.App.Services.GameService.getSelectedParentGameCount(query);
                data = await Sys.App.Services.GameService.getParentGameDatatable(query, length, start, { status: -1 });
            } else {
                if (req.query.gameType == "game_1") {
                    //Agent should only see games in his cureent logged in hall
                    if (req.session.details.role == 'agent') {
                        query['halls'] = req.session.details.hall[0].id;
                    }
                    query.stopGame = false;
                    if (req.query.gameStatus && (req.query.gameStatus == "active" || req.query.gameStatus == "upcoming")) {
                        query.status = (req.query.gameStatus == "active") ? "running" : "active";
                    }
                    reqCount = await Sys.App.Services.scheduleServices.getDailySchedulesCount(query);
                    data = await Sys.App.Services.scheduleServices.getDailySchedulesDatatable(query, length, start, { status: -1 });
                } else {
                    reqCount = await Sys.App.Services.GameService.getSelectedGameCount(query);
                    data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);
                }
            }
            console.log("reqCount & data", reqCount, data.length)
            let gameData = [],
                patternName = [];
            if (req.query.gameType == "game_1") {

                for (let i = 0; i < data.length; i++) {
                    let dataGame = {}
                    let isMaster = true;
                    if (req.session.details.role == 'agent') {
                        if (data[i].masterHall.id !== req.session.details.hall[0].id) {
                            isMaster = false
                        }
                    }
                    dataGame = {
                        _id: data[i]._id,
                        dailyScheduleId: data[i].dailyScheduleId,
                        startDate: data[i].startDate,
                        endDate: data[i].endDate,
                        groupHalls: data[i].groupHalls,
                        masterHall: data[i].masterHall,
                        status: data[i].status,
                        isStop: data[i].stopGame,
                        timeSlot: data[i].startTime + " - " + data[i].endTime,
                        isMaster: isMaster,
                        specialGame: data[i].specialGame,
                        role: req.session.details.role,
                        isAutoStopped: data[i]?.otherData?.isAutoStopped
                    }
                    if(req.session.details.role != 'agent'){
                        //const masterHallId = data[i].masterHall.id;
                        dataGame.selectedHalls = data[i].groupHalls
                            .flatMap(group => group.selectedHalls);
                            //.filter(hall => hall.id !== masterHallId);
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_2") {

                for (let i = 0; i < data.length; i++) {
                    // let dataGame = {};
                    // if (data[i]?.purchasedTickets?.length > 0) {

                    //     dataGame = {
                    //         _id: data[i]._id,
                    //         gameNumber: data[i].gameNumber,
                    //         gameName: data[i].gameName,
                    //         startDate: data[i].startDate,
                    //         endDate: data[i].endDate,
                    //         notificationStartTime: data[i].notificationStartTime,
                    //         luckyNumberPrize: data[i].luckyNumberPrize,
                    //         groupHalls: data[i].groupHalls,
                    //         seconds: Number(data[i].seconds / 1000),
                    //         status: data[i].status,
                    //         minTicketCount: data[i].minTicketCount,
                    //     }
                    // } else {
                    //     dataGame = {
                    //         _id: data[i]._id,
                    //         gameNumber: data[i].gameNumber,
                    //         gameName: data[i].gameName,
                    //         startDate: data[i].startDate,
                    //         endDate: data[i].endDate,
                    //         ticketPrice: data[i].ticketPrice,
                    //         notificationStartTime: data[i].notificationStartTime,
                    //         luckyNumberPrize: data[i].luckyNumberPrize,
                    //         groupHalls: data[i].groupHalls,
                    //         seconds: Number(data[i].seconds / 1000),
                    //         status: data[i].status,
                    //         minTicketCount: data[i].minTicketCount,
                    //     }
                    // }
                    gameData.push({
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        gameName: data[i].gameName,
                        startDate: data[i].startDate,
                        endDate: data[i].endDate,
                        ticketPrice: data[i].ticketPrice,
                        notificationStartTime: data[i].notificationStartTime,
                        luckyNumberPrize: data[i].luckyNumberPrize,
                        groupHalls: data[i].groupHalls,
                        seconds: Number(data[i].seconds / 1000),
                        status: data[i].status,
                        minTicketCount: data[i].minTicketCount,
                        gameType: data[i].gameType
                    });
                }

            } else if (req.query.gameType == "game_3") {
                for (let i = 0; i < data.length; i++) {
                    let dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        gameName: data[i].gameName,
                        startDate: data[i].startDate,
                        endDate: data[i].endDate,
                        groupHalls: data[i].groupHalls,
                        status: data[i].status,
                        gameType: data[i].gameType
                    }
                    gameData.push(dataGame);
                }
            } else if (req.query.gameType == "game_4") {

                let ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });

                if (data.length > 0) {

                    if (ptrn) {

                        for (let j = 0; j < ptrn.length; j++) {
                            let r = 1;
                            patternName.push({
                                patternName: ptrn[j].patternName,
                                patternPrice: data[0].patternNamePrice[0]['Pattern' + (j + r)],
                            });
                        }

                        for (let i = 0; i < data.length; i++) {
                            //console.log('data: ', data);
                            let dataGame = {
                                _id: data[i]._id,
                                gameNumber: data[i].gameNumber,
                                patternName: patternName,
                                patternPrice: patternName,
                                gameType: data[i].gameType
                            }
                            gameData.push(dataGame);
                        }

                    }

                }

            } else if (req.query.gameType == "game_5") {

                if (data.length > 0) {
                    if (data[0].patternNamePrice && data[0].patternNamePrice.length > 0) {
                        let patternsData = data[0].patternNamePrice[0];
                        ptrn = [];
                        for (let key in patternsData) {
                            console.log(key, patternsData[key]);
                            ptrn.push({
                                patternName: key.replace("_", " "),
                                patternPrice: patternsData[key]
                            })
                        }
                    } else {
                        ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_5" });
                    }

                    if (ptrn) {

                        for (let i = 0; i < data.length; i++) {
                            //console.log('data: ', data);
                            let dataGame = {
                                _id: data[i]._id,
                                gameNumber: data[i].gameNumber,
                                patternName: ptrn,
                                patternPrice: ptrn,
                                gameType: data[i].gameType
                            }
                            gameData.push(dataGame);
                        }

                    }

                }

            }



            function compareValues(key, order = 'asc') {
                return function innerSort(a, b) {
                    if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                        // property doesn't exist on either object
                        return 0;
                    }

                    const varA = (typeof a[key] === 'string') ?
                        a[key].toUpperCase() : a[key];
                    const varB = (typeof b[key] === 'string') ?
                        b[key].toUpperCase() : b[key];

                    let comparison = 0;
                    if (varA > varB) {
                        comparison = 1;
                    } else if (varA < varB) {
                        comparison = -1;
                    }
                    return (
                        (order === 'desc') ? (comparison * -1) : comparison
                    );
                };
            }

            if (req.query.gameType !== "game_2") {
                let keyData = Object.keys(sort);
                let valueData = Object.values(sort);

                if (valueData[0] == 1) {
                    gameData.sort(compareValues(keyData));
                } else if (valueData[0] == -1) {
                    gameData.sort(compareValues(keyData, 'desc'));
                }
            }
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            //console.log("data:::: getGameManagementDetailList:::::::::", gameData.length)

            return res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    addGameManagement: async function (req, res) {
        try {
            //console.log("addGame", req.params.id);
            let keys = [
                "dashboard",
                "add",
                "edit_text",
                "save_as",
                "enter_name_of_game",
                "save",
                "please",
                "game_name",
                "enter",
                "start_date_and_time",
                "start_date",
                "end_date",
                "end_date_and_time",
                "start_time",
                "end_time",
                "select",
                "group_hall",
                "choose",
                "minimum_ticket_count",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "no",
                "yes",
                "how_many_bot_game_to_run",
                "total_bot_game_to_run",
                "is_bot_game",
                "add_sub_game",
                "submit",
                "cancel",
                "time_period",
                "sub_game_name",
                "ticket_price",
                "jackpot_number_and_prize",
                "seconds",
                "save_game",
                "select_one_goh",
                "selct_atleast_one_day_in_week",
                "add_atleast_one_subgame",
                "overall_percentage_increase",
                "min_day_gap_7_days",
                "end_time_must_be_greater_than_start_time",
                "start_time_must_be_less_than_end_time",
                "created",
                "game_saved_success",
                "error",
                "in_cash",
                "in_percent",
                "add_group",
                "add_pattern",
                "group_name",
                "pattern_group",
                "atleast_one_goh_in_subgames",
                "min_ticket_count_should_be_greater_20",
                "remove",
                "pattern_name_prize",
                "bet_multiplier",
                "bet_amount",
                "game4_is_bot_game",
                "game4_bot_count",
                "total_bot_game_to_run",
                "game_4_second_1_18",
                "game_4_second_19_end",
                "game5_patterns_multi",
                "game5_second_validation",
                "game5_total_ball_to_withdraw",
                "game5_ball_withdraw_validation",
                "game5_ball_second_for_bot",
                "game5_ball_second_for_bot_validation",
                "total_second_to_display_single_ball"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let addFlagSave = true;

            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Save Game List'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlagSave = false;
                }

            }


            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });

            let ptrn;
            if (gameType.type == 'game_4') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
                let arr = ['priceOne', 'priceTwo', 'priceThree', 'priceFour', 'priceFive', 'priceSix', 'priceSeven', 'priceEight', 'priceNine', 'priceTen', 'priceEleven', 'priceTwelve', 'priceThirteen', 'priceFourteen', 'priceFifteen']

                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                }
            } else if (gameType.type == 'game_3') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_3" });
            } else if (gameType.type == 'game_5') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_5" });
            }
            console.log('ptrn', ptrn);

            let hallArray;
            let agentHallArray;
            if (req.session.details.role == 'agent') {
                let agentId = await Sys.Helper.bingo.obId(req.session.details.id);
                agentHallArray = await Sys.App.Services.HallServices.getByData({ 'agents._id': agentId });
            } else {
                hallArray = await Sys.App.Services.HallServices.getByData();
            }

            let groupHallArray;
            let agentGroupHallArray;
            if (req.session.details.role == 'agent') {
                let agentId = await Sys.Helper.bingo.obId(req.session.details.id);
                agentGroupHallArray = await Sys.App.Services.GroupHallServices.getGroupHall({ 'agents.id': agentId });
            } else {
                groupHallArray = await Sys.App.Services.GroupHallServices.getGroupHalls({ "status": "active" });
            }

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });

            // [ Row and Color ]
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            let patternListing = await Sys.App.Services.patternServices.getGamePatternData({ _id: { $in: rows } }, { isTchest: 1, isMys: 1, patternName: 1, patType: 1, isJackpot: 1, isGameTypeExtra: 1, isLuckyBonus: 1 });
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                let rowsData = [];
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    if (patternListing.length > 0) {
                        let index = patternListing.findIndex(e => e._id == subGameList[s].allPatternRowId[r].toString());
                        if (index !== -1) {
                            rowsData.push({ name: patternListing[index].patternName, type: patternListing[index].patType, isMys: patternListing[index].isMys, isTchest: patternListing[index].isTchest, isJackpot: patternListing[index].isJackpot, isGameTypeExtra: patternListing[index].isGameTypeExtra, isLuckyBonus: patternListing[index].isLuckyBonus })
                        }
                    }
                }
                obj.rows = rowsData;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;
            }


            //console.log("subGameColorRow", subGameColorRow)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                gameData: gameType,
                patternData: ptrn,
                pattern: ptrn,
                groupHallArray: groupHallArray,
                hallArray: hallArray,
                subGameList: subGameList,
                subGameColorRow: JSON.stringify(subGameColorRow),
                slug: 'Add',
                agentHallArray: agentHallArray,
                addFlagSave: addFlagSave,
                translate: translate,
                navigation: translate
            };
            if (gameType.type != 'game_3') {
                return res.render('GameManagement/gameAdd', data);
            } else if (gameType.type == 'game_3') {
                return res.render('GameManagement/game3Add', data);
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGameManagementPostData: async function (req, res) {
        try {
            let keys = [
                "add_atleast_one_subgame",
                "select_one_goh",
                "game_not_created",
                "game_created_success"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("addGamePostData params", req.params, req.params.typeId, req.params.type);
            console.log("addGamePostData: ", req.body);
            //let randomNumber = Math.floor(100000 + Math.random() * 900000);

            let timeZone = req.body.ctimezone;
            let startTime = req.body.start_date;
            if (req.body.start_date) {
                startTime = new Date(req.body.start_date);
                startTime = moment.tz(startTime, timeZone);
                startTime.utc().toDate();
            }
            let graceTime = req.body.graceTime;
            if (req.body.grace_time) {
                // graceTime = new Date(req.body.graceTime);
                graceTime = moment.tz(req.body.grace_time, timeZone);
                graceTime.utc().toDate();
            }

            console.log("timezone,startTime, graceTime", timeZone, startTime, graceTime)

            var ID = Date.now()
            var createID = dateTimeFunction(ID);

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
            var game;

            if (req.params.type == "game_1") {
                let storeGamesData = [];
                let trafficLightOption = [];
                let sumOfAllTickets = 0;
                // For Single Game
                if (typeof (req.body.gameNameSelect) === 'string') {

                    // start 8 color of single inputs 
                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    // console.log(" eightColorValues eightColorValues eightColorValues :",eightColorValues)

                    // console.log("eightColorInputRowsName eightColorInputRowsName aaaaaaaaaaaaaaa :",eightColorInputRowsName)
                    // console.log("eightColorInputValues eightColorInputValues bbbbbbbbbbbbbbb :",eightColorInputValues)

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];

                    let sumOfAllTicketsSubGames = 0;

                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);



                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                            //console.log("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa : ",req.body[[subGameType] + '__elvis3Color'])
                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);

                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                        }


                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }

                        sumOfAllTickets += (ticketCount * 1);
                        sumOfAllTicketsSubGames += (ticketCount * 1);

                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });


                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        console.log(" subGameRowData subGameRowData :", subGameRowData)
                        console.log("  subGameId subGameId :" + subGameId)

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                isLuckyBonus: rowPattern[j].isLuckyBonus
                            }

                            console.log(" ([subGameType] + [rowPattern[j].patType] in req.body) :", req.body[[subGameType] + [rowPattern[j].patType]], " arrTicketColorType[i] arrTicketColorType[i] : ", arrTicketColorType[i])

                            console.log(" [subGameType] : ", [subGameType], " [rowPattern[j].patType] : ", [rowPattern[j].patType])

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])
                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    }

                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;
                                    //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])
                                    tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);

                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    }

                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);

                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        sumOfAllTicketsSubGames: sumOfAllTicketsSubGames,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate,

                        //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        console.log(" arrSameColorType arrSameColorType : : :")
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        console.log(" rowPattern rowPattern rowPattern if : ", rowPattern)


                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isLuckyBonus: rowPattern[j].isLuckyBonus

                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            tmpObj.rowKey = rowPattern[j].patType;
                            tmpObj.rowName = rowPattern[j].name;

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            gameColorsCmbName: subGameType + " " + nameColor1 + " & " + nameColor2,
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];

                        let ticketColorTypesNo = [];

                        let sumOfAllTicketsSubGames = 0;

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);

                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                            }


                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }

                            sumOfAllTickets += (ticketCount * 1);
                            sumOfAllTicketsSubGames += (ticketCount * 1);

                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });



                            //saveObj[ColorName] 
                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            console.log(" rowPattern rowPattern rowPattern else : ", rowPattern)
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + [rowPattern[j].patType]])

                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        }
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;
                                        //tmpObj[rowPattern[j].patType] = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]])

                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        }

                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);

                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            sumOfAllTicketsSubGames: sumOfAllTicketsSubGames,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                            //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus
                                }

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                tmpObj.rowKey = rowPattern[j].patType;
                                tmpObj.rowName = rowPattern[j].name;

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                gameColorsCmbName: subGameType + " " + nameColor1 + " & " + nameColor2,
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof (hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof (req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }


                console.log(" storeGamesData storeGamesData storeGamesData : ", storeGamesData)

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, //req.body.grace_time,
                    minTicketCount: (sumOfAllTickets * 1),
                    totalNoTickets: (sumOfAllTickets * 1),
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false,
                    mainGameName: req.body.mainGameName,
                });

                console.log("storeGamesData game: ", storeGamesData, game);

                for (let o = 0; o < storeGamesData.length; o++) {
                    let subID = Date.now()
                    let subCreateID = dateTimeFunction(subID);
                    let SubGameAdd = await Sys.App.Services.GameService.insertGameData({
                        gameMode: req.body.gameMode,
                        gameName: 'Game1',
                        gameNumber: subCreateID + '_G1',
                        gameType: req.params.type,
                        status: "active",
                        day: req.body.day,
                        gameTypeId: req.params.typeId,
                        createrId: req.session.details.id,
                        startDate: startTime,//req.body.start_date,
                        graceDate: graceTime, //req.body.grace_time,
                        minTicketCount: storeGamesData[o].sumOfAllTicketsSubGames,
                        totalNoTickets: storeGamesData[o].sumOfAllTicketsSubGames,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        seconds: req.body.seconds * 1000,
                        trafficLightExtraOptions: trafficLightOption,
                        subGames: storeGamesData[o],
                        halls: hallArray,
                        allHallsId: allHallTabaleId,
                        masterHall: masterObj,
                        isMasterGame: false,
                        parentGameId: game._id,
                        isSubGame: true,
                        mainGameName: req.body.mainGameName,
                    });

                }


            } else if (req.params.type == "game_2") {
                let endTime = '', startTime = '';
                if (req.body.end_date) {
                    // endDate = moment.tz(req.body.end_date, timeZone);
                    // endDate.utc().toDate();
                    endTime = req.body.end_date;
                }
                if (req.body.start_date) {
                    // startDate = moment.tz(req.body.start_date, timeZone);
                    // startDate.utc().toDate();
                    startTime = req.body.start_date;
                }
                if (!req.body.subGame) {
                    req.flash('error', translate.add_atleast_one_subgame);
                    return res.redirect('/gameManagement');
                } else {
                    req.body.subGame = req.body.subGame.map(function (subGame) {
                        //Price Nine
                        if (parseFloat(subGame.priceNine) > 0) {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNine),
                                isCash: true
                            }
                        } else {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNinePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceNinePercent;

                        //Price Ten
                        if (parseFloat(subGame.priceTen) > 0) {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTen),
                                isCash: true
                            }
                        } else {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTenPercent;

                        //Price Eleven
                        if (parseFloat(subGame.priceEleven) > 0) {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceEleven),
                                isCash: true
                            }
                        } else {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceElevenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceElevenPercent;

                        //Price Twelve
                        if (parseFloat(subGame.priceTwelve) > 0) {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelve),
                                isCash: true
                            }
                        } else {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelvePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTwelvePercent;

                        //Price Thirteen
                        if (parseFloat(subGame.priceThirteen) > 0) {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteen),
                                isCash: true
                            }
                        } else {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceThirteenPercent;

                        //Price 14 to 21
                        if (parseFloat(subGame.priceFourteenToTwentyone) > 0) {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyone),
                                isCash: true
                            }
                        } else {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyonePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceFourteenToTwentyonePercent;

                        console.log("subGame after process", subGame);
                        return subGame;
                    })
                }
                let groupHalls = [];
                if (req.body.groupHalls) {
                    if (Array.isArray(req.body.groupHalls)) {
                        groupHalls = req.body.groupHalls;
                    } else {
                        groupHalls = [req.body.groupHalls];
                    }
                } else {
                    req.flash('error', translate.select_one_goh);
                    return res.redirect('/gameManagement');
                }
                console.log("Sub Game in Game 2", req.body.subGame);
                // let halls = req.body.halls;
                let grpHalls = [];
                let hallsArray = [];
                for (let i = 0; i < groupHalls.length; i++) {
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id.toString());
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            // status:grpHallsData.status,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                        }
                        grpHalls.push(grpArray);
                    }
                }

                // for bot game
                if (req.body.isBotGame == "Yes") {
                    if (hallsArray.length > 0) {
                        for (let h = 0; h < hallsArray.length; h++) {
                            let botCount = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ userType: "Bot", 'hall.id': hallsArray[h] });
                            console.log("botCount in game creation", botCount, hallsArray[h]);
                            if (botCount <= 0) {
                                Sys.Game.Common.Controllers.PlayerController.createBotPlayers({ id: hallsArray[h] }, { hallId: hallsArray[h], count: 500 });
                                break;
                            }
                        }
                    }
                }
                // for bot game

                console.log('endTime', endTime);
                let query = { _id: req.params.typeId };
                let gameType = await Sys.App.Services.GameService.getGameTypeById(query);

                game = await Sys.App.Services.GameService.insertParentGameData({
                    gameMode: req.body.gameMode,
                    gameName: req.body.mainGameName,  //gameName: 'Game2',
                    gameNumber: createID + '_G2',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: startTime,
                    endDate: endTime,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    totalNoPurchasedTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    groupHalls: grpHalls,
                    allHallsId: hallsArray,
                    days: req.body.days,
                    isParent: true,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    },
                    subGames: req.body.subGame,
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    //'otherData.botgamePotAmount': (req.body.isBotGame == "Yes") ? +req.body.botgamePotAmount : 0,
                    //'otherData.botTicketCount': (req.body.isBotGame == "Yes") ? +req.body.botTicketCount : 0,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.totalBotGamePlayed': 0,
                    'otherData.closeDay': []
                });

            } else if (req.params.type == "game_3") {
                var patternGroupNumberPrize = [];

                let gameType = await Sys.App.Services.GameService.getGameTypeById({ type: 'game_3' });
                let graceTime = req.body.end_date;
                graceTime = moment.tz(req.body.end_date, timeZone);
                graceTime.utc().toDate();
                console.log('graceTime', graceTime, startTime);
                let groupHalls = [];
                if (req.body.groupHalls) {
                    groupHalls = req.body.groupHalls;
                } else {
                    req.flash('error', 'Please Select atleast one group of halls');
                    return res.redirect('/gameManagement');
                }
                // let halls = req.body.halls;
                let grpHalls = [];
                let hallsArray = [];
                for (let i = 0; i < groupHalls.length; i++) {
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        // let hallsArray = [];
                        // for (let j = 0; j < halls.length; j++) {
                        //     if(i == j){
                        //         if(!Array.isArray(halls[j])){
                        //             hallsArray = [halls[j]];
                        //         }else{
                        //             hallsArray = halls[j];
                        //         }
                        //         break;
                        //     }
                        // }
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id);
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            status: grpHallsData.status,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                        }
                        grpHalls.push(grpArray);
                    }
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game3',
                    gameNumber: createID + '_G3',
                    gameType: req.params.type,
                    status: "active",
                    // day: req.body.day,
                    columns: gameType.columns,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, // req.body.grace_time,
                    endDate: graceTime,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: patternGroupNumberPrize,
                    groupHalls: grpHalls,
                    allHallsId: hallsArray,
                    seconds: req.body.seconds * 1000,
                    'otherData.closeDay': []
                });

            } else if (req.params.type == "game_4") {

                // [ String To Number ]
                let graceTime = req.body.end_date;
                graceTime = moment.tz(req.body.end_date, timeZone);
                graceTime.utc().toDate();
                var newArrayBetAmount = req.body.betAmount.map(function (x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }
                console.log(">>>>", {
                    gameMode: req.body.gameMode,
                    gameName: 'Game4',
                    gameNumber: createID + '_G4',
                    gameType: req.params.type,
                    status: "active",
                    days: req.body.days,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, // req.body.grace_time,
                    endDate: graceTime,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    totalNoTickets: 4,
                    betAmount: req.body.betAmount,
                    ticketPrice: 1, //req.body.ticketPrice,
                    betMultiplier: req.body.betMultiplier,
                    betData: json,
                    seconds2: req.body.seconds2 * 1000,
                    seconds: req.body.seconds * 1000,
                    patternNamePrice: {
                        'Pattern1': req.body.priceOne,
                        'Pattern2': req.body.priceTwo,
                        'Pattern3': req.body.priceThree,
                        'Pattern4': req.body.priceFour,
                        'Pattern5': req.body.priceFive,
                        'Pattern6': req.body.priceSix,
                        'Pattern7': req.body.priceSeven,
                        'Pattern8': req.body.priceEight,
                        'Pattern9': req.body.priceNine,
                        'Pattern10': req.body.priceTen,
                        'Pattern11': req.body.priceEleven,
                        'Pattern12': req.body.priceTwelve,
                        'Pattern13': req.body.priceThirteen,
                        'Pattern14': req.body.priceFourteen,
                        'Pattern15': req.body.priceFifteen
                    },
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.totalBotGamePlayed': 0,
                    'otherData.closeDay': []
                });

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game4',
                    gameNumber: createID + '_G4',
                    gameType: req.params.type,
                    status: "active",
                    days: req.body.days,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, // req.body.grace_time,
                    endDate: graceTime,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    totalNoTickets: 4,
                    betAmount: req.body.betAmount,
                    ticketPrice: 1, //req.body.ticketPrice,
                    betMultiplier: req.body.betMultiplier,
                    betData: json,
                    seconds2: req.body.seconds2 * 1000,
                    seconds: req.body.seconds * 1000,
                    patternNamePrice: {
                        'Pattern1': req.body.priceOne,
                        'Pattern2': req.body.priceTwo,
                        'Pattern3': req.body.priceThree,
                        'Pattern4': req.body.priceFour,
                        'Pattern5': req.body.priceFive,
                        'Pattern6': req.body.priceSix,
                        'Pattern7': req.body.priceSeven,
                        'Pattern8': req.body.priceEight,
                        'Pattern9': req.body.priceNine,
                        'Pattern10': req.body.priceTen,
                        'Pattern11': req.body.priceEleven,
                        'Pattern12': req.body.priceTwelve,
                        'Pattern13': req.body.priceThirteen,
                        'Pattern14': req.body.priceFourteen,
                        'Pattern15': req.body.priceFifteen
                    },
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.totalBotGamePlayed': 0,
                    'otherData.closeDay': []
                });
                if (game?.otherData?.isBotGame) {
                    Sys.App.get('eventEmitter').emit('game4botcheckup', { botPlay: true })
                }

            } else if (req.params.type == "game_5") {

                let graceTime = req.body.end_date;
                graceTime = moment.tz(req.body.end_date, timeZone);
                graceTime.utc().toDate();

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game5',
                    gameNumber: createID + '_G5',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    totalNoTickets: 4,
                    ticketPrice: 0,
                    seconds: req.body.seconds * 1000,
                    days: req.body.days,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, // req.body.grace_time,
                    endDate: graceTime,
                    'otherData.withdrawableBalls': req.body.withdrawableBalls,
                    patternNamePrice: {
                        'Jackpot_1': req.body.Jackpot1,
                        'Jackpot_2': req.body.Jackpot2,
                        'Bonus_1': req.body.Bonus1,
                        'Bonus_2': req.body.Bonus2,
                        'Bonus_3': req.body.Bonus3,
                        'Bonus_4': req.body.Bonus4,
                        'Bonus_5': req.body.Bonus5,
                        'Bonus_6': req.body.Bonus6,
                        'Bonus_7': req.body.Bonus7,
                        'Bonus_8': req.body.Bonus8,
                        'Bonus_9': req.body.Bonus9,
                        'Bonus_10': req.body.Bonus10,
                        'Pattern_1': req.body.Pattern1,
                        'Pattern_2': req.body.Pattern2,
                        'Pattern_3': req.body.Pattern3,
                        'Pattern_4': req.body.Pattern4,
                        'Pattern_5': req.body.Pattern5,
                    },
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.botSeconds': (req.body.isBotGame == "Yes") ? +(req.body.botSeconds * 1000) : 0,
                    'otherData.totalBotGamePlayed': 0,
                    'otherData.isBotGameStarted': false,
                    'otherData.closeDay': []
                });

                // store pattern data while add/edit operation as patterns are static
                let allPatternArray = [];
                let allPatterns = await Sys.App.Services.patternServices.getGamePatternData({ gameType: 'game_5' }, ['patternName', 'patternType', 'fixedPatternType']);
                if (allPatterns && allPatterns.length > 0 && game.patternNamePrice && game.patternNamePrice.length > 0) {
                    let patternsData = game.patternNamePrice[0];
                    for (let key in patternsData) {
                        let isIndex = allPatterns.findIndex(e => e.patternName == key.replace("_", " "));
                        if (isIndex >= 0) {
                            let extraWinningsType = "No";
                            if (key == "Jackpot_1" || key == "Jackpot_2") {
                                extraWinningsType = "Jackpot";
                            } else if (key == "Bonus_1" || key == "Bonus_2" || key == "Bonus_3" || key == "Bonus_4" || key == "Bonus_5" || key == "Bonus_6" || key == "Bonus_7" || key == "Bonus_8" || key == "Bonus_9" || key == "Bonus_10") {
                                extraWinningsType = "Bonus";
                            }
                            allPatternArray.push({
                                patternName: key,
                                multiplier: patternsData[key],
                                pattern: get2DArrayFromString(allPatterns[isIndex].patternType),
                                patternElement: allPatterns[isIndex].fixedPatternType,
                                extraWinningsType: extraWinningsType
                            })
                        }
                    }
                }
                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, {
                    'otherData.allPatternArray': allPatternArray
                });
                // store pattern data while add/edit operation as patterns are static

                Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "gameAdded" });

            }
            console.log("translate.game_created_success---", translate.game_created_success)
            if (!game) {
                req.flash('error', translate.game_not_created);
                return res.redirect('/gameManagement');
            } else {
                req.flash('success', translate.game_created_success);
                return res.redirect('/gameManagement');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    patternGame: async function (req, res) {
        try {

            console.log('req.body patternGame: ', req.body);
            let { isBotGame, totalNumberOfGames } = req.body;
            if (isBotGame == "true" && !totalNumberOfGames) {
                return res.send({ status: "error", message: 'Please Enter Total number of bot games to be played.' });
            }
            let timeZone = req.body.ctimezone;
            // let endDate = '', startDate = '';
            // if (req.body.end_date) {
            //     endDate = new Date(req.body.end_date);
            // }
            // if (req.body.start_date) {
            //     startDate = new Date(req.body.start_date);
            // }

            if (req.body.end_date) {
                endDate = moment.tz(req.body.end_date, timeZone);
                endDate.utc().toDate();
            }
            if (req.body.start_date) {
                startDate = moment.tz(req.body.start_date, timeZone);
                startDate.utc().toDate();
            }

            let game;
            let ID = Date.now();

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
            let createID = dateTimeFunction(ID);

            let tmpp = await Sys.App.Services.GameService.getGameTypeByData({ type: req.body.gameType });
            let groupHalls = req.body.groupHalls;
            if (groupHalls == undefined) {
                return res.send({ status: "error", message: 'Please select Group of hall' });
            }
            // let halls = req.body.halls;
            let grpHalls = [];
            let hallsArray = [];
            for (let i = 0; i < groupHalls.length; i++) {
                let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                if (grpHallsData) {
                    grpHallsData.halls.filter((data) => {
                        hallsArray.push(data.id);
                    });
                    let grpArray = {
                        id: grpHallsData.id,
                        name: grpHallsData.name,
                        status: grpHallsData.status,
                        halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                    }
                    grpHalls.push(grpArray);
                }
            }

            // for bot game
            if (isBotGame == "true") {
                if (hallsArray.length > 0) {
                    for (let h = 0; h < hallsArray.length; h++) {
                        let botCount = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ userType: "Bot", 'hall.id': hallsArray[h] });
                        console.log("botCount in game creation", botCount, hallsArray[h]);
                        if (botCount <= 0) {
                            Sys.Game.Common.Controllers.PlayerController.createBotPlayers({ id: hallsArray[h] }, { hallId: hallsArray[h], count: 500 });
                            break;
                        }
                    }
                }
            }

            game = await Sys.App.Services.GameService.insertParentGameData({
                gameMode: req.body.gameMode,
                gameName: req.body.mainGameName,
                gameNumber: createID + '_G3',
                status: "active",
                gameType: req.body.gameType,
                gameTypeId: tmpp._id,
                days: req.body.days,
                createrId: req.session.details.id,
                startDate: req.body.start_date, //startDate,
                endDate: req.body.end_date, //endDate,
                groupHalls: grpHalls,
                allHallsId: hallsArray,
                isBotGame: isBotGame == "true" ? true : false,
                totalNumberOfGames: isBotGame == "true" ? totalNumberOfGames : undefined,
                subGames: req.body.subGames,
                'otherData.closeDay': [],
                'otherData.isBotGame': (isBotGame == "true") ? true : false,
            });
            game = JSON.stringify(game, null, 2);
            // console.log(game);

            if (req.body.isSavedGame == 'true') {
                let savegameData = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.body.gameId });
                if (savegameData && (savegameData.createrId == req.session.details.id || req.session.details.role == "admin")) {
                    let data = {
                        gameName: req.body.mainGameName,
                        days: req.body.days,
                        subGames: req.body.subGames
                    }
                    let responseData = await Sys.App.Services.GameService.updateSaveGameData({ _id: req.body.gameId }, data);
                    // console.log("respnseData", responseData);
                }
            }

            if (!game) {
                // return res.send("error");
                return res.send({ status: "error", message: 'Something went wrong in game create' });
            } else {
                return res.send({ status: "success" });
            }

        } catch (e) {
            console.log("Error", e);
            return res.send({ status: "error", message: 'Something went wrong' });
        }
    },

    editGameManagement: async function (req, res) {
        try {
            //console.log("editGame", req.params);
            let keys = [
                "dashboard",
                "add",
                "edit_text",
                "save_as",
                "enter_name_of_game",
                "save",
                "please",
                "game_name",
                "enter",
                "start_date_and_time",
                "start_date",
                "end_date",
                "end_date_and_time",
                "start_time",
                "end_time",
                "select",
                "group_hall",
                "choose",
                "minimum_ticket_count",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "no",
                "yes",
                "how_many_bot_game_to_run",
                "total_bot_game_to_run",
                "is_bot_game",
                "add_sub_game",
                "submit",
                "cancel",
                "time_period",
                "sub_game_name",
                "ticket_price",
                "jackpot_number_and_prize",
                "seconds",
                "save_game",
                "select_one_goh",
                "selct_atleast_one_day_in_week",
                "add_atleast_one_subgame",
                "overall_percentage_increase",
                "min_day_gap_7_days",
                "end_time_must_be_greater_than_start_time",
                "start_time_must_be_less_than_end_time",
                "created",
                "game_saved_success",
                "error",
                "in_cash",
                "in_percent",
                "add_group",
                "add_pattern",
                "group_name",
                "pattern_group",
                "atleast_one_goh_in_subgames",
                "min_ticket_count_should_be_greater_20",
                "remove",
                "pattern_name_prize",
                "bet_multiplier",
                "bet_amount",
                "game4_is_bot_game",
                "game4_bot_count",
                "total_bot_game_to_run",
                "game_4_second_1_18",
                "game_4_second_19_end",
                "game5_patterns_multi",
                "game5_second_validation",
                "game5_total_ball_to_withdraw",
                "game5_ball_withdraw_validation",
                "game5_ball_second_for_bot",
                "game5_ball_second_for_bot_validation",
                "total_second_to_display_single_ball"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let Game;
            if (gameType.type == 'game_4' || gameType.type == 'game_5') {
                Game = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            } else {
                Game = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
            }
            let groupHallArray = await Sys.App.Services.GroupHallServices.getGroupHalls({ "status": "active" });
            let startDateAt = dateTimeFunction(Game.startDate);
            let graceDateAt = dateTimeFunction(Game.graceDate);
            let endDateAt = dateTimeFunction(Game.endDate);
            // console.log(Game.endDate);
            // let ptrn = await Sys.App.Services.patternServices.patternFindAll({ "gameType": "game_4" });
            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }
            // console.log("Game: ", Game);
            // console.log("ptrn: ", ptrn);

            let ptrn;
            // let ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
            // let arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']

            // let printDataPattern = Game.patternNamePrice[0];
            // if (printDataPattern) {
            //     for (let i = 0; i < ptrn.length; i++) {
            //         ptrn[i].name = arr[i];
            //         ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
            //     }
            // }
            if (gameType.type == 'game_4') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
                let arr = ['priceOne', 'priceTwo', 'priceThree', 'priceFour', 'priceFive', 'priceSix', 'priceSeven', 'priceEight', 'priceNine', 'priceTen', 'priceEleven', 'priceTwelve', 'priceThirteen', 'priceFourteen', 'priceFifteen']
                let printDataPattern = Game.patternNamePrice[0];
                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                    ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
                }
            } else if (gameType.type == 'game_3') {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_3" });
            } else if (gameType.type == 'game_5') {
                if (Game.patternNamePrice && Game.patternNamePrice.length > 0) {
                    let patternsData = Game.patternNamePrice[0];
                    ptrn = [];
                    for (let key in patternsData) {
                        //console.log(key, patternsData[key]);
                        ptrn.push({
                            patternName: key.replace("_", " "),
                            price: patternsData[key]
                        })
                    }
                } else {
                    ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_5" });
                }

            }

            let days = [];
            let timings = [];
            // if (gameType.type != 'game_4' && gameType.type != 'game_5') {
            if (Object.keys(Game.days).length) {
                days = Object.keys(Game.days);
                for (const day in Game.days) {
                    console.log(Game.days[day]);
                    timings.push(Game.days[day]);
                }
            }
            // }
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: Game,
                pattern: ptrn,
                patternData: ptrn,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                EndTime: endDateAt,
                gameData: gameType,
                groupHallArray: groupHallArray,
                days: days,
                timings: timings,
                translate: translate,
                navigation: translate
            };
            if (Game.gameType == "game_3") {
                return res.render('GameManagement/game3Add', data);
            } else {
                return res.render('GameManagement/gameAdd', data);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGameManagementPostData: async function (req, res) {
        try {
            let keys = [
                "add_atleast_one_subgame",
                "select_one_goh",
                "game_not_updated",
                "game_update_success",
                "can_not_edit_as_already_strated"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("editGamePostData", req.params);
            console.log("editGamePostData", req.body);
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;
            let timeZone = req.body.ctimezone;
            if (gameType.type == "game_1") {

            } else if (gameType.type == "game_2") {
                updateGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
                if (!updateGame) {
                    req.flash('error', 'Sorry Game not Found.');
                    return res.redirect('/gameManagement');
                } else if (updateGame.status === "running") {
                    req.flash('error', translate.can_not_edit_as_already_strated);
                    return res.redirect('/gameManagement');
                }
                let endDate = '', startDate = '';
                if (req.body.end_date) {
                    // endDate = moment.tz(req.body.end_date, timeZone);
                    // endDate.utc().toDate();
                    endDate = new Date(req.body.end_date);
                }
                if (req.body.start_date) {
                    // startDate = moment.tz(req.body.start_date, timeZone);
                    // startDate.utc().toDate();
                    startDate = new Date(req.body.start_date);
                }

                if (!req.body.subGame) {
                    req.flash('error', translate.add_atleast_one_subgame);
                    return res.redirect('/gameManagement');
                } else {
                    req.body.subGame = req.body.subGame.map(function (subGame) {
                        //Price Nine
                        if (parseFloat(subGame.priceNine) > 0) {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNine),
                                isCash: true
                            }
                        } else {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNinePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceNinePercent;

                        //Price Ten
                        if (parseFloat(subGame.priceTen) > 0) {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTen),
                                isCash: true
                            }
                        } else {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTenPercent;

                        //Price Eleven
                        if (parseFloat(subGame.priceEleven) > 0) {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceEleven),
                                isCash: true
                            }
                        } else {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceElevenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceElevenPercent;

                        //Price Twelve
                        if (parseFloat(subGame.priceTwelve) > 0) {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelve),
                                isCash: true
                            }
                        } else {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelvePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTwelvePercent;

                        //Price Thirteen
                        if (parseFloat(subGame.priceThirteen) > 0) {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteen),
                                isCash: true
                            }
                        } else {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceThirteenPercent;

                        //Price 14 to 21
                        if (parseFloat(subGame.priceFourteenToTwentyone) > 0) {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyone),
                                isCash: true
                            }
                        } else {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyonePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceFourteenToTwentyonePercent;

                        console.log("subGame after process", subGame);
                        return subGame;
                    })
                }

                console.log("dates", startDate, endDate);
                let groupHalls = [];
                if (req.body.groupHalls) {
                    if (Array.isArray(req.body.groupHalls)) {
                        groupHalls = req.body.groupHalls;
                    } else {
                        groupHalls = [req.body.groupHalls];
                    }
                } else {
                    req.flash('error', translate.select_one_goh);
                    return res.redirect('/gameManagement');
                }
                // let halls = req.body.halls;
                let grpHalls = [];
                let hallsArray = [];
                for (let i = 0; i < groupHalls.length; i++) {
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id);
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            status: grpHallsData.status,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                        }
                        grpHalls.push(grpArray);
                    }
                }

                // for bot game
                if (req.body.isBotGame == "Yes") {
                    if (hallsArray.length > 0) {
                        for (let h = 0; h < hallsArray.length; h++) {
                            let botCount = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ userType: "Bot", 'hall.id': hallsArray[h] });
                            console.log("botCount in game Editing", botCount, hallsArray[h]);
                            if (botCount <= 0) {
                                Sys.Game.Common.Controllers.PlayerController.createBotPlayers({ id: hallsArray[h] }, { hallId: hallsArray[h], count: 500 });
                                break;
                            }
                        }
                    }
                }
                // for bot game

                if (updateGame != undefined) {
                    let data = {
                        gameName: req.body.mainGameName,
                        startDate: startDate == "" ? updateGame.startDate : startDate,
                        // graceDate: req.body.grace_time,
                        endDate: endDate == "" ? updateGame.endDate : endDate,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        groupHalls: grpHalls,
                        allHallsId: hallsArray,
                        days: req.body.days,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                        subGames: req.body.subGame,
                        'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                        //'otherData.botgamePotAmount': (req.body.isBotGame == "Yes") ? +req.body.botgamePotAmount : 0,
                        //'otherData.botTicketCount': (req.body.isBotGame == "Yes") ? +req.body.botTicketCount : 0,
                        'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    }
                    await Sys.App.Services.GameService.updateParentGameData({ _id: req.params.id }, data);
                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
                let endDate = '', startDate = '';
                if (req.body.end_date) {
                    endDate = moment.tz(req.body.end_date, timeZone);
                    endDate.utc().toDate();
                }
                if (req.body.start_date) {
                    startDate = moment.tz(req.body.start_date, timeZone);
                    startDate.utc().toDate();
                }
                let groupHalls = [];
                if (req.body.groupHalls) {
                    groupHalls = req.body.groupHalls;
                } else {
                    req.flash('error', 'Please Select atleast one group of halls');
                    return res.send({ status: "error", message: 'Please Select atleast one group of halls' });
                }
                // let halls = req.body.halls;
                let grpHalls = [];
                let hallsArray = [];
                for (let i = 0; i < groupHalls.length; i++) {
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id);
                        });
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            status: grpHallsData.status,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                        }
                        grpHalls.push(grpArray);
                    }
                }

                // for bot game
                if (req.body.isBotGame == "true") {
                    if (hallsArray.length > 0) {
                        for (let h = 0; h < hallsArray.length; h++) {
                            let botCount = await Sys.Game.Common.Services.PlayerServices.getPlayerCount({ userType: "Bot", 'hall.id': hallsArray[h] });
                            console.log("botCount in game creation", botCount, hallsArray[h]);
                            if (botCount <= 0) {
                                Sys.Game.Common.Controllers.PlayerController.createBotPlayers({ id: hallsArray[h] }, { hallId: hallsArray[h], count: 500 });
                                break;
                            }
                        }
                    }
                }

                if (updateGame != undefined) {
                    let data = {
                        gameName: req.body.mainGameName,
                        startDate: startDate,
                        endDate: endDate,
                        groupHalls: grpHalls,
                        allHallsId: hallsArray,
                        subGames: req.body.subGames,
                        createrId: req.session.details.id,
                        days: req.body.days
                    }
                    updateGame = await Sys.App.Services.GameService.updateParentGameData({ _id: req.params.id }, data);
                }
            } else if (gameType.type == "game_4") {

                let endDate = '', startDate = '';
                if (req.body.end_date) {
                    // endDate = moment.tz(req.body.end_date, timeZone);
                    // endDate.utc().toDate();
                    endDate = new Date(req.body.end_date);
                }
                if (req.body.start_date) {
                    // startDate = moment.tz(req.body.start_date, timeZone);
                    // startDate.utc().toDate();
                    startDate = new Date(req.body.start_date);
                }

                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                var newArrayBetAmount = req.body.betAmount.map(function (x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];
                console.log('Result: ', result);

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }
                console.log("JSON: ", json);

                if (updateGame != undefined) {
                    game = await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, {
                        betAmount: req.body.betAmount,
                        ticketPrice: 1, //req.body.ticketPrice,
                        betMultiplier: req.body.betMultiplier,
                        betData: json,
                        seconds2: req.body.seconds2 * 1000,
                        seconds: req.body.seconds * 1000,
                        startDate: startDate == "" ? updateGame.startDate : startDate,
                        endDate: endDate == "" ? updateGame.endDate : endDate,
                        days: req.body.days,
                        patternNamePrice: {
                            'Pattern1': req.body.priceOne,
                            'Pattern2': req.body.priceTwo,
                            'Pattern3': req.body.priceThree,
                            'Pattern4': req.body.priceFour,
                            'Pattern5': req.body.priceFive,
                            'Pattern6': req.body.priceSix,
                            'Pattern7': req.body.priceSeven,
                            'Pattern8': req.body.priceEight,
                            'Pattern9': req.body.priceNine,
                            'Pattern10': req.body.priceTen,
                            'Pattern11': req.body.priceEleven,
                            'Pattern12': req.body.priceTwelve,
                            'Pattern13': req.body.priceThirteen,
                            'Pattern14': req.body.priceFourteen,
                            'Pattern15': req.body.priceFifteen

                        },
                        'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                        'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                        'otherData.totalBotGamePlayed': 0
                    });
                    console.log('game: ', game);
                    if (req.body.isBotGame == "Yes") {
                        Sys.App.get('eventEmitter').emit('game4botcheckup', { botPlay: true })
                    } else {
                        Sys.App.get('eventEmitter').emit('game4botcheckup', { botPlay: false })
                    }
                }

                // send broadcast for active games to refresh the game screen
                let start = new Date(); start.setHours(0, 0, 0, 0);
                let end = new Date(); end.setHours(23, 59, 59, 999);
                let subGames = await Sys.App.Services.GameService.getGame4SubgamesByData({ status: { $in: ["active", "finish"] }, createdAt: { $gte: start, $lt: end } }, { _id: 1 });
                if (subGames.length > 0) {
                    let latestMainGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });
                    let patternsUpdated = await Sys.App.Services.patternServices.getByData({ gameType: 'game_4' });
                    function get2DArrayFromString(s) {
                        let arr = s.replace(/\./g, ",");
                        arr = arr.split`,`.map(x => +x);
                        return arr;
                    }
                    let prize = latestMainGame.patternNamePrice[0];
                    let patternListDataUpdated = [];
                    let betData = latestMainGame.betData;
                    console.log("betData----", betData)
                    for (let k = 0; k < patternsUpdated.length; k++) {
                        let tmp = get2DArrayFromString(patternsUpdated[k].patternType);
                        let patternObj = {
                            id: patternsUpdated[k]._id,
                            patternDataList: tmp,
                            count: patternsUpdated[k].count,
                            extra: '',
                            patternName: patternsUpdated[k].patternName,
                            prize: Number(prize['Pattern' + (k + 1)])
                        }
                        if (patternsUpdated[k].patternName == "Jackpot") {
                            patternObj.patternName = 'Jackpot';
                            patternObj.extra = "";
                        } else if (patternsUpdated[k].patternName == "2L") {
                            patternObj.patternName = "";
                            patternObj.extra = '2L';
                        } else if (patternsUpdated[k].patternName == "1L") {
                            patternObj.patternName = "";
                            patternObj.extra = '1L';
                        }
                        patternListDataUpdated.push(patternObj);
                    }
                    patternListDataUpdated.sort(function (a, b) { return a.count - b.count });

                    for (let s = 0; s < subGames.length; s++) {
                        Sys.Io.of(Sys.Config.Namespace.Game4).to(subGames[s].id).emit('PatternChange', { patternList: patternListDataUpdated, betData: betData, first18BallTime: (latestMainGame.seconds / 1000).toString(), last15BallTime: (latestMainGame.seconds2 / 1000).toString(), isSoundPlay: (latestMainGame?.seconds >= 2000 && latestMainGame?.seconds2 >= 2000) ? true: false });
                    }
                }

                if (req.body.isBotGame != "Yes") {
                    Sys.AvailableGamesForHall = {};
                    Sys.Io.emit("checkGameStatus", {});
                }

            } else if (gameType.type == "game_5") {

                let endDate = '', startDate = '';
                if (req.body.end_date) {
                    // endDate = moment.tz(req.body.end_date, timeZone);
                    // endDate.utc().toDate();
                    endDate = new Date(req.body.end_date);
                }
                if (req.body.start_date) {
                    // startDate = moment.tz(req.body.start_date, timeZone);
                    // startDate.utc().toDate();
                    startDate = new Date(req.body.start_date);
                }

                updateGame = await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, {
                    patternNamePrice: {
                        'Jackpot_1': req.body.Jackpot1,
                        'Jackpot_2': req.body.Jackpot2,
                        'Bonus_1': req.body.Bonus1,
                        'Bonus_2': req.body.Bonus2,
                        'Bonus_3': req.body.Bonus3,
                        'Bonus_4': req.body.Bonus4,
                        'Bonus_5': req.body.Bonus5,
                        'Bonus_6': req.body.Bonus6,
                        'Bonus_7': req.body.Bonus7,
                        'Bonus_8': req.body.Bonus8,
                        'Bonus_9': req.body.Bonus9,
                        'Bonus_10': req.body.Bonus10,
                        'Pattern_1': req.body.Pattern1,
                        'Pattern_2': req.body.Pattern2,
                        'Pattern_3': req.body.Pattern3,
                        'Pattern_4': req.body.Pattern4,
                        'Pattern_5': req.body.Pattern5,
                    },
                    startDate: startDate == "" ? updateGame.startDate : startDate,
                    endDate: endDate == "" ? updateGame.endDate : endDate,
                    days: req.body.days,
                    seconds: req.body.seconds * 1000,
                    'otherData.withdrawableBalls': req.body.withdrawableBalls,
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.botSeconds': (req.body.isBotGame == "Yes") ? +(req.body.botSeconds * 1000) : 0,
                    'otherData.totalBotGamePlayed': 0,
                    'otherData.isBotGameStarted': false
                });
                if (req.body.isBotGame == "Yes") {
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id, 'otherData.isBotGameStarted': true }, { $set: { 'otherData.isBotGameStarted': false } });
                }
                function get2DArrayFromString(s) {
                    let arr = s.replace(/\./g, ",");
                    arr = arr.split`,`.map(x => +x);
                    return arr;
                }
                let subGames = await Sys.Game.Game5.Services.GameServices.getSubgameByData({ status: "Waiting" }, { status: 1 });

                if (subGames.length > 0) {
                    let latestGameData = await Sys.Game.Game5.Services.GameServices.getSingleGameData({ _id: req.params.id }, { patternNamePrice: 1, seconds: 1, otherData: 1 });
                    let allPatternArray = [];

                    let allPatterns = await Sys.App.Services.patternServices.getGamePatternData({ gameType: 'game_5' }, ['patternName', 'patternType', 'fixedPatternType']);
                    if (allPatterns && allPatterns.length > 0 && latestGameData.patternNamePrice && latestGameData.patternNamePrice.length > 0) {
                        let patternsData = latestGameData.patternNamePrice[0];
                        for (let key in patternsData) {
                            let isIndex = allPatterns.findIndex(e => e.patternName == key.replace("_", " "));
                            if (isIndex >= 0) {
                                let extraWinningsType = "No";
                                if (key == "Jackpot_1" || key == "Jackpot_2") {
                                    extraWinningsType = "Jackpot";
                                } else if (key == "Bonus_1" || key == "Bonus_2" || key == "Bonus_3" || key == "Bonus_4" || key == "Bonus_5" || key == "Bonus_6" || key == "Bonus_7" || key == "Bonus_8" || key == "Bonus_9" || key == "Bonus_10") {
                                    extraWinningsType = "Bonus";
                                }
                                allPatternArray.push({
                                    patternName: key,
                                    multiplier: patternsData[key],
                                    pattern: get2DArrayFromString(allPatterns[isIndex].patternType),
                                    patternElement: allPatterns[isIndex].fixedPatternType,
                                    extraWinningsType: extraWinningsType
                                })
                            }

                        }
                    }

                    await Sys.App.Services.GameService.updateGameData({ _id: latestGameData._id }, {
                        'otherData.allPatternArray': allPatternArray
                    });

                    let subGameIds = [];
                    for (let s = 0; s < subGames.length; s++) {
                        subGameIds.push(subGames[s]._id);
                    }
                    await Sys.Game.Game5.Services.GameServices.updateManySubgameData({ status: "Waiting" }, { allPatternArray: allPatternArray, seconds: latestGameData.seconds, withdrawableBalls: latestGameData.otherData.withdrawableBalls });
                    for (let s = 0; s < subGames.length; s++) {
                        await Sys.Io.of(Sys.Config.Namespace.Game5).to(subGames[s]._id).emit('PatternChange', { patternList: allPatternArray.map(({ multiplier, pattern, extraWinningsType }) => ({ multiplier, pattern, extraWinningsType })), totalWithdrawableBalls: latestGameData.otherData.withdrawableBalls, BallDrawTime: latestGameData.seconds, isSoundPlay: (latestGameData?.seconds >= 2000) ? true: false, });
                    }
                } else {
                    // to update the main game
                    // store pattern data while add/edit operation as patterns are static
                    let latestGameData = await Sys.Game.Game5.Services.GameServices.getSingleGameData({ _id: req.params.id }, { patternNamePrice: 1, seconds: 1, otherData: 1 });
                    let allPatternArray = [];
                    let allPatterns = await Sys.App.Services.patternServices.getGamePatternData({ gameType: 'game_5' }, ['patternName', 'patternType', 'fixedPatternType']);
                    if (allPatterns && allPatterns.length > 0 && latestGameData.patternNamePrice && latestGameData.patternNamePrice.length > 0) {
                        let patternsData = latestGameData.patternNamePrice[0];
                        for (let key in patternsData) {
                            let isIndex = allPatterns.findIndex(e => e.patternName == key.replace("_", " "));
                            if (isIndex >= 0) {
                                allPatternArray.push({
                                    patternName: key,
                                    multiplier: patternsData[key],
                                    pattern: get2DArrayFromString(allPatterns[isIndex].patternType),
                                    patternElement: allPatterns[isIndex].fixedPatternType,
                                })
                            }

                        }
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: latestGameData._id }, {
                        'otherData.allPatternArray': allPatternArray
                    });
                    // store pattern data while add/edit operation as patterns are static
                }

                Sys.Game.Game5.Controllers.GameController.checkForBotGame5({ action: "gameEdited" });
                if (req.body.isBotGame != "Yes") {
                    Sys.AvailableGamesForHall = {};
                    Sys.Io.emit("checkGameStatus", {});
                }
            }
            if (gameType && gameType.type !== 'game_3') {
                if (!updateGame) {
                    req.flash('error', translate.game_not_updated);
                    return res.redirect('/gameManagement');
                } else {
                    req.flash('success',  translate.game_update_success);
                    return res.redirect('/gameManagement');
                }
            } else {
                if (!updateGame) {
                    req.flash('error',  translate.game_not_updated);
                    return res.send({ status: "error", message: 'Something went wrong in game create' });
                } else {
                    req.flash('success',  translate.game_update_success);
                    return res.send({ status: "success" });
                }
            }

        } catch (e) {
            console.log("Error Edit Game Post API", e);
            req.flash('error', 'Internal Server Error.');
            if (gameType && gameType.type !== 'game_3') {
                return res.redirect('/gameManagement');
            } else {
                return res.send({ status: "error", message: 'Something went wrong in game create' });
            }
        }
    },

    startGame: async function (req, res) {
        try {
            //console.log("req.body startGame", req.body);
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id, status: 'active' });
            console.log("game : - game :-", game.purchasedTickets)
            if (game) {

                if (game.purchasedTickets.length > 0 || game.gameType == 'game_1') {
                    if (game.gameMode == 'auto') {
                        if (game.minTicketCount <= game.purchasedTickets.length || game.gameType == 'game_1') {
                            console.log('<========================================================================================================================>');
                            console.log('<=>                                              || ' + game.gameName + ' Starting [ Admin Panel ] (Auto) ||                                                 <=>');
                            console.log('<========================================================================================================================>');

                            if (game.gameType == 'game_1') {
                                // game start from admin start for game 1
                                let isTicketAvailable = false;
                                let gameIds = [];
                                let gameKey = ((req.body.isGameCall && req.body.isGameCall == 'parent') ? 'parentGameId' : '_id');
                                let qry = {};
                                qry[gameKey] = req.body.id;

                                let allSubGames = await Sys.App.Services.GameService.getGameData(qry); //parentId
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        gameIds.push(allSubGames[s]._id)
                                        if (allSubGames[s].subGames[0].options.length > 0) {
                                            for (let o = 0; o < allSubGames[s].subGames[0].options.length; o++) {
                                                console.log("tickets count", allSubGames[s].subGames[0].options[o].totalPurchasedTickets)
                                                if (allSubGames[s].subGames[0].options[o].totalPurchasedTickets < allSubGames[s].subGames[0].options[o].ticketCount) {
                                                    isTicketAvailable = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    isTicketAvailable = true;
                                }

                                console.log("isTicketAvailable in startGame", isTicketAvailable)
                                if (isTicketAvailable == false) {
                                    gameIds.push(game._id);
                                    console.log("allGame ids", gameIds)


                                    let updatedGameData = {
                                        isAdminGameStart: true,
                                        startDate: Date.now()
                                    }
                                    await Sys.App.Services.GameService.updateManyGameData({ "_id": { $in: gameIds } }, updatedGameData);

                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            let playerIds = [];
                                            let bulkArr = [];
                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ]  Game Start By Admin ..!! ";
                                            for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                if (allSubGames[s].gameType == "game_1") {
                                                    if (allSubGames[s].players[p].userType != "Physical") {
                                                        playerIds.push(allSubGames[s].players[p].id);
                                                    }
                                                } else {
                                                    playerIds.push(allSubGames[s].players[p].id);
                                                }
                                                //console.log("all playerIds lists", playerIds)
                                                //playerIds.push(allSubGames[s].players[p].id);
                                                let notification = {
                                                    notificationType: 'gameStartByAdmin',
                                                    message: TimeMessage
                                                }
                                                bulkArr.push({
                                                    insertOne: {
                                                        document: {
                                                            playerId: allSubGames[s].players[p].id,
                                                            gameId: allSubGames[s]._id,
                                                            notification: notification
                                                        }
                                                    }
                                                });
                                            }

                                            console.log("TimeMessage", TimeMessage)
                                            await Sys.Helper.gameHelper.sendNotificationToPlayers(allSubGames[s], playerIds, TimeMessage, 'gameStartByAdmin');
                                            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                                        }
                                    }
                                    console.log("Auto game 1 start")
                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            Sys.Game.Game1.Controllers.GameProcess.StartGame(allSubGames[s].id);
                                        }
                                    }

                                    return res.send("success");
                                } else {
                                    return res.send("error");
                                }
                            } else if (game.gameType == 'game_2') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });

                                await Sys.Game.Game2.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            } else if (game.gameType == 'game_3') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id, {_id: 1});

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });

                                await Sys.Game.Game3.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            }

                        } else {
                            return res.send("error");
                        }
                    } else if (game.gameMode == 'manual') {

                        if (game.purchasedTickets.length == game.totalNoTickets || game.gameType == 'game_1') {
                            console.log('<========================================================================================================================>');
                            console.log('<=>                                              || ' + game.gameName + ' Starting [ Admin Panel ] (Manual) ||                                                 <=>');
                            console.log('<========================================================================================================================>');

                            if (game.gameType == 'game_1') {
                                let isTicketAvailable = false;
                                let gameIds = [];

                                let gameKey = ((req.body.isGameCall && req.body.isGameCall == 'parent') ? 'parentGameId' : '_id');
                                let qry = {};
                                qry[gameKey] = req.body.id;

                                let allSubGames = await Sys.App.Services.GameService.getGameData(qry);
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        gameIds.push(allSubGames[s]._id)
                                        if (allSubGames[s].subGames[0].options.length > 0) {
                                            for (let o = 0; o < allSubGames[s].subGames[0].options.length; o++) {
                                                console.log("tickets count", allSubGames[s].subGames[0].options[o].totalPurchasedTickets)
                                                if (allSubGames[s].subGames[0].options[o].totalPurchasedTickets < allSubGames[s].subGames[0].options[o].ticketCount) {
                                                    isTicketAvailable = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    isTicketAvailable = true;
                                }

                                console.log("isTicketAvailable in startGame", isTicketAvailable)
                                if (isTicketAvailable == false) {
                                    gameIds.push(game._id);
                                    console.log("allGame ids", gameIds)


                                    let updatedGameData = {
                                        isAdminGameStart: true,
                                        startDate: Date.now()
                                    }
                                    await Sys.App.Services.GameService.updateManyGameData({ "_id": { $in: gameIds } }, updatedGameData);

                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            let playerIds = [];
                                            let bulkArr = [];
                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ]  Game Start By Admin ..!! ";
                                            for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                if (allSubGames[s].gameType == "game_1") {
                                                    if (allSubGames[s].players[p].userType != "Physical") {
                                                        playerIds.push(allSubGames[s].players[p].id);
                                                    }
                                                } else {
                                                    playerIds.push(allSubGames[s].players[p].id);
                                                }
                                                //console.log("all playerIds lists", playerIds)
                                                //playerIds.push(allSubGames[s].players[p].id);
                                                let notification = {
                                                    notificationType: 'gameStartByAdmin',
                                                    message: TimeMessage
                                                }
                                                bulkArr.push({
                                                    insertOne: {
                                                        document: {
                                                            playerId: allSubGames[s].players[p].id,
                                                            gameId: allSubGames[s]._id,
                                                            notification: notification
                                                        }
                                                    }
                                                });
                                            }

                                            console.log("TimeMessage", TimeMessage)
                                            await Sys.Helper.gameHelper.sendNotificationToPlayers(allSubGames[s], playerIds, TimeMessage, 'gameStartByAdmin');
                                            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                                        }
                                    }
                                    console.log("manual game 1 start")
                                    if (allSubGames.length > 0) {
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            Sys.Game.Game1.Controllers.GameProcess.StartGame(allSubGames[s].id);
                                        }
                                    }
                                    //await Sys.Game.Game1.Controllers.GameProcess.StartGame(newGame);
                                    return res.send("success");
                                } else {
                                    return res.send("error");
                                }
                            } else if (game.gameType == 'game_2') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });


                                await Sys.Game.Game2.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            } else if (game.gameType == 'game_3') {

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id, {_id: 1});

                                    //if (playerUpdated.enableNotification == true) {
                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ]  Game Start By Admin ..!! ";

                                    let notification = {
                                        notificationType: 'gameStartByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}
                                }

                                let updatedGameData = {
                                    isAdminGameStart: true,
                                    startDate: Date.now()
                                }
                                await Sys.App.Services.GameService.updateGameData({ _id: game._id }, updatedGameData)

                                let newGame = await Sys.App.Services.GameService.getSingleGameData({ _id: game._id, status: 'active' });


                                await Sys.Game.Game3.Controllers.GameProcess.StartGame(newGame);
                                return res.send("success");
                            }

                        } else {
                            return res.send("error");
                        }
                    }

                    // // main games +++++++++++++Arvi
                    // let totActive = await Sys.App.Services.GameService.getSingleGameData({ parentGameId : game.parentGameId, status: 'active' });
                    // if(totActive.length<=0){

                    // }

                } else {
                    return res.send("error");
                }
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error in startGame", e);
            return new Error(e);
        }
    },

    getGameManagementDelete: async function (req, res) {
        try {
            console.log(req.body);
            let game;
            if (req.body.type === 'game_2') {
                game = await Sys.App.Services.GameService.getSingleParentGameData({ _id: req.body.id, status: "active" });
                console.log("game found hehehehehehe");
                if (!game.childGameList.length) {
                    await Sys.App.Services.GameService.deleteParentGame(req.body.id)
                    return res.send("success");
                } else {
                    return res.send("error");
                }
            } else {
                game = await Sys.App.Services.GameService.getSingleParentGameData({ _id: req.body.id, status: "active" });

                console.log("getGameManagementDelete", game);
                if (game) {
                    if (!game.childGameList.length) {
                        await Sys.App.Services.GameService.deleteParentGame(req.body.id);
                        return res.send("success");
                    }
                    if (game.status == "active") {
                        if (game.gameMode == "auto") {

                            let startTime = new Date(game.startDate);
                            console.log("startTime startTime", startTime);
                            let currentTime = new Date(Date.now());
                            console.log("startTime currentTime", currentTime);
                            let diff = (currentTime.getTime() - startTime.getTime()) / 1000;
                            console.log("startTime before", diff);
                            diff /= 60;
                            console.log("startTime affter", diff);
                            let minutes = Math.abs(Math.round(diff));
                            console.log("minutes", minutes);

                            if (minutes <= 15) {
                                if (minutes <= 0) {

                                    let startTimeGrace = new Date(game.graceDate);
                                    let currentTimeGrace = new Date(Date.now());
                                    let diffGrace = (currentTimeGrace.getTime() - startTimeGrace.getTime()) / 1000;
                                    console.log("diffGrace before", diffGrace);
                                    diffGrace /= 60;
                                    console.log("diffGrace affter", diffGrace);
                                    let minutesGraceDate = Math.abs(Math.round(diffGrace));
                                    console.log("minutesGraceDate", minutesGraceDate);

                                    if (minutesGraceDate <= 0 || minutesGraceDate > 15) {
                                        console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Auto Game Not Start [ Refund Process ]');
                                        // start
                                        if (game.gameType == "game_1") {
                                            let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                                            console.log("allSubGames", allSubGames)
                                            if (allSubGames.length > 0) {
                                                let subGamesIds = [];
                                                for (let s = 0; s < allSubGames.length; s++) {
                                                    let ticketIdArray = [];

                                                    if (allSubGames[s].purchasedTickets.length > 0) {
                                                        console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                                        for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                                            //for (let j = 0; j < game.players.length; j++) {
                                                            //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                            let transactionDataSend = {
                                                                playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                                gameId: allSubGames[s]._id,
                                                                ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                                transactionSlug: "refund",
                                                                action: "credit",
                                                                purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                                totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                                            }
                                                            ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                                            if (allSubGames[s].purchasedTickets[i].userType != "Physical") {
                                                                await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                                                            }

                                                            subGamesIds.push(allSubGames[s]._id)
                                                            //}
                                                            //}
                                                        }
                                                    }
                                                    console.log("----ticketIdArray in game delete----", ticketIdArray)
                                                    if (ticketIdArray.length > 0) {
                                                        Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                                    }
                                                    for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                        if (allSubGames[s].players[p].userType != "Physical") {
                                                            let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                                            //if (playerUpdated.enableNotification == true) {

                                                            let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                                            let notification = {
                                                                notificationType: 'gameDeletedByAdmin',
                                                                message: TimeMessage
                                                            }

                                                            let dataNotification = {
                                                                playerId: allSubGames[s].players[p].id,
                                                                gameId: allSubGames[s]._id,
                                                                notification: notification
                                                            }

                                                            await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                                            Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                                            //}

                                                            console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                                            await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                                                gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                                            });


                                                            let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                            let newPointArr = [];
                                                            let newRealArr = [];
                                                            for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                                if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                                    newPointArr.push(ownPurchasedTicketCount[o]);
                                                                } else {
                                                                    newRealArr.push(ownPurchasedTicketCount[o]);
                                                                }
                                                            }


                                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                            console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                            if (newPointArr.length > 0) {

                                                                let newExtraTransaction = {
                                                                    playerId: playerUpdated._id,
                                                                    gameId: allSubGames[s]._id,
                                                                    transactionSlug: "extraTransaction",
                                                                    typeOfTransaction: "Refund",
                                                                    action: "credit", // debit / credit
                                                                    purchasedSlug: "points", // point /realMoney
                                                                    totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                                }

                                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                            }

                                                            if (newRealArr.length > 0) {

                                                                let newExtraTransaction = {
                                                                    playerId: playerUpdated._id,
                                                                    gameId: allSubGames[s]._id,
                                                                    transactionSlug: "extraTransaction",
                                                                    typeOfTransaction: "Refund",
                                                                    action: "credit", // debit / credit
                                                                    purchasedSlug: "realMoney", // point /realMoney
                                                                    totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                                }

                                                                await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                            }
                                                        }


                                                    }
                                                    await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                                    Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);


                                                }
                                                if (subGamesIds.length > 0) {
                                                    for (d = 0; d < subGamesIds.length; d++) {
                                                        Sys.Io.of(Sys.Config.Namespace.Game1).to(subGamesIds[d]).emit('GameTerminate', { gameId: subGamesIds[d], message: "Game is deleted by Admin" });
                                                    }
                                                }
                                            } else {
                                                console.log("game 1 subgames not found");
                                            }
                                            await Sys.App.Services.GameService.deleteGame(req.body.id)
                                            return res.send("success");
                                        } else {
                                            for (var i = 0; i < game.purchasedTickets.length; i++) {
                                                for (let j = 0; j < game.players.length; j++) {
                                                    if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                        var transactionDataSend = {
                                                            playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                            gameId: game._id,
                                                            ticketId: game.purchasedTickets[i].ticketId,
                                                            transactionSlug: "refund",
                                                            action: "credit",
                                                            purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                            totalAmount: game.ticketPrice,
                                                        }

                                                        await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                                                    }
                                                }
                                            }
                                            var ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);

                                            for (let p = 0; p < game.players.length; p++) {

                                                let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id, {_id: 1, });

                                                //if (playerUpdated.enableNotification == true) {

                                                let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                                let notification = {
                                                    notificationType: 'gameDeletedByAdmin',
                                                    message: TimeMessage
                                                }

                                                let dataNotification = {
                                                    playerId: game.players[p].id,
                                                    gameId: game._id,
                                                    notification: notification
                                                }

                                                await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                                Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                                //}

                                                let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                let newPointArr = [];
                                                let newRealArr = [];
                                                for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                    if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                        newPointArr.push(ownPurchasedTicketCount[o]);
                                                    } else {
                                                        newRealArr.push(ownPurchasedTicketCount[o]);
                                                    }
                                                }


                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                if (newPointArr.length > 0) {

                                                    let newExtraTransaction = {
                                                        playerId: playerUpdated._id,
                                                        gameId: game._id,
                                                        transactionSlug: "extraTransaction",
                                                        typeOfTransaction: "Refund",
                                                        action: "credit", // debit / credit
                                                        purchasedSlug: "points", // point /realMoney
                                                        totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                }

                                                if (newRealArr.length > 0) {

                                                    let newExtraTransaction = {
                                                        playerId: playerUpdated._id,
                                                        gameId: game._id,
                                                        transactionSlug: "extraTransaction",
                                                        typeOfTransaction: "Refund",
                                                        action: "credit", // debit / credit
                                                        purchasedSlug: "realMoney", // point /realMoney
                                                        totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                }

                                            }
                                            await Sys.App.Services.GameService.deleteGame(req.body.id)
                                            if (game.gameType == "game_2") {
                                                await Sys.Io.of(Sys.Config.Namespace.Game2).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                            } else if (game.gameType == "game_3") {
                                                await Sys.Io.of(Sys.Config.Namespace.Game3).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                            } else if (game.gameType == "game_4") {
                                                await Sys.Io.of(Sys.Config.Namespace.Game4).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                            }
                                            return res.send("success");
                                        }
                                        // end   
                                    } else {
                                        return res.send("error");
                                    }

                                } else {
                                    return res.send("error");
                                }
                            } else {
                                if (game.gameType == "game_1") {
                                    let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                                    console.log("allSubGames", allSubGames)
                                    if (allSubGames.length > 0) {
                                        let subGamesIds = [];
                                        for (let s = 0; s < allSubGames.length; s++) {
                                            let ticketIdArray = [];
                                            if (allSubGames[s].purchasedTickets.length > 0) {
                                                console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                                for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                                    //for (let j = 0; j < game.players.length; j++) {
                                                    //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                    let transactionDataSend = {
                                                        playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                        gameId: allSubGames[s]._id,
                                                        ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                        transactionSlug: "refund",
                                                        action: "credit",
                                                        purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                        totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                                    }
                                                    ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                                    if (allSubGames[s].purchasedTickets[i].userType != "Physical") {
                                                        await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                                                    }

                                                    subGamesIds.push(allSubGames[s]._id);
                                                    //}
                                                    //}
                                                }
                                            }
                                            console.log("----ticketIdArray in game delete----", ticketIdArray)
                                            if (ticketIdArray.length > 0) {
                                                Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                            }
                                            for (let p = 0; p < allSubGames[s].players.length; p++) {
                                                if (allSubGames[s].players[p].userType != "Physical") {
                                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                                    //if (playerUpdated.enableNotification == true) {

                                                    let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                                    let notification = {
                                                        notificationType: 'gameDeletedByAdmin',
                                                        message: TimeMessage
                                                    }

                                                    let dataNotification = {
                                                        playerId: allSubGames[s].players[p].id,
                                                        gameId: allSubGames[s]._id,
                                                        notification: notification
                                                    }

                                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                                    //}

                                                    console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                                    await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                                        gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                                    });


                                                    let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    let newPointArr = [];
                                                    let newRealArr = [];
                                                    for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                        if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                            newPointArr.push(ownPurchasedTicketCount[o]);
                                                        } else {
                                                            newRealArr.push(ownPurchasedTicketCount[o]);
                                                        }
                                                    }


                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                    if (newPointArr.length > 0) {

                                                        let newExtraTransaction = {
                                                            playerId: playerUpdated._id,
                                                            gameId: allSubGames[s]._id,
                                                            transactionSlug: "extraTransaction",
                                                            typeOfTransaction: "Refund",
                                                            action: "credit", // debit / credit
                                                            purchasedSlug: "points", // point /realMoney
                                                            totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                        }

                                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                    }

                                                    if (newRealArr.length > 0) {

                                                        let newExtraTransaction = {
                                                            playerId: playerUpdated._id,
                                                            gameId: allSubGames[s]._id,
                                                            transactionSlug: "extraTransaction",
                                                            typeOfTransaction: "Refund",
                                                            action: "credit", // debit / credit
                                                            purchasedSlug: "realMoney", // point /realMoney
                                                            totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                        }

                                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                    }
                                                }


                                            }
                                            await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                            Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);
                                        }
                                        if (subGamesIds.length > 0) {
                                            for (d = 0; d < subGamesIds.length; d++) {
                                                Sys.Io.of(Sys.Config.Namespace.Game1).to(subGamesIds[d]).emit('GameTerminate', { gameId: subGamesIds[d], message: "Game is deleted by Admin" });
                                            }
                                        }

                                    } else {
                                        console.log("game 1 subgames not found");
                                    }
                                    await Sys.App.Services.GameService.deleteGame(req.body.id)
                                    return res.send("success");
                                } else {
                                    if (game.purchasedTickets.length > 0) {
                                        console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Auto Game Not Start [ Refund Process ]');
                                        for (var i = 0; i < game.purchasedTickets.length; i++) {
                                            for (let j = 0; j < game.players.length; j++) {
                                                if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                    var transactionDataSend = {
                                                        playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                        gameId: game._id,
                                                        ticketId: game.purchasedTickets[i].ticketId,
                                                        transactionSlug: "refund",
                                                        action: "credit",
                                                        purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                        totalAmount: game.ticketPrice,
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);


                                                }
                                            }
                                        }
                                    }

                                    for (let p = 0; p < game.players.length; p++) {

                                        let playerUpdated = await Sys.Game.Game3.Services.PlayerServices.getById(game.players[p].id, {_id: 1, username: 1, socketId: 1});

                                        //if (playerUpdated.enableNotification == true) {
                                        let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                        let notification = {
                                            notificationType: 'gameDeletedByAdmin',
                                            message: TimeMessage
                                        }

                                        let dataNotification = {
                                            playerId: game.players[p].id,
                                            gameId: game._id,
                                            notification: notification
                                        }

                                        await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                        Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                        //}

                                        console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                        await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                            gameType: (game.gameType == 'game_1') ? 1 : (game.gameType == 'game_2') ? 2 : (game.gameType == 'game_3') ? 3 : 0
                                        });


                                        let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        let newPointArr = [];
                                        let newRealArr = [];
                                        for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                            if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                newPointArr.push(ownPurchasedTicketCount[o]);
                                            } else {
                                                newRealArr.push(ownPurchasedTicketCount[o]);
                                            }
                                        }


                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                        if (newPointArr.length > 0) {

                                            let newExtraTransaction = {
                                                playerId: playerUpdated._id,
                                                gameId: game._id,
                                                transactionSlug: "extraTransaction",
                                                typeOfTransaction: "Refund",
                                                action: "credit", // debit / credit
                                                purchasedSlug: "points", // point /realMoney
                                                totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                            }

                                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                        }

                                        if (newRealArr.length > 0) {

                                            let newExtraTransaction = {
                                                playerId: playerUpdated._id,
                                                gameId: game._id,
                                                transactionSlug: "extraTransaction",
                                                typeOfTransaction: "Refund",
                                                action: "credit", // debit / credit
                                                purchasedSlug: "realMoney", // point /realMoney
                                                totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                            }

                                            await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                        }

                                    }

                                    var ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);
                                    await Sys.App.Services.GameService.deleteGame(req.body.id)
                                    if (game.gameType == "game_2") {
                                        console.log("game terminate", req.body.id, Sys.Config.Namespace.Game2)
                                        await Sys.Io.of(Sys.Config.Namespace.Game2).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                    } else if (game.gameType == "game_3") {
                                        await Sys.Io.of(Sys.Config.Namespace.Game3).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                    } else if (game.gameType == "game_4") {
                                        await Sys.Io.of(Sys.Config.Namespace.Game4).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                    }
                                    return res.send("success");
                                }

                            }
                        } else {
                            if (game.gameType == "game_1") {

                                let allSubGames = await Sys.App.Services.GameService.getGameData({ parentGameId: req.body.id, status: "active" });
                                console.log("allSubGames", allSubGames)
                                if (allSubGames.length > 0) {
                                    let subGamesIds = [];
                                    for (let s = 0; s < allSubGames.length; s++) {
                                        let ticketIdArray = [];

                                        if (allSubGames[s].purchasedTickets.length > 0) {
                                            console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ] of manula game 1');
                                            for (let i = 0; i < allSubGames[s].purchasedTickets.length; i++) {
                                                //for (let j = 0; j < game.players.length; j++) {
                                                //if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                let transactionDataSend = {
                                                    playerId: allSubGames[s].purchasedTickets[i].playerIdOfPurchaser,
                                                    gameId: allSubGames[s]._id,
                                                    ticketId: allSubGames[s].purchasedTickets[i].ticketId,
                                                    transactionSlug: "refund",
                                                    action: "credit",
                                                    purchasedSlug: allSubGames[s].purchasedTickets[i].purchasedSlug,
                                                    totalAmount: (allSubGames[s].purchasedTickets[i].voucherId != '' && allSubGames[s].purchasedTickets[i].voucherId != null) ? allSubGames[s].purchasedTickets[i].isVoucherPayableAmount : allSubGames[s].purchasedTickets[i].totalAmount,
                                                }
                                                ticketIdArray.push(allSubGames[s].purchasedTickets[i].ticketParentId)
                                                if (allSubGames[s].purchasedTickets[i].userType != "Physical") {
                                                    await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);
                                                }

                                                subGamesIds.push(allSubGames[s]._id)
                                                //}
                                                //}
                                            }
                                        }
                                        console.log("----ticketIdArray in game delete----", ticketIdArray)
                                        if (ticketIdArray.length > 0) {
                                            Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: { $in: ticketIdArray }, isPurchased: true }, { isPurchased: false, playerIdOfPurchaser: "" });
                                        }
                                        for (let p = 0; p < allSubGames[s].players.length; p++) {
                                            if (allSubGames[s].players[p].userType != "Physical") {
                                                let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(allSubGames[s].players[p].id);

                                                //if (playerUpdated.enableNotification == true) {

                                                let TimeMessage = allSubGames[s].gameNumber + " [ " + allSubGames[s].gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                                let notification = {
                                                    notificationType: 'gameDeletedByAdmin',
                                                    message: TimeMessage
                                                }

                                                let dataNotification = {
                                                    playerId: allSubGames[s].players[p].id,
                                                    gameId: allSubGames[s]._id,
                                                    notification: notification
                                                }

                                                await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                                Sys.Helper.gameHelper.sendNotificationToOnePlayer(allSubGames[s]._id, allSubGames[s].players[p].id, TimeMessage, allSubGames[s].gameName, notification.notificationType);
                                                //}

                                                console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                                await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                                    gameType: (allSubGames[s].gameType == 'game_1') ? 1 : (allSubGames[s].gameType == 'game_2') ? 2 : (allSubGames[s].gameType == 'game_3') ? 3 : 0
                                                });


                                                let ownPurchasedTicketCount = allSubGames[s].purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(allSubGames[s].players[p].id));

                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                let newPointArr = [];
                                                let newRealArr = [];
                                                for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                                    if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                                        newPointArr.push(ownPurchasedTicketCount[o]);
                                                    } else {
                                                        newRealArr.push(ownPurchasedTicketCount[o]);
                                                    }
                                                }


                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                                if (newPointArr.length > 0) {

                                                    let newExtraTransaction = {
                                                        playerId: playerUpdated._id,
                                                        gameId: allSubGames[s]._id,
                                                        transactionSlug: "extraTransaction",
                                                        typeOfTransaction: "Refund",
                                                        action: "credit", // debit / credit
                                                        purchasedSlug: "points", // point /realMoney
                                                        totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                }

                                                if (newRealArr.length > 0) {

                                                    let newExtraTransaction = {
                                                        playerId: playerUpdated._id,
                                                        gameId: allSubGames[s]._id,
                                                        transactionSlug: "extraTransaction",
                                                        typeOfTransaction: "Refund",
                                                        action: "credit", // debit / credit
                                                        purchasedSlug: "realMoney", // point /realMoney
                                                        totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                                    }

                                                    await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                                }
                                            }


                                        }
                                        await Sys.App.Services.GameService.deleteGame(allSubGames[s]._id)
                                        Sys.App.Services.GameService.deleteTicketMany(allSubGames[s]._id);

                                    }
                                    if (subGamesIds.length > 0) {
                                        for (d = 0; d < subGamesIds.length; d++) {
                                            Sys.Io.of(Sys.Config.Namespace.Game1).to(subGamesIds[d]).emit('GameTerminate', { gameId: subGamesIds[d], message: "Game is deleted by Admin" });
                                        }
                                    }

                                } else {
                                    console.log("game 1 subgames not found");
                                }

                            } else {
                                if (game.purchasedTickets.length > 0) {
                                    console.log('\x1b[36m%s\x1b[0m', 'Deleted by admin Manual Game Not Start [ Refund Process ]');
                                    for (var i = 0; i < game.purchasedTickets.length; i++) {
                                        for (let j = 0; j < game.players.length; j++) {
                                            if (JSON.stringify(game.purchasedTickets[i].playerIdOfPurchaser) == JSON.stringify(game.players[j].id)) {

                                                var transactionDataSend = {
                                                    playerId: game.purchasedTickets[i].playerIdOfPurchaser,
                                                    gameId: game._id,
                                                    ticketId: game.purchasedTickets[i].ticketId,
                                                    transactionSlug: "refund",
                                                    action: "credit",
                                                    purchasedSlug: game.purchasedTickets[i].purchasedSlug,
                                                    totalAmount: game.ticketPrice,
                                                }

                                                await Sys.Helper.gameHelper.createTransactionPlayer(transactionDataSend);

                                            }
                                        }
                                    }
                                }

                                for (let p = 0; p < game.players.length; p++) {

                                    let playerUpdated = await Sys.Game.Game2.Services.PlayerServices.getById(game.players[p].id);

                                    //if (playerUpdated.enableNotification == true) {

                                    let TimeMessage = game.gameNumber + " [ " + game.gameName + " ] Game Deleted By Admin So Refund your money/points ..!! ";

                                    let notification = {
                                        notificationType: 'gameDeletedByAdmin',
                                        message: TimeMessage
                                    }

                                    let dataNotification = {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }

                                    await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

                                    Sys.Helper.gameHelper.sendNotificationToOnePlayer(game._id, game.players[p].id, TimeMessage, game.gameName, notification.notificationType);
                                    //}

                                    console.log("Games GameListRefresh to player :- ", playerUpdated.username, "with sokcetId", playerUpdated.socketId);
                                    await Sys.Io.to(playerUpdated.socketId).emit('GameListRefresh', {
                                        gameType: (game.gameType == 'game_1') ? 1 : (game.gameType == 'game_2') ? 2 : (game.gameType == 'game_3') ? 3 : 0
                                    });


                                    let ownPurchasedTicketCount = game.purchasedTickets.filter(item => JSON.stringify(item.playerIdOfPurchaser) == JSON.stringify(game.players[p].id));

                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund ] ::--->> ", ownPurchasedTicketCount.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    let newPointArr = [];
                                    let newRealArr = [];
                                    for (let o = 0; o < ownPurchasedTicketCount.length; o++) {
                                        if (ownPurchasedTicketCount[o].purchasedSlug == "points") {
                                            newPointArr.push(ownPurchasedTicketCount[o]);
                                        } else {
                                            newRealArr.push(ownPurchasedTicketCount[o]);
                                        }
                                    }


                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Points ] ::--->> ", newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    console.log("Total of ownPurchasedTicket Amount [ Game Deleted Refund Real ] ::--->> ", newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0))

                                    if (newPointArr.length > 0) {

                                        let newExtraTransaction = {
                                            playerId: playerUpdated._id,
                                            gameId: game._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "points", // point /realMoney
                                            totalAmount: newPointArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                        }

                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    }

                                    if (newRealArr.length > 0) {

                                        let newExtraTransaction = {
                                            playerId: playerUpdated._id,
                                            gameId: game._id,
                                            transactionSlug: "extraTransaction",
                                            typeOfTransaction: "Refund",
                                            action: "credit", // debit / credit
                                            purchasedSlug: "realMoney", // point /realMoney
                                            totalAmount: newRealArr.reduce((n, { totalAmount }) => n + totalAmount, 0),
                                        }

                                        await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
                                    }

                                }
                                let ticketData = await Sys.App.Services.GameService.deleteTicketMany(game._id);
                                if (game.gameType == "game_2") {
                                    console.log("game terminate", req.body.id, Sys.Config.Namespace.Game2)
                                    await Sys.Io.of(Sys.Config.Namespace.Game2).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                } else if (game.gameType == "game_3") {
                                    await Sys.Io.of(Sys.Config.Namespace.Game3).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                } else if (game.gameType == "game_4") {
                                    await Sys.Io.of(Sys.Config.Namespace.Game4).to(req.body.id).emit('GameTerminate', { gameId: req.body.id, message: "Game is deleted by Admin" });
                                }
                            }



                            await Sys.App.Services.GameService.deleteGame(req.body.id)
                            return res.send("success");
                        }
                    }
                } else {
                    return res.send("error");
                }
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewGameManagementDetails: async function (req, res) {
        try {
            let keys = [
                "dashboard",
                "view",
                "add",
                "edit_text",
                "save_as",
                "enter_name_of_game",
                "save",
                "please",
                "game_name",
                "enter",
                "start_date_and_time",
                "start_date",
                "end_date",
                "end_date_and_time",
                "start_time",
                "end_time",
                "select",
                "group_hall",
                "choose",
                "minimum_ticket_count",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "no",
                "yes",
                "how_many_bot_game_to_run",
                "total_bot_game_to_run",
                "is_bot_game",
                "add_sub_game",
                "submit",
                "cancel",
                "time_period",
                "sub_game_name",
                "ticket_price",
                "jackpot_number_and_prize",
                "seconds",
                "sub_games",
                "error",
                "in_cash",
                "in_percent",
                "add_group",
                "add_pattern",
                "group_name",
                "pattern_group",
                "atleast_one_goh_in_subgames",
                "min_ticket_count_should_be_greater_20",
                "remove"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameName] = obj;
            }

            let viewFlag = true;
            let addFlag = true;


            console.log("stringReplace", req.session.details.isPermission);

            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Physical Ticket Management'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

            }


            //console.log("subGameColorRow subGameColorRow  subGameList : ", subGameList)




            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let dataGame;
            let days = [];
            let timings = [];
            if (gameType.type === "game_2") {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
                if (Object.keys(dataGame.days).length) {
                    days = Object.keys(dataGame.days);
                    for (const day in dataGame.days) {
                        console.log(dataGame.days[day]);
                        timings.push(dataGame.days[day]);
                    }
                }
            } else if (gameType.type === "game_3") {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
                if (Object.keys(dataGame.days).length) {
                    days = Object.keys(dataGame.days);
                    for (const day in dataGame.days) {
                        console.log(dataGame.days[day]);
                        timings.push(dataGame.days[day]);
                    }
                }
            } else {
                if (gameType.type == 'game_4') {
                    dataGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
                } else {
                    dataGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
                }
            }
            console.log(" dataGame dataGame dataGame : ", dataGame)
            var startDateAt = moment(new Date(dataGame.startDate)).tz('UTC').format(); //dateTimeFunction(dataGame.startDate);
            var graceDateAt = moment(new Date(dataGame.graceDate)).tz('UTC').format();// dateTimeFunction(dataGame.graceDate);
            var endDateAt = moment(new Date(dataGame.endDate)).tz('UTC').format();
            console.log("start & grace time", startDateAt, graceDateAt, "endDate", endDateAt)
            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            // console.log("gameName dataGame dataGame", dataGame);
            let ptrn, arr = [];
            let theadField = [];
            if (dataGame.gameName == 'Game1') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Game Name',
                    'Ticket Color/Type',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Purchased From',
                    // 'Ticket Win in Wallet/Points',
                    'Winning Row',
                    'Total Winning',
                    //'Remark',
                    'Spin Wheel Winnings',
                    'Treasure Chest Winnings',
                    'Mystry Winnings',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game2') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Win in Wallet/Points',
                    'Winning On Jackpot Number',
                    'Total Winning',
                    'After Balance',
                    'Remark',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game3') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Start Date & Time',
                    'Ticket Number',
                    'Ticket Price',
                    'Ticket Win in Wallet/Points',
                    'Winning Pattern',
                    'Total Winning',
                    'Remark',
                    'Action'
                ]
            } else if (dataGame.gameName == 'Game4') {
                theadField = [
                    'Player Name',
                    'User Type',
                    'Winning Pattern',
                    'Total Winning',
                ]

                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });

                arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']

                let printDataPattern = dataGame.patternNamePrice[0];
                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                    ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
                }
            }

            let rowPatternData = [];
            let jackpot = [];
            let subGameNameArr = [];
            let subGamesTicketCount = [];
            if (dataGame.gameName == "Game1") {

                // Only Game Names
                dataGame.subGames.forEach(element => {
                    subGameNameArr.push(element.gameName);
                });

                // Row Pattern + Jackpot
                let GameRowPattern = dataGame.subGames;

                // console.log(" GameRowPattern GameRowPattern Game1 Game1 : ", GameRowPattern)

                for (let i = 0; i < GameRowPattern.length; i++) {
                    let jackpotObj = {}

                    let saveObj = {
                        gameName: GameRowPattern[i].gameName
                    }

                    let optionArraw = [];
                    for (let j = 0; j < GameRowPattern[i].options.length; j++) {
                        let option = {
                            ticketName: GameRowPattern[i].options[j].ticketName,
                        }

                        if (GameRowPattern[i].options[j].winning.row1) {
                            option.row1 = GameRowPattern[i].options[j].winning.row1;
                        }

                        if (GameRowPattern[i].options[j].winning.row2) {
                            option.row2 = GameRowPattern[i].options[j].winning.row2;
                        }

                        if (GameRowPattern[i].options[j].winning.row3) {
                            option.row3 = GameRowPattern[i].options[j].winning.row3;
                        }

                        if (GameRowPattern[i].options[j].winning.row4) {
                            option.row4 = GameRowPattern[i].options[j].winning.row4;
                        }

                        if (GameRowPattern[i].options[j].winning.row5) {
                            option.row5 = GameRowPattern[i].options[j].winning.row5;
                        }

                        if (GameRowPattern[i].options[j].winning.bingo) {
                            option.bingo = GameRowPattern[i].options[j].winning.bingo;
                        }
                        optionArraw.push(option);
                    }

                    saveObj.options = optionArraw;

                    rowPatternData.push(saveObj);

                    jackpotObj = {
                        gameName: GameRowPattern[i].gameName,
                        jackpotDraw: ((GameRowPattern[i].options.length > 0) ? GameRowPattern[i].options[0].jackpot.draw : '-'),
                        jackpotPrize: ((GameRowPattern[i].options.length > 0) ? GameRowPattern[i].options[0].jackpot.price : '-'),
                    }

                    jackpot.push(jackpotObj);
                }

                // Ticket Create and it's price
                for (let j = 0; j < GameRowPattern.length; j++) {
                    let subGamesTicketCountObj = {}
                    let optionArr = [];
                    for (let k = 0; k < GameRowPattern[j].options.length; k++) {
                        let optionObj = {
                            ticketType: GameRowPattern[j].options[k].ticketName,
                            ticketCount: GameRowPattern[j].options[k].ticketCount,
                            ticketPrice: GameRowPattern[j].options[k].ticketPrice,
                        }
                        optionArr.push(optionObj);
                    }

                    subGamesTicketCountObj.gameName = GameRowPattern[j].gameName;
                    subGamesTicketCountObj.optionList = optionArr;
                    subGamesTicketCount.push(subGamesTicketCountObj);
                }
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: dataGame,
                DisplayBall: dataGame?.history?.number,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                EndTime: endDateAt,
                gameData: gameType,
                patternData: (ptrn) ? ptrn : [],
                theadField: theadField,
                subGameNameArr: subGameNameArr,
                rowPatternData: rowPatternData,
                jackpot: jackpot,
                subGamesTicketCount: subGamesTicketCount,
                subGameColorRow: subGameColorRow,
                viewFlag: viewFlag,
                addFlag: addFlag,
                days: days,
                timings: timings,
                translate: translate,
                navigation: translate
            };
            if (gameType.type === "game_3") {
                return res.render('GameManagement/game3View', data);
            } else {
                return res.render('GameManagement/gameView', data);
            }
        } catch (e) {
            console.log("Error", e);
        }
    },
    viewsubGamesManagement: async function (req, res) {
        try {
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            //let shiv = await redisClient.get('game3')
            //console.log("shiv", shiv);
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }


            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let startFlag = true;
            let pauseFlag = true;

            console.log("stringReplace", req.session.details.isPermission);

            if(!req.session.details.isSuperAdmin){
                var stringReplace = req.session.details.isPermission['Games Management'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("start") == -1) {
                    startFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("pause") == -1) {
                    pauseFlag = false;
                }

            }


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                DataOfGames: gameData,
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                startFlag: startFlag,
                pauseFlag: pauseFlag,
                gameTypeId: req.params.typeId,
                id: req.params.id,

            };
            return res.render('GameManagement/mainSubGames', data);


        } catch (error) {
            Sys.Log.error('Error in viweGameManagement: ', error);
            return new Error(error);
        }
    },
    viewsubGamesManagementDetails: async function (req, res) {
        try {

            //console.log("getGameManagementDetailList calling", req.query);
            let id = req.query.gameId;
            //let order = req.query.order;
            let sort = {};
            // if (order.length) {
            //     let columnIndex = order[0].column;
            //     let sortBy = req.query.columns[columnIndex].data;
            //     sort = {
            //         [sortBy]: order[0].dir == "asc" ? 1 : -1
            //     }
            // }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            //let search = req.query.search.value;
            var gameName;
            let query = {}
            if (req.query.gameType == "game_1") {
                gameType = "game_1";
                query = { gameType: gameType, status: "active", isMasterGame: false, parentGameId: id };
            }

            if (req.query.search && req.query.search.value != '') {
                if (req.query.gameType == "game_1") {
                    query = { gameNumber: { $regex: '.*' + req.query.search.value + '.*' }, gameName: gameName, status: "active", isMasterGame: false, parentGameId: id };
                } else {
                    query = { gameNumber: { $regex: '.*' + req.query.search.value + '.*' }, gameName: gameName, status: "active", parentGameId: id };
                }
            }

            console.log("++++++++++++++++++++   ++++++++++++++++++++ ", query);


            let reqCount = await Sys.App.Services.GameService.getSelectedGameCount(query);
            let data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);

            // console.log(" data data data : reqCount reqCount ",data)


            let gameData = [],
                patternName = [];
            if (req.query.gameType == "game_1") {

                for (let i = 0; i < data.length; i++) {

                    let dataGame = {}
                    let winnerAmount = 0;
                    if (data[i].purchasedTickets.length > 0) {

                        let GameAtm = await Sys.App.Services.GameService.getSingleGameData({ _id: data[i]._id });

                        for (let atm = 0; atm < GameAtm.purchasedTickets.length; atm++) {
                            winnerAmount += Number(GameAtm.purchasedTickets[atm].totalAmount)
                        }

                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            gameName: data[i].subGames,
                            ticketColorType: data[i].subGames,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: Number(winnerAmount),
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }

                    } else {
                        dataGame = {
                            _id: data[i]._id,
                            gameNumber: data[i].gameNumber,
                            gameMode: data[i].gameMode,
                            startDate: data[i].startDate,
                            graceDate: data[i].graceDate,
                            gameName: data[i].subGames,
                            ticketColorType: data[i].subGames,
                            ticketPrice: data[i].ticketPrice,
                            totalNumberOfTicketsSold: Number(data[i].purchasedTickets.length),
                            totalEarnedFromTicketsSold: 0,
                            totalWinningInTheGame: Number(data[i].winners.length),
                            seconds: Number(data[i].seconds / 1000),
                        }
                    }


                    if (data[i].gameMode == 'auto' && data[i].graceDate == null) {
                        continue;
                    }
                    gameData.push(dataGame);
                }
            }



            function compareValues(key, order = 'asc') {
                return function innerSort(a, b) {
                    if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                        // property doesn't exist on either object
                        return 0;
                    }

                    const varA = (typeof a[key] === 'string') ?
                        a[key].toUpperCase() : a[key];
                    const varB = (typeof b[key] === 'string') ?
                        b[key].toUpperCase() : b[key];

                    let comparison = 0;
                    if (varA > varB) {
                        comparison = 1;
                    } else if (varA < varB) {
                        comparison = -1;
                    }
                    return (
                        (order === 'desc') ? (comparison * -1) : comparison
                    );
                };
            }

            let keyData = Object.keys(sort);
            let valueData = Object.values(sort);

            if (valueData[0] == 1) {
                gameData.sort(compareValues(keyData));
            } else if (valueData[0] == -1) {
                gameData.sort(compareValues(keyData, 'desc'));
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            console.log("data:::::::::::----------------:::::::", gameData)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    getGroupHallData: async function (req, res) {
        try {
            console.log('req.query', req.query.id)
            let hallData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: req.query.id });
            console.log('hallData', hallData);
            if (hallData) {
                return res.send({ status: 'success', halls: hallData.halls });
            } else {
                return res.send({ status: "error" });
            }
        } catch (error) {
            console.log('error in getGroupHallData:-', error);
            return res.send({ status: "error" });
        }
    },

    viewPhysicalGameHistory: async function (req, res) {
        try {
            console.log("viewPhysicalGameHistory ::>>", req.params);

            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }

            var dataGame = {};
            let gameData = [];

            //console.log("sort", sort);
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let mainGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            let subGame = [];
            for (let j = 0; j < (mainGame.subGames).length; j++) {
                subGame.push(mainGame.subGames[j].subGameId);
            }


            //let query = { "gameId": {$in:subGame}, "userType": "Unique"};
            let query = { "gameId": req.params.id, "playerTicketType": "Physical" };

            console.log(" req.session.details req.session.details : ", req.session.details)

            if (req.session.details && req.session.details.role == 'agent') {
                query.isAgentTicket = true;
                query.agentId = req.session.details.id;
            }

            let ticketCount = await Sys.App.Services.GameService.getTicketsCount(query);
            let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);

            console.log(" ticketCount ticketCount ticketCount ticketCount ticketCount :", ticketCount, " ticketData ticketData ticketData : ", ticketInfo, " sort sort : ", sort, " query query query : ", query)
            if (ticketInfo.length > 0) {
                for (let j = 0; j < ticketInfo.length; j++) {
                    let amount = 0;
                    //let ticketPurchasedform = 'realMoney'
                    if (ticketInfo[j].winningStats) {
                        amount = ticketInfo[j].winningStats.finalWonAmount;
                        winningLine = ticketInfo[j].winningStats.lineTypeArray;
                        //ticketPurchasedform = ticketInfo[j].winningStats.walletType; 
                    }
                    // let remark = "loss"
                    // if(ticketInfo[j].isPlayerWon==true){
                    //     remark = "Won"
                    // }
                    let userType = "-";
                    if (ticketInfo[j].userType) {
                        userType = ticketInfo[j].userType;
                    }

                    if (ticketInfo[j].userType == "Online") {
                        userType = "Online User";
                    }

                    let winningPattern = ticketInfo[j].winningStats;
                    console.log("winningPattern", winningPattern);
                    if (winningPattern) {
                        if (ticketInfo[j].bonusWinningStats) {
                            if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                            }
                        }

                        if (ticketInfo[j].luckyNumberWinningStats) {
                            if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
                            }
                        }

                    }

                    let wofWinners = "-";
                    if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
                        wofWinners = ticketInfo[j].wofWinners[0].WinningAmount;
                    }

                    let tChestWinners = "-";
                    if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
                        tChestWinners = ticketInfo[j].tChestWinners[0].WinningAmount;
                    }

                    let mystryWinners = "-";
                    if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
                        mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                    }

                    let dataGame = {
                        _id: ticketInfo[j]._id,
                        playerNameOfPurchaser: ticketInfo[j].playerNameOfPurchaser,
                        userType: userType,
                        gameStartDate: ticketInfo[j].gameStartDate,
                        ticketId: ticketInfo[j].ticketId,
                        ticketPrice: ticketInfo[j].ticketPrice,
                        ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                        //remark          : remark,
                        winnigPattern: ticketInfo[j].winningStats,
                        totalWinning: amount,
                        ticketColorType: ticketInfo[j].ticketColorType,
                        gameName: ticketInfo[j].gameName,
                        wofWinners: wofWinners,
                        tChestWinners: tChestWinners,
                        mystryWinners: mystryWinners,
                        uniquePlayerId: ticketInfo[j].uniquePlayerId,
                    }
                    gameData.push(dataGame);
                }
            }


            let obj = {
                'draw': req.query.draw,
                'recordsTotal': ticketCount,
                'recordsFiltered': ticketCount,
                'data': gameData,
                '': ''
            };

            res.send(obj);

        } catch (e) {
            console.log("Error in physicalGamehistory", e);
        }
    },

    viewGameHistory: async function (req, res) {
        try {
            console.log("viewGameHistory ::>>", req.query);
            let order = req.query.order;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            //console.log("sort", sort);
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;
            let query = { _id: req.params.id };
            // if (search != '') {
            //     query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName, status: "active" };
            // }

            let data = await Sys.App.Services.GameService.getById(query);
            var dataGame = {};
            let gameData = [];
            let gameTransactionHistory;
            let ticketsCount = 0;
            if (req.params.gameName == "Game1") {
                /*gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id,
                });
                var dataGame = {
                    // _id: data._id,
                    // playerName: "",
                    // UserType: "",
                    // startDate: "",
                    // ticketNumber: "",
                    // ticketPrice: "",
                    // ticketPurchasedform: "",
                    // winnigPattern: "",
                    // totalWinning: "",
                    // ticketId: ""
                }
                gameData.push(gameTransactionHistory);*/

                // game 1 ticket history with winnings
                if (sort.totalWinning) {
                    sort = { 'winningStats.finalWonAmount': sort.totalWinning }
                }
                if (sort.wofWinners) {
                    sort = { 'wofWinners.WinningAmount': sort.wofWinners }
                }
                console.log("length, start, sort", length, start, sort)
                let data = await Sys.App.Services.GameService.getById({ _id: req.params.id });
                ticketsCount = await Sys.App.Services.GameService.getTicketCount({ gameId: req.params.id, userType: ((req.query.userType).trim()), playerTicketType: "Online" });
                let ticketInfo = await Sys.App.Services.GameService.getTicketDatatable({ gameId: req.params.id, userType: ((req.query.userType).trim()), playerTicketType: "Online" }, length, start, sort);

                console.log(" data data data -------------------: ", req.query.userType, " ticketsCount: ", ticketsCount, " ticketInfo : ", ticketInfo);

                if (ticketInfo.length > 0) {
                    for (let j = 0; j < ticketInfo.length; j++) {
                        let amount = 0;
                        //let ticketPurchasedform = 'realMoney'
                        if (ticketInfo[j].winningStats) {
                            amount = ticketInfo[j].winningStats.finalWonAmount;
                            winningLine = ticketInfo[j].winningStats.lineTypeArray;
                            //ticketPurchasedform = ticketInfo[j].winningStats.walletType; 
                        }
                        // let remark = "loss"
                        // if(ticketInfo[j].isPlayerWon==true){
                        //     remark = "Won"
                        // }
                        let userType = "-";
                        if (ticketInfo[j].userType) {
                            userType = ticketInfo[j].userType;
                        }
                        if (ticketInfo[j].userType == "Online") {
                            userType = "Online User";
                        }
                        let winningPattern = ticketInfo[j].winningStats;
                        console.log("winningPattern", winningPattern);
                        if (winningPattern) {
                            if (ticketInfo[j].bonusWinningStats) {
                                if (ticketInfo[j].bonusWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].bonusWinningStats.wonAmount;
                                    winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].bonusWinningStats.lineType, wonAmount: ticketInfo[j].bonusWinningStats.wonAmount })
                                }
                            }

                            if (ticketInfo[j].luckyNumberWinningStats) {
                                if (ticketInfo[j].luckyNumberWinningStats.wonAmount > 0) {
                                    amount += +ticketInfo[j].luckyNumberWinningStats.wonAmount;
                                    winningPattern.lineTypeArray.push({ lineType: ticketInfo[j].luckyNumberWinningStats.lineType, wonAmount: ticketInfo[j].luckyNumberWinningStats.wonAmount })
                                }
                            }

                            // if(ticketInfo[j].tChestWinners.length > 0){
                            //     if(ticketInfo[j].tChestWinners[0].WinningAmount > 0){
                            //         amount +=  +ticketInfo[j].tChestWinners[0].WinningAmount;
                            //         winningPattern.lineTypeArray.push({ lineType: "Treasure Chest Extra Winning", wonAmount: ticketInfo[j].tChestWinners[0].WinningAmount })
                            //     } 
                            // }

                            // if(ticketInfo[j].mystryWinners.length > 0){
                            //     if(ticketInfo[j].mystryWinners[0].WinningAmount > 0){
                            //         amount +=  +ticketInfo[j].mystryWinners[0].WinningAmount;
                            //         winningPattern.lineTypeArray.push({ lineType: "Mystry Extra Winning", wonAmount: ticketInfo[j].mystryWinners[0].WinningAmount })
                            //     } 
                            // }
                        }

                        let wofWinners = "-";
                        if (ticketInfo[j].wofWinners && ticketInfo[j].wofWinners.length > 0) {
                            wofWinners = ticketInfo[j].wofWinners[0].WinningAmount;
                        }

                        let tChestWinners = "-";
                        if (ticketInfo[j].tChestWinners && ticketInfo[j].tChestWinners.length > 0) {
                            tChestWinners = ticketInfo[j].tChestWinners[0].WinningAmount;
                        }

                        let mystryWinners = "-";
                        if (ticketInfo[j].mystryWinners && ticketInfo[j].mystryWinners.length > 0) {
                            mystryWinners = ticketInfo[j].mystryWinners[0].WinningAmount;
                        }

                        let dataGame = {
                            _id: ticketInfo[j]._id,
                            playerNameOfPurchaser: ticketInfo[j].playerNameOfPurchaser,
                            UserType: userType,
                            startDate: data.startDate,
                            ticketId: ticketInfo[j].ticketId,
                            ticketPrice: ticketInfo[j].ticketPrice,
                            ticketPurchasedFrom: ticketInfo[j].ticketPurchasedFrom,
                            //remark          : remark,
                            winnigPattern: ticketInfo[j].winningStats,
                            totalWinning: amount,
                            ticketColorType: ticketInfo[j].ticketColorType,
                            gameName: data.subGames[0].gameName,
                            wofWinners: wofWinners,
                            tChestWinners: tChestWinners,
                            mystryWinners: mystryWinners
                        }
                        gameData.push(dataGame);
                    }
                }

                console.log("gameData", dataGame)

            } else if (req.params.gameName == "Game2") {

                console.log(" req.query req.query : ", req.query)

                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id, userType: ((req.query.userType).trim()),
                });
                for (var i = 0; i < gameTransactionHistory.length; i++) {
                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "autoTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }
                    let UserType = "Apk";
                    if (gameTransactionHistory[i].userType != "Online") {
                        UserType = gameTransactionHistory[i].userType
                    }
                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: UserType, //'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        winningJackpotNumber: (typeof gameTransactionHistory[i].winningJackpotNumber !== "undefined") ? Number(gameTransactionHistory[i].winningJackpotNumber) : '--',
                        totalWinning: (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        afterBalance: Number(gameTransactionHistory[i].afterBalance),
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);
                }
            } else if (req.params.gameName == "Game3") {
                dataGame = {}
                gameTransactionHistory = await Sys.App.Services.transactionServices.getByData({
                    gameId: data._id, userType: ((req.query.userType).trim())
                });
                var patternHistoryWinner = data.patternWinnerHistory;
                for (var i = 0; i < gameTransactionHistory.length; i++) {

                    if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "cancelTicket") {
                        continue;
                    }

                    if (gameTransactionHistory[i].defineSlug == "refund") {
                        continue;
                    }

                    let UserType = "Apk";
                    if (gameTransactionHistory[i].userType != "Online") {
                        UserType = gameTransactionHistory[i].userType
                    }
                    dataGame = {
                        _id: data._id,
                        playerName: gameTransactionHistory[i].playerName,
                        UserType: UserType, //'Apk',
                        startDate: data.startDate,
                        ticketNumber: gameTransactionHistory[i].ticketNumber,
                        ticketPrice: Number(data.ticketPrice),
                        defineSlug: gameTransactionHistory[i].defineSlug,
                        ticketPurchasedform: gameTransactionHistory[i].amtCategory,
                        winningPattern: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? patternHistoryWinner[0].patternName : "--",
                        totalWinning: (patternHistoryWinner.filter(obj => JSON.stringify(obj.ticketId) == JSON.stringify(gameTransactionHistory[i].ticketId)).length > 0) ? eval(parseFloat(patternHistoryWinner[0].patternPrize).toFixed(2)) : (typeof gameTransactionHistory[i].winningPrice !== "undefined") ? eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)) : '--',
                        remark: gameTransactionHistory[i].remark,
                        ticketId: gameTransactionHistory[i].ticketId
                    }
                    gameData.push(dataGame);

                }
            } else if (req.params.gameName == "Game4") {
                let subGameData = await Sys.App.Services.GameService.getBySubGameData({ parentGameId: data._id, status: "finish" });
                for (let j = 0; j < subGameData.length; j++) {
                    gameTransactionHistory = await Sys.App.Services.transactionServices.getByDataNew({
                        gameId: subGameData[j]._id, userType: ((req.query.userType).trim())
                    });
                    for (var i = 0; i < gameTransactionHistory.length; i++) {
                        if (gameTransactionHistory[i].defineSlug == "buyTicket") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "treasureChest") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "mystery") {
                            continue;
                        }

                        if (gameTransactionHistory[i].defineSlug == "Spin") {
                            continue;
                        }
                        let UserType = "Apk";
                        if (gameTransactionHistory[i].userType != "Online") {
                            UserType = gameTransactionHistory[i].userType
                        }
                        dataGame = {
                            playerName: gameTransactionHistory[i].playerName,
                            UserType: UserType, //'Apk',
                            defineSlug: gameTransactionHistory[i].defineSlug,
                            winningPattern: gameTransactionHistory[i].patternName,
                            totalWinning: eval(parseFloat(gameTransactionHistory[i].winningPrice).toFixed(2)),
                        }
                        gameData.push(dataGame);
                    }
                }
            }

            if (req.params.gameName == "Game2" || req.params.gameName == "Game3" || req.params.gameName == "Game4") {
                function limit(c) {
                    return this.filter((x, i) => {
                        if (i <= (c - 1)) { return true }
                    })
                }

                Array.prototype.limit = limit;

                function skip(c) {
                    return this.filter((x, i) => {
                        if (i > (c - 1)) { return true }
                    })
                }

                Array.prototype.skip = skip;

                function compareValues(key, order = 'asc') {
                    return function innerSort(a, b) {
                        if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
                            // property doesn't exist on either object
                            return 0;
                        }

                        const varA = (typeof a[key] === 'string') ?
                            a[key].toUpperCase() : a[key];
                        const varB = (typeof b[key] === 'string') ?
                            b[key].toUpperCase() : b[key];

                        let comparison = 0;
                        if (varA > varB) {
                            comparison = 1;
                        } else if (varA < varB) {
                            comparison = -1;
                        }
                        return (
                            (order === 'desc') ? (comparison * -1) : comparison
                        );
                    };
                }

                console.log("sort", sort);

                let keyData = Object.keys(sort);
                let valueData = Object.values(sort);
                console.log("keyData", keyData[0]);
                console.log("valueData", valueData[0]);


                if (valueData[0] == 1) {
                    gameData.sort(compareValues(keyData));
                } else if (valueData[0] == -1) {
                    gameData.sort(compareValues(keyData, 'desc'));
                }


                let filtered = gameData.skip(start).limit(length);


                if (req.params.gameName == "Game1") {
                    if (filtered[0].length === 0) {
                        filtered = [];
                    }
                }

                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                    'recordsFiltered': (req.params.gameName == "Game4") ? gameData.length : (filtered.length > 0) ? filtered.length : 0,
                    'data': filtered,
                };
                console.log(" gameData gameData gameData game 2 : ", gameData)
                res.send(obj);
            } else {
                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': ticketsCount,
                    'recordsFiltered': ticketsCount,
                    'data': gameData,
                };

                res.send(obj);
            }




        } catch (e) {
            console.log("Error", e);
        }
    },

    viewTicket: async function (req, res) {
        try {
            let keys = [
                "view_ticket",
                "count_total_number_displayed",
                "total_number_displayed",
                "dashboard",
                "winner_type",
                "win_pattern",
                "winning_amount",
                "ticket_display",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let query = {
                _id: req.params.id
            };

            console.log("++++++++++++++++++------------------------- : ", req.params)

            let ticketData = await Sys.App.Services.GameService.getByIdTicket(query);
            console.log(" gameData gameData gameData gameData : ", ticketData.tickets)

            let gameData = {};
            if (ticketData) {
                gameData = await Sys.App.Services.GameService.getSingleGameData({ _id: ticketData.gameId });
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: gameData,
                ticketData: ticketData,
                gameReport: translate,
                navigation: translate
            };
            return res.render('GameManagement/ticketView', data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    viewGameTickets: async function (req, res) {
        try {
            let keys = [
                "table",
                "game_history",
                "dashboard",
                "view_tickets",
                "count_total_number_displayed",
                "total_number_displayed",
                "ticket_display",
                "winner_type",
                "win_pattern",
                "winning_amount",
                "game_tickets_are_availbale",
                "ongoing_game2",
                "recent_game",
                "group_of_hall_name",
                "hall_name",
                "reset",
                "group_of_hall_name",
                "player_name",
                "player_name_uniqueid",
                "user_type",
                "ticket_number",
                "ticket_price",
                "purcahsed_with_kr_points",
                "winning_on_jackpot_number",
                "winning_on_lucky_number",
                "total_winnings",
                "username",
                "view_game",
                "all",
                "remark",
                "action",
                "real",
                "bot",
                "search",
                "show",
                "entries",
                "previous",
                "next",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("ViewGameTickets ::", req.params);

            let query = {
                _id: req.params.typeId
            };

            console.log("++++++++++++++++++------------------------- : ", req.params)

            let gameData = await Sys.App.Services.GameService.getByIdGameType(query);
            console.log(" gameData gameData gameData gameData : ", gameData);
            let Game = await Sys.App.Services.GameService.getSingleGameData({ gameNumber: req.params.id });

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: Game,
                gameData: gameData,
                translate: translate,
                navigation: translate
            };
            return res.render('GameManagement/viewGameTickets', data);
        } catch (e) {
            console.log("Error in viewGameTickets", e);
        }
    },

    getTicketTable: async function (req, res) {
        try {
            console.log("coming here", req.query, req.params);
            let gameType = await Sys.App.Services.GameService.getByIdGameType(req.params.typeId);
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });
            let total = gameData = 0;
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            //let userType = req.query.params.userType === 'UniqueID' ? "Unique" : "Online";
            let groupHallName = req.query.params.groupHall;
            let hallName = req.query.params.hallName;
            let order = req.query.order;
            let search = req.query.search.value;
            let sort = {};
            if (order.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            if (!sort.hasOwnProperty('ticketId')) {
                sort.ticketId = 1;
            }
            let query = {
                "gameId": req.params.id,
                "isPurchased": true,
                "$or": [{ "isCancelled": false }, { "isCancelled": { "$exists": false } }]
            }

            if (req.session.details.role == 'agent') {
                hallName = req.session.details.hall[0].id;
            }

            // for bot game
            let userType = "";
            if (game.gameType == "game_2" && game.otherData && game.otherData.isBotGame && game.otherData.isBotGame == true) {
                if (req.query.params.userType != "") {
                    userType = (req.query.params.userType === 'UniqueID') ? "Unique" : (req.query.params.userType === 'Bot') ? "Bot" : (req.query.params.userType === 'Digital') ? "Online" : "";
                }
            } else {
                userType = (req.query.params.userType === 'UniqueID') ? "Unique" : (req.query.params.userType === 'Bot') ? "Bot" : (req.query.params.userType === 'Digital') ? "Online" : "";
            }
            // for bot game

            if (userType !== '') {
                query['userType'] = userType;
            }
            if (groupHallName !== '') {
                query['groupHallId'] = groupHallName;
            }
            if (hallName !== '') {
                query['hallId'] = hallName;
            }
            total = await Sys.App.Services.GameService.getTicketsCount(query);
            gameData = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, sort);
            let ticketData = [];
            if (gameType.type === 'game_2' || gameType.type === 'game_3') {
                if (gameData.length) {
                    for (let i = 0; i < gameData.length; i++) {
                        ticketData.push({
                            'ticketId': gameData[i]._id,
                            'userName': gameData[i].playerNameOfPurchaser ? gameData[i].playerNameOfPurchaser : "---",
                            'userType': gameData[i].userType,
                            'groupHall': gameData[i].groupHallName ? gameData[i].groupHallName : "---",
                            'hall': gameData[i].hallName,
                            'ticketNum': gameData[i].ticketId,
                            'price': gameData[i].ticketPrice,
                            'purchaseType': gameData[i].ticketPurchasedFrom,
                            'numArray': gameData[i].tickets,
                            'jackpotWinning': 0,
                            'luckyNumberWinning': 0,
                            'totalWinningOfTicket': +parseFloat(gameData[i].totalWinningOfTicket).toFixed(2), // eval(parseFloat(gameData[i].winningStats.finalWonAmount).toFixed(2)),//gameData[i].totalWinningOfTicket,
                            'remarks': '--',
                            'lineTypeArray': (gameData[i].winningStats.lineTypeArray && gameData[i].winningStats.lineTypeArray.length > 0) ? gameData[i].winningStats.lineTypeArray : [],
                        });
                        if (gameData[i].winningStats.lineTypeArray && gameData[i].winningStats.lineTypeArray.length > 0) {
                            let luckyNumber = gameData[i]?.luckyNumberWinningStats?.wonAmount || 0;
                            ticketData[i]['jackpotWinning'] = eval(parseFloat(gameData[i].winningStats.finalWonAmount).toFixed(2));
                            ticketData[i]['remarks'] = gameData[i].winningStats.lineTypeArray[0].remarks ? gameData[i].winningStats.lineTypeArray[0].remarks : "--";
                            ticketData[i]['luckyNumberWinning'] = luckyNumber;
                        }
                    }
                }
            }
            console.log("Length of resultant array", ticketData.length);
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': total,
                'recordsFiltered': total,
                'data': ticketData.length ? ticketData : 0
            };
            return res.send(obj);
        } catch (error) {
            console.log("Error in getTicketTable::::", error);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': 0,
            });
        }
    },

    // editTicket: async function(req,res){
    //     try {

    //         let query = {
    //             _id: req.params.id
    //         };

    //         console.log("++++++++++++++++++------------------------- : ",req.params)

    //         let subGame = await Sys.App.Services.GameService.getSingleGameData({_id:req.params.gameId});

    //         let ticketData = await Sys.App.Services.GameService.getByIdTicket(query);
    //         console.log(" subGame subGame subGame subGame subGame : ",ticketData)

    //         var data = {
    //             App: Sys.Config.App.details,
    //             Agent: req.session.details,
    //             error: req.flash("error"),
    //             success: req.flash("success"),
    //             GameMenu: 'active',
    //             ticketData: ticketData,
    //             subGameData:subGame

    //         };
    //         return res.render('GameManagement/editTicket', data);
    //     } catch (e) {
    //         console.log("Error", e);
    //     }
    // },
    // [ Saved Game ]
    savedGameList: async function (req, res) {
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
                // let stringReplace = user.permission['Save Game List'] || [];
                let stringReplace =req.session.details.isPermission['Save Game List'] || [];

                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // const stringReplace = req.session.details.isPermission['Save Game List'];

                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
            }
            const permObj = {
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag
            }
            let keys = [
                "choose_a_game",
                "choose_game_type",
                "table",
                "view_schedule",
                "delete_schedule",
                "add_close_day",
                "all",
                "active",
                "upcoming",
                "search_game_name",
                "search",
                "add_special_game",
                "create_daily_schedule",
                "sure_want_to_stop_game",
                "not_be_able_to_recover_game",
                "yes",
                "no",
                "stop_after_completing_running_game",
                "game_will_stop_after_completing_running_game",
                "sorry_game_not_stopeed",
                "game_not_stopped",
                "stopped",
                "cancelled",
                "not_be_able_to_resume_if_stopped",
                "show",
                "entries",
                "previous",
                "next",
                "add",
                "are_you_sure",
                "not_able_to_recover_after_delete",
                "yes_delete",
                "no_cancle",
                "deleted",
                "game_delete_success",
                "game_not_deleted_as_about_to_start",
                "game_not_deleted",
                "view_game",
                "edit_game",
                "stop_game",
                "add_close_day",
                "delete_game",
                "view",
                "not_able_to_recover_daily_schedule_after_delete",
                "daily_schedule_delete_success",
                "daily_schedule_not_deleted_as_game_aboutto_start",
                "daily_schedule_not_deleted"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            const gameType = await Sys.App.Services.GameService.getByDataSortGameType({});

            const gameData = [];
            for (let i = 0; i < gameType.length; i++) {
                const dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                DataOfGames: gameData,
                permissionObj: permObj,
                gameManage: translate,
                navigation: translate
            };
            return res.render('savedGame/list', data);


        } catch (error) {
            Sys.Log.error('Error in savedGameList: ', error);
            return new Error(error);
        }
    },

    savedGameDetailList: async function (req, res) {
        try {
            let keys = [
                "sr_no",
                "status",
                "action",
                "game_id",
                "game_name",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            var gameType;
            //console.log("Req.params calling", req.params);

            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            let Game;
            if (gameType.type == 'game_4') {
                Game = await Sys.App.Services.GameService.getSelectedSavedGameCount({ gameType: 'game_4' });
            } else if (gameType.type == "game_5") {
                Game = await Sys.App.Services.GameService.getSelectedSavedGameCount({ gameType: 'game_5' });
            } else {
                Game = 0;
            }

            var theadField = [
                translate.sr_no, //'Sr No',
                translate.game_id, //'Game ID',
                translate.game_name, //'Game Name',
                translate.action //'Action'
            ];

            var data = {
                gameData: gameType,
                theadField: theadField,
                Game: Game
            };
            console.log('data', data);
            res.send(data);

        } catch (error) {
            Sys.Log.error('Error in savedGameDetailList: ', error);
            return new Error(error);
        }
    },

    getSavedGameDetailList: async function (req, res) {
        try {
            console.log("query in getSavedGameDetailList", req.query.gameType);
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
            var gameName;

            let query = { gameType: gameName, status: "active" };

            if (req.query.gameType == "game_1") {
                gameName = "game_1";
                query = { status: "active", isSavedGame: true }
            } else if (req.query.gameType == "game_2") {
                gameName = "game_2";
                query.gameType = "game_2"
            } else if (req.query.gameType == "game_3") {
                gameName = "game_3";
                query.gameType = "game_3";
            } else if (req.query.gameType == "game_4") {
                gameName = "game_4";
            } else if (req.query.gameType == "game_4") {
                gameName = "game_5";
            }


            if (search != '') {
                if (req.query.gameType == "game_1") {
                    query = { name: { $regex: '.*' + search + '.*', $options: 'i' }, status: "active", isSavedGame: true };
                } else {
                    query = { gameName: { $regex: '.*' + search + '.*', $options: 'i' }, gameType: gameName, status: "active" };
                }

            }
            console.log('query', query);

            let reqCount = 0;
            let data = [];
            if (req.query.gameType == "game_1") {
                if (req.session.details.role == "agent") {
                    query['$or'] = [{ createrId: req.session.details.id }, { isAdminSavedGame: true }]
                }
                reqCount = await Sys.App.Services.scheduleServices.getDailySchedulesCount(query);
                data = await Sys.App.Services.scheduleServices.getDailySchedulesByData(query, { name: 1, dailyScheduleId: 1 }, { sort: { status: -1 }, limit: length, skip: start });
            } else {
                if (req.session.details.role == "agent") {
                    query['$or'] = [{ createrId: req.session.details.id }, { isAdminSave: true }]
                }
                reqCount = await Sys.App.Services.GameService.getSelectedSavedGameCount(query);
                data = await Sys.App.Services.GameService.getSavedGame(query, length, start);
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (error) {
            Sys.Log.error('Error in getSavedGameDetailList: ', error);
            return new Error(error);
        }
    },

    addSavedGameManagement: async function (req, res) {
        try {
            console.log("addSaveGamePostData params", req.params.typeId, req.params.type);
            console.log("addSavedGameManagement: ", req.body);
            console.log("req.params: ", req.params);

            let timeZone = req.body.ctimezone;
            let startTime = req.body.start_date;
            if (req.body.start_date) {
                startTime = moment.tz(req.body.start_date, timeZone);
                console.log("startTime in save game management debug 1", timeZone, startTime);
                startTime.utc().toDate();
                console.log("startTime in save game management debug 2", startTime);
            }

            let graceTime = '';
            if (req.body.grace_time) {
                graceTime = moment.tz(req.body.grace_time, timeZone);
                graceTime.utc().toDate();
            }
            // console.log("timezone,startTime, graceTime", timeZone, startTime, graceTime)

            var ID = Date.now()
            var createID = dateTimeFunction(ID);

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

            var game;

            if (req.params.type == "game_1") {
                let storeGamesData = [];
                let trafficLightOption = [];

                // For Single Game
                if (typeof (req.body.gameNameSelect) === 'string') {

                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];


                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);
                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);

                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                        }

                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }


                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";
                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });
                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isLuckyBonus: rowPattern[j].isLuckyBonus,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                            }

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;

                                    //tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    }
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;

                                    //tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    }
                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);
                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate
                        //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isLuckyBonus: rowPattern[j].isLuckyBonus,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            tmpObj.rowKey = rowPattern[j].patType;
                            tmpObj.rowName = rowPattern[j].name;

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];
                        let ticketColorTypesNo = [];

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);

                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                            }

                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }


                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            //saveObj[ColorName] 
                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });


                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;

                                        //tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        }

                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;

                                        //tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        }
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);
                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                            //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                }

                                tmpObj.rowKey = rowPattern[j].patType;
                                tmpObj.rowName = rowPattern[j].name;

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof (hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof (req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }

                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: req.params.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, //req.body.grace_time,
                    minTicketCount: 0,
                    totalNoTickets: 0,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false,
                    mainGameName: req.body.mainGameName,
                });

            } else if (req.params.type == "game_2") {
                let endTime = req.body.end_date;
                if (!req.body.subGame) {
                    req.flash('error', 'Please add atleast one sub game.');
                    return res.redirect('/gameManagement');
                } else {
                    req.body.subGame = req.body.subGame.map(function (subGame) {
                        //Price Nine
                        if (parseFloat(subGame.priceNine) > 0) {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNine),
                                isCash: true
                            }
                        } else {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNinePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceNinePercent;

                        //Price Ten
                        if (parseFloat(subGame.priceTen) > 0) {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTen),
                                isCash: true
                            }
                        } else {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTenPercent;

                        //Price Eleven
                        if (parseFloat(subGame.priceEleven) > 0) {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceEleven),
                                isCash: true
                            }
                        } else {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceElevenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceElevenPercent;

                        //Price Twelve
                        if (parseFloat(subGame.priceTwelve) > 0) {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelve),
                                isCash: true
                            }
                        } else {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelvePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTwelvePercent;

                        //Price Thirteen
                        if (parseFloat(subGame.priceThirteen) > 0) {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteen),
                                isCash: true
                            }
                        } else {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceThirteenPercent;

                        //Price 14 to 21
                        if (parseFloat(subGame.priceFourteenToTwentyone) > 0) {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyone),
                                isCash: true
                            }
                        } else {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyonePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceFourteenToTwentyonePercent;

                        console.log("subGame after process", subGame);
                        return subGame;
                    })
                }

                if (req.body.end_date) {
                    endTime = moment.tz(req.body.end_date, timeZone);
                    console.log("endTime in save game management debug 1", timeZone, endTime);
                    endTime.utc().toDate();
                    console.log("endTime in save game management debug 2", endTime);
                }

                console.log('graceTime', endTime);
                req.body.subGame = req.body.subGame.map(function (subGame) {
                    //Price Nine
                    if (parseFloat(subGame.priceNine) > 0) {
                        subGame.priceNine = {
                            price: parseFloat(subGame.priceNine),
                            isCash: true
                        }
                    } else {
                        subGame.priceNine = {
                            price: parseFloat(subGame.priceNinePercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceNinePercent;

                    //Price Ten
                    if (parseFloat(subGame.priceTen) > 0) {
                        subGame.priceTen = {
                            price: parseFloat(subGame.priceTen),
                            isCash: true
                        }
                    } else {
                        subGame.priceTen = {
                            price: parseFloat(subGame.priceTenPercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceTenPercent;

                    //Price Eleven
                    if (parseFloat(subGame.priceEleven) > 0) {
                        subGame.priceEleven = {
                            price: parseFloat(subGame.priceEleven),
                            isCash: true
                        }
                    } else {
                        subGame.priceEleven = {
                            price: parseFloat(subGame.priceElevenPercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceElevenPercent;

                    //Price Twelve
                    if (parseFloat(subGame.priceTwelve) > 0) {
                        subGame.priceTwelve = {
                            price: parseFloat(subGame.priceTwelve),
                            isCash: true
                        }
                    } else {
                        subGame.priceTwelve = {
                            price: parseFloat(subGame.priceTwelvePercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceTwelvePercent;

                    //Price Thirteen
                    if (parseFloat(subGame.priceThirteen) > 0) {
                        subGame.priceThirteen = {
                            price: parseFloat(subGame.priceThirteen),
                            isCash: true
                        }
                    } else {
                        subGame.priceThirteen = {
                            price: parseFloat(subGame.priceThirteenPercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceThirteenPercent;

                    //Price 14 to 21
                    if (parseFloat(subGame.priceFourteenToTwentyone) > 0) {
                        subGame.priceFourteenToTwentyone = {
                            price: parseFloat(subGame.priceFourteenToTwentyone),
                            isCash: true
                        }
                    } else {
                        subGame.priceFourteenToTwentyone = {
                            price: parseFloat(subGame.priceFourteenToTwentyonePercent),
                            isCash: false
                        }
                    }
                    delete subGame.priceFourteenToTwentyonePercent;

                    console.log("subGame after process", subGame);
                    return subGame;
                })
                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: "auto",
                    gameName: req.body.saveGamName !== '' ? req.body.saveGamName : req.body.mainGameName,
                    gameNumber: createID + '_G2',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    days: req.body.days,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    isAdminSave: (req.session.details.role == 'admin') ? true : false,
                    startDate: startTime, //req.body.start_date,
                    endDate: endTime, //req.body.end_date,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    // groupHalls: grpHalls,
                    // allHallsId: hallsArray,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    },
                    subGames: req.body.subGame,
                    'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                    'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                    'otherData.totalBotGamePlayed': 0
                });

            } else if (req.params.type == "game_3") {
                let { isBotGame, totalNumberOfGames } = req.body;
                if (isBotGame == "true" && !totalNumberOfGames) {
                    return res.send({ status: "error", message: 'Please Enter Total number of bot games to be played.' });
                }
                let endTime = req.body.end_date;
                if (req.body.end_date) {
                    endTime = moment.tz(req.body.end_date, timeZone);
                    console.log("endTime in save game management debug 1", timeZone, endTime);
                    endTime.utc().toDate();
                    console.log("endTime in save game management debug 2", endTime);
                }
                console.log('endTime', endTime);

                game = await Sys.App.Services.GameService.insertSavedGameData({
                    gameMode: req.body.gameMode,
                    gameName: req.body.mainGameName,
                    gameNumber: createID + '_G3',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    days: req.body.days,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    isAdminSave: (req.session.details.role == 'admin') ? true : false,
                    startDate: startTime,
                    endDate: endTime,
                    subGames: req.body.subGames,
                    isBotGame: isBotGame == "true" ? true : false,
                    totalNumberOfGames: isBotGame == "true" ? totalNumberOfGames : undefined
                });

                console.log('Game: ', game);

            } else if (req.params.type == "game_4") {

                // [ String To Number ]
                var newArrayBetAmount = req.body.betAmount.map(function (x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game4',
                    gameNumber: createID + '_G4',
                    gameType: req.params.type,
                    status: "active",
                    gameTypeId: req.params.typeId,
                    day: req.body.day,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    totalNoTickets: 4,
                    betAmount: req.body.betAmount,
                    ticketPrice: req.body.ticketPrice,
                    betMultiplier: req.body.betMultiplier,
                    betData: json,
                    seconds2: req.body.seconds2 * 1000,
                    seconds: req.body.seconds * 1000,
                    patternNamePrice: {
                        'Pattern1': req.body.priceOne,
                        'Pattern2': req.body.priceTwo,
                        'Pattern3': req.body.priceThree,
                        'Pattern4': req.body.priceFour,
                        'Pattern5': req.body.priceFive,
                        'Pattern6': req.body.priceSix,
                        'Pattern7': req.body.priceSeven,
                        'Pattern8': req.body.priceEight,
                        'Pattern9': req.body.priceNine,
                        'Pattern10': req.body.priceTen,
                        'Pattern11': req.body.priceEleven,
                        'Pattern12': req.body.priceTwelve,
                        'Pattern13': req.body.priceThirteen,
                        'Pattern14': req.body.priceFourteen,
                        'Pattern15': req.body.priceFifteen
                    }
                });

            }

            if (!game) {
                return res.send({ status: 'fail', message: "Something Went Wrong" });
            } else {
                return res.send({ status: 'success' });
            }

        } catch (e) {
            console.log("Error", e);
            return res.send({ status: 'fail', message: "Something Went Wrong" });
        }
    },

    editSaveGameManagement: async function (req, res) {
        try {
            //console.log("editGame", req.params);
            let keys = [
                "dashboard",
                "add",
                "edit_text",
                "save_as",
                "enter_name_of_game",
                "save",
                "please",
                "game_name",
                "enter",
                "start_date_and_time",
                "start_date",
                "end_date",
                "end_date_and_time",
                "start_time",
                "end_time",
                "select",
                "group_hall",
                "choose",
                "minimum_ticket_count",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "no",
                "yes",
                "how_many_bot_game_to_run",
                "total_bot_game_to_run",
                "is_bot_game",
                "add_sub_game",
                "submit",
                "cancel",
                "time_period",
                "sub_game_name",
                "ticket_price",
                "jackpot_number_and_prize",
                "seconds",
                "save_game",
                "select_one_goh",
                "selct_atleast_one_day_in_week",
                "add_atleast_one_subgame",
                "overall_percentage_increase",
                "min_day_gap_7_days",
                "end_time_must_be_greater_than_start_time",
                "start_time_must_be_less_than_end_time",
                "created",
                "game_saved_success",
                "error",
                "in_cash",
                "in_percent",
                "add_group",
                "add_pattern",
                "group_name",
                "pattern_group",
                "atleast_one_goh_in_subgames",
                "min_ticket_count_should_be_greater_20",
                "remove",
                "pattern_name_prize",
                "bet_multiplier",
                "bet_amount",
                "game4_is_bot_game",
                "game4_bot_count",
                "total_bot_game_to_run",
                "game_4_second_1_18",
                "game_4_second_19_end",
                "game5_patterns_multi",
                "game5_second_validation",
                "game5_total_ball_to_withdraw",
                "game5_ball_withdraw_validation",
                "game5_ball_second_for_bot",
                "game5_ball_second_for_bot_validation",
                "total_second_to_display_single_ball",
                "game_created_success",
                "something_went_wrong"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let Game = await Sys.App.Services.GameService.getByIdSavedGames({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let hallOption = [
                'name',
                'hallId'
            ];
            let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect({}, hallOption);
            let groupHalls = await Sys.App.Services.GroupHallServices.getGroupHalls();

            console.log(" Game : ", Game)

            // var startDateAt = (Game.startDate == null) ? '' : dateTimeFunction(Game.startDate);
            var graceDateAt = (Game.graceDate == null) ? '' : dateTimeFunction(Game.graceDate);
            // var startDateAt = moment(new Date(Game.startDate)).format();
            // var endDateAt = moment(new Date(Game.endDate)).format();


            //This is for demo purpose only format can be changed as requirement
            var startDateAt = (Game.startDate == null) ? '' : moment(new Date(Game.startDate)).tz('UTC').format();
            var endDateAt = moment(new Date(Game.endDate)).tz('UTC').format();
            console.log("startDate debug log", startDateAt);
            console.log("endDate debug log", endDateAt);
            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = (year + '/' + month + '/' + date + ' ' + hours + ':' + minutes);
                return dateTime; // Function returns the dateandtime
            }

            let printDataPattern, arr = [],
                ptrn;
            if (Game.gameName == "Game4") {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_4" });
                arr = ['Pattern1', 'Pattern2', 'Pattern3', 'Pattern4', 'Pattern5', 'Pattern6', 'Pattern7', 'Pattern8', 'Pattern9', 'Pattern10', 'Pattern11', 'Pattern12', 'Pattern13', 'Pattern14', 'Pattern15']
                printDataPattern = Game.patternNamePrice[0];
                for (let i = 0; i < ptrn.length; i++) {
                    ptrn[i].name = arr[i];
                    ptrn[i].price = printDataPattern['Pattern' + (i + 1)];
                }
            } else {
                ptrn = await Sys.App.Services.patternServices.getByData({ "gameType": "game_3" });
            }

            let gpat = ((Game.patternGroupNumberPrize && Game.patternGroupNumberPrize.length) ? Game.patternGroupNumberPrize.length : 0);
            let gl = (Game.gameType == 'game_3') ? gpat : 0;

            let hallArray;
            let agentHallArray;
            if (req.session.details.role == 'agent') {
                let agentId = await Sys.Helper.bingo.obId(req.session.details.id);
                agentHallArray = await Sys.App.Services.HallServices.getByData({ 'agents._id': agentId });
            } else {
                hallArray = await Sys.App.Services.HallServices.getByData();
            }
            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });

            //console.log(" Game Game Game Game Game : ",Game)

            // [ Row and Color ]
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                // console.log(" ++++++++++++++++++++++ : ",subGameList[s].ticketColor)
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            let patternListing = await Sys.App.Services.patternServices.getGamePatternData({ _id: { $in: rows } }, { isTchest: 1, isMys: 1, patternName: 1, patType: 1, isJackpot: 1, isLuckyBonus: 1, isGameTypeExtra: 1 });
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                let rowsData = [];
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    if (patternListing.length > 0) {
                        let index = patternListing.findIndex(e => e._id == subGameList[s].allPatternRowId[r].toString());
                        if (index !== -1) {
                            rowsData.push({ name: patternListing[index].patternName, type: patternListing[index].patType, isMys: patternListing[index].isMys, isTchest: patternListing[index].isTchest, isJackpot: patternListing[index].isJackpot, isLuckyBonus: patternListing[index].isLuckyBonus, isGameTypeExtra: patternListing[index].isGameTypeExtra })
                        }
                    }
                }
                obj.rows = rowsData;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;

            }

            console.log(" save game callss : ", startDateAt, endDateAt);
            let days = [];
            let timings = [];
            if (Object.keys(Game.days).length) {
                days = Object.keys(Game.days);
                for (const day in Game.days) {
                    console.log(Game.days[day]);
                    timings.push(Game.days[day]);
                }
            }
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                Game: Game,
                GameJSON: JSON.stringify(Game),
                pattern: ptrn,
                patternData: ptrn,
                gL: gl,
                seconds: Game.seconds / 1000,
                seconds2: Game.seconds2 / 1000,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                EndDate: endDateAt,
                hallData: hallData,
                gameData: gameType,
                gGroupHalls: Game.groupHalls,
                groupHalls: groupHalls,
                agentHallArray: agentHallArray,
                hallArray: hallArray,
                subGameList: subGameList,
                subGameColorRow: JSON.stringify(subGameColorRow),
                gameSubGames: JSON.stringify(Game.subGames),
                days: days,
                timings: timings,
                translate: translate,
                navigation: translate
            };
            // console.log('data',data);
            if (Game.gameType == 'game_3') {
                return res.render('savedGame/editSaveGame3', data);
            } else {
                return res.render('savedGame/gameAdd', data);
            }

        } catch (e) {
            console.log("Error Edit SaveGame Render", e);
        }
    },

    editSaveGameManagementPostData: async function (req, res) {
        try {
            let keys = [
                "add_atleast_one_subgame",
                "select_one_goh",
                "game_not_updated",
                "game_update_success",
                "can_not_edit_as_already_strated"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let timeZone = req.body.ctimezone;
            let startTime = req.body.start_date;
            if (req.body.start_date) {
                startTime = moment.tz(req.body.start_date, timeZone);
                startTime.utc().toDate();
            }
            let graceTime = req.body.grace_time;
            if (req.body.grace_time) {
                graceTime = moment.tz(req.body.grace_time, timeZone);
                graceTime.utc().toDate();
            }
            console.log("timezone,startTime, graceTime", timeZone, startTime, graceTime)

            //console.log("editSaveGameManagementPostData", req.params);
            console.log("editSaveGamePostData", req.body);
            let GameId = await Sys.App.Services.GameService.getByIdSavedGames({ _id: req.params.id });
            const gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;

            console.log(" Game Id : ", GameId)

            const ID = Date.now()
            const createID = dateTimeFunction(ID);

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


            if (gameType.type == "game_1") {

                let storeGamesData = [];
                let trafficLightOption = [];
                let sumOfAllTickets = 0;
                // For Single Game
                if (typeof (req.body.gameNameSelect) === 'string') {

                    // start 8 color of single inputs 
                    let optionSelect = req.body.gameNameSelect;
                    let fields = optionSelect.split('|');

                    let arrTicketColorType = [];
                    let arrSameColorType = [];
                    let subGameId = fields[0];
                    let subGameName = fields[1];
                    let subGameType = fields[2];

                    // console.log(" eightColorValues eightColorValues eightColorValues :",eightColorValues)

                    // console.log("eightColorInputRowsName eightColorInputRowsName aaaaaaaaaaaaaaa :",eightColorInputRowsName)
                    // console.log("eightColorInputValues eightColorInputValues bbbbbbbbbbbbbbb :",eightColorInputValues)

                    let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                    let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                    let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                    let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                    let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                    let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                    let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                    let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                    let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                    let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                    let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                    let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                    let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                    let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                    let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                    let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;

                    let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                    let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                    let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                    let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                    let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                    let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                    let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;


                    let optionCreate = [];
                    let ticketColorTypesNo = [];
                    let sumOfAllTicketsSubGames = 0;

                    for (let i = 0; i < arrTicketColorType.length; i++) {
                        console.log("arrTicketColorType[i]", arrTicketColorType[i]);



                        let ticketCount = 0;
                        let ticketPrice = 0;

                        if (arrTicketColorType[i] == "Small White") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                        } else if (arrTicketColorType[i] == "Large White") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                        } else if (arrTicketColorType[i] == "Small Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                        } else if (arrTicketColorType[i] == "Large Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                        } else if (arrTicketColorType[i] == "Small Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                        } else if (arrTicketColorType[i] == "Large Purple") {
                            ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                        } else if (arrTicketColorType[i] == "Small Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                        } else if (arrTicketColorType[i] == "Large Blue") {
                            ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                        } else if (arrTicketColorType[i] == "Elvis 1") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                        } else if (arrTicketColorType[i] == "Elvis 2") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                        } else if (arrTicketColorType[i] == "Elvis 3") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                        } else if (arrTicketColorType[i] == "Elvis 4") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                        } else if (arrTicketColorType[i] == "Elvis 5") {
                            ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                        } else if (arrTicketColorType[i] == "Red") {
                            ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_redColor']);

                        } else if (arrTicketColorType[i] == "Yellow") {
                            ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                        } else if (arrTicketColorType[i] == "Green") {
                            ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                            ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                        }


                        let eightColorFlg = false;
                        var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                        if (indx >= 0) {
                            eightColorFlg = true;
                        }

                        sumOfAllTickets += (ticketCount * 1);
                        sumOfAllTicketsSubGames += (ticketCount * 1);
                        let saveObj = {}

                        let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                        ticketColorTypesNo.push({
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount
                        });


                        //saveObj[ColorName] 
                        saveObj = {
                            ticketName: arrTicketColorType[i],
                            ticketType: ColorName,
                            ticketPrice: ticketPrice,
                            ticketCount: ticketCount,
                            totalPurchasedTickets: 0,
                            isEightColors: eightColorFlg,
                            jackpot: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                        }

                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        //let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        console.log(" subGameRowData subGameRowData :", subGameRowData)
                        console.log("  subGameId subGameId :" + subGameId)

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                winningPatternName: rowPattern[j].name,
                                winningPatternType: rowPattern[j].patType,
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isLuckyBonus: rowPattern[j].isLuckyBonus,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra,

                            }

                            console.log(" ([subGameType] + [rowPattern[j].patType] in req.body) :", req.body[[subGameType] + [rowPattern[j].patType]], " arrTicketColorType[i] arrTicketColorType[i] : ", arrTicketColorType[i])

                            console.log(" [subGameType] : ", [subGameType], " [rowPattern[j].patType] : ", [rowPattern[j].patType])

                            if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                    let extraWinnings = {}
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;

                                    //tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);

                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                    }

                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);

                                }

                            } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {

                                    let extraWinnings = {};
                                    if (tmpObj.isMys == true) {
                                        extraWinnings = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                        }
                                    }
                                    let tChest = {};
                                    if (tmpObj.isTchest == true) {
                                        tChest = {
                                            prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                            prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                            prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                            prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                            prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                            prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                            prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                            prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                            prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                            prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                            prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                            prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                        }
                                    }

                                    tmpObj.extraWinningsTchest = tChest;

                                    //tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);

                                    if (tmpObj.isGameTypeExtra == true) {
                                        tmpObj.winningValue = Number(0);
                                    } else {
                                        tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                    }

                                    tmpObj.extraWinnings = extraWinnings;
                                    //winning[rowPattern[j].patType] = tmpObj;
                                    winning.push(tmpObj);
                                }
                            }
                        }

                        //saveObj[ColorName].winning = winning;
                        saveObj.winning = winning;
                        optionCreate.push(saveObj);

                    }

                    let obj = {
                        //[subGameType]: {
                        subGameId: subGameId,
                        gameName: subGameName,
                        gameType: subGameType,
                        ticketColorTypes: arrTicketColorType,
                        ticketColorTypesNo: ticketColorTypesNo,
                        sumOfAllTicketsSubGames: sumOfAllTicketsSubGames,
                        jackpotValues: {
                            price: Number(req.body['jackpotPrice' + [subGameType]]),
                            draw: Number(req.body['jackpotDraws' + [subGameType]])
                        },
                        options: optionCreate,

                        //}
                    }
                    storeGamesData.push(obj);

                    // Same Color save
                    let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });

                    for (let k = 0; k < arrSameColorType.length; k++) {
                        console.log(" arrSameColorType arrSameColorType : : :")
                        let saveObj = {};
                        // let winning = {};
                        let winning = [];
                        let tmpBody = req.body;
                        let rowPattern = subGameRowData.patternRow;

                        let strLtd = arrSameColorType[k];
                        let splitColor = strLtd.split('_');
                        let nameColor1 = splitColor[0];
                        let nameColor2 = splitColor[1];

                        for (let j = 0; j < rowPattern.length; j++) {

                            let tmpObj = {
                                pattern: rowPattern[j].patternType,
                                isWoF: rowPattern[j].isWoF,
                                isTchest: rowPattern[j].isTchest,
                                isMys: rowPattern[j].isMys,
                                extraPercent: rowPattern[j].rowPercentage,
                                status: rowPattern[j].status,
                                isJackpot: rowPattern[j].isJackpot,
                                isLuckyBonus: rowPattern[j].isLuckyBonus,
                                isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                            }

                            let extraWinnings = {};
                            if (tmpObj.isMys == true) {
                                extraWinnings = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                }
                            }

                            tmpObj[rowPattern[j].patType] = {
                                [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                            }

                            console.log(" form body +++++++++++++++++++ :", tmpBody)

                            tmpObj.rowKey = rowPattern[j].patType;
                            tmpObj.rowName = rowPattern[j].name;

                            let tChest = {};
                            if (tmpObj.isTchest == true) {
                                tChest = {
                                    prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                    prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                    prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                    prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                    prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                    prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                    prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                    prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                    prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                    prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                    prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                    prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                }
                            }

                            tmpObj.extraWinningsTchest = tChest;
                            tmpObj.extraWinnings = extraWinnings;
                            //winning[rowPattern[j].patType] = tmpObj;


                            console.log(" tmpObj tmpObj tmpObj tmpObj tmpObj : ", tmpObj)

                            winning.push(tmpObj);

                        }

                        saveObj = {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            type: subGameType + "_" + arrSameColorType[k],
                            gameColorsCmbName: subGameType + " " + nameColor1 + " & " + nameColor2,
                            winning: winning
                        }

                        trafficLightOption.push(saveObj);
                    }

                } else { // For Multiple Game
                    for (let r = 0; r < req.body.gameNameSelect.length; r++) {

                        let optionSelect = req.body.gameNameSelect[r];
                        let fields = optionSelect.split('|');
                        let arrSameColorType = [];
                        let arrTicketColorType = [];
                        let subGameId = fields[0];
                        let subGameName = fields[1];
                        let subGameType = fields[2];


                        let smallWhiteColor = (Array.isArray(req.body[[subGameType] + '_smallWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallWhite'][0]) : 0;
                        let largeWhiteColor = (Array.isArray(req.body[[subGameType] + '_largeWhite'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeWhite'][0]) : 0;
                        let smallYellowColor = (Array.isArray(req.body[[subGameType] + '_smallYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallYellow'][0]) : 0;
                        let largeYellowColor = (Array.isArray(req.body[[subGameType] + '_largeYellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeYellow'][0]) : 0;
                        let smallPurpleColor = (Array.isArray(req.body[[subGameType] + '_smallPurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallPurple'][0]) : 0;
                        let largePurpleColor = (Array.isArray(req.body[[subGameType] + '_largePurple'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largePurple'][0]) : 0;
                        let smallBlueColor = (Array.isArray(req.body[[subGameType] + '_smallBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_smallBlue'][0]) : 0;
                        let largeBlueColor = (Array.isArray(req.body[[subGameType] + '_largeBlue'])) ? arrTicketColorType.push(req.body[[subGameType] + '_largeBlue'][0]) : 0;
                        let elvis1 = (Array.isArray(req.body[[subGameType] + '_elvis1'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis1'][0]) : 0;
                        let elvis2 = (Array.isArray(req.body[[subGameType] + '_elvis2'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis2'][0]) : 0;
                        let elvis3 = (Array.isArray(req.body[[subGameType] + '_elvis3'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis3'][0]) : 0;
                        let elvis4 = (Array.isArray(req.body[[subGameType] + '_elvis4'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis4'][0]) : 0;
                        let elvis5 = (Array.isArray(req.body[[subGameType] + '_elvis5'])) ? arrTicketColorType.push(req.body[[subGameType] + '_elvis5'][0]) : 0;
                        let red = (Array.isArray(req.body[[subGameType] + '_red'])) ? arrTicketColorType.push(req.body[[subGameType] + '_red'][0]) : 0;
                        let yellow = (Array.isArray(req.body[[subGameType] + '_yellow'])) ? arrTicketColorType.push(req.body[[subGameType] + '_yellow'][0]) : 0;
                        let green = (Array.isArray(req.body[[subGameType] + '_green'])) ? arrTicketColorType.push(req.body[[subGameType] + '_green'][0]) : 0;


                        let same2ColorRY = (req.body[[subGameType] + '_twoSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same2ColorRG = (req.body[[subGameType] + '_twoSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;
                        let same2ColorYR = (req.body[[subGameType] + '_twoSameRow_Yellow_Red'] == 'true') ? arrSameColorType.push('Yellow_Red') : 0;
                        let same2ColorYG = (req.body[[subGameType] + '_twoSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same2ColorGR = (req.body[[subGameType] + '_twoSameRow_Green_Red'] == 'true') ? arrSameColorType.push('Green_Red') : 0;
                        let same2ColorGY = (req.body[[subGameType] + '_twoSameRow_Green_Yellow'] == 'true') ? arrSameColorType.push('Green_Yellow') : 0;

                        let same3ColorRY = (req.body[[subGameType] + '_threeSameRow_Red_Yellow'] == 'true') ? arrSameColorType.push('Red_Yellow') : 0;
                        let same3ColorYG = (req.body[[subGameType] + '_threeSameRow_Yellow_Green'] == 'true') ? arrSameColorType.push('Yellow_Green') : 0;
                        let same3ColorRG = (req.body[[subGameType] + '_threeSameRow_Red_Green'] == 'true') ? arrSameColorType.push('Red_Green') : 0;

                        let optionCreate = [];

                        let ticketColorTypesNo = [];
                        let sumOfAllTicketsSubGames = 0;

                        for (let i = 0; i < arrTicketColorType.length; i++) {

                            let ticketCount = 0;
                            let ticketPrice = 0;

                            if (arrTicketColorType[i] == "Small White") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallWhiteColor']);

                            } else if (arrTicketColorType[i] == "Large White") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeWhite'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeWhiteColor']);

                            } else if (arrTicketColorType[i] == "Small Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallYellowColor']);

                            } else if (arrTicketColorType[i] == "Large Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeYellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeYellowColor']);

                            } else if (arrTicketColorType[i] == "Small Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallPurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallPurpleColor']);

                            } else if (arrTicketColorType[i] == "Large Purple") {
                                ticketPrice = Number(req.body[[subGameType] + '_largePurple'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largePurpleColor']);

                            } else if (arrTicketColorType[i] == "Small Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_smallBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_smallBlueColor']);

                            } else if (arrTicketColorType[i] == "Large Blue") {
                                ticketPrice = Number(req.body[[subGameType] + '_largeBlue'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_largeBlueColor']);

                            } else if (arrTicketColorType[i] == "Elvis 1") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis1'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis1Color']);

                            } else if (arrTicketColorType[i] == "Elvis 2") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis2'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis2Color']);

                            } else if (arrTicketColorType[i] == "Elvis 3") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis3'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis3Color']);

                            } else if (arrTicketColorType[i] == "Elvis 4") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis4'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis4Color']);

                            } else if (arrTicketColorType[i] == "Elvis 5") {
                                ticketPrice = Number(req.body[[subGameType] + '_elvis5'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_elvis5Color']);

                            } else if (arrTicketColorType[i] == "Red") {
                                ticketPrice = Number(req.body[[subGameType] + '_red'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_redColor']);

                            } else if (arrTicketColorType[i] == "Yellow") {
                                ticketPrice = Number(req.body[[subGameType] + '_yellow'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_yellowColor']);

                            } else if (arrTicketColorType[i] == "Green") {
                                ticketPrice = Number(req.body[[subGameType] + '_green'][1]);
                                ticketCount = Number(req.body[[subGameType] + '_greenColor']);

                            }


                            let eightColorFlg = false;
                            var indx = ETICKETCOLORS.findIndex(row => row == arrTicketColorType[i]);
                            if (indx >= 0) {
                                eightColorFlg = true;
                            }

                            sumOfAllTickets += (ticketCount * 1);
                            sumOfAllTicketsSubGames += (ticketCount * 1);

                            let saveObj = {}

                            let ColorName = (arrTicketColorType[i] == "Small White") ? "smallWhite" : (arrTicketColorType[i] == "Large White") ? "largeWhite" : (arrTicketColorType[i] == "Small Yellow") ? "smallYellow" : (arrTicketColorType[i] == "Large Yellow") ? "largeYellow" : (arrTicketColorType[i] == "Small Purple") ? "smallPurple" : (arrTicketColorType[i] == "Large Purple") ? "largePurple" : (arrTicketColorType[i] == "Small Blue") ? "smallBlue" : (arrTicketColorType[i] == "Large Blue") ? "largeBlue" : (arrTicketColorType[i] == "Elvis 1") ? "elvis1" : (arrTicketColorType[i] == "Elvis 2") ? "elvis2" : (arrTicketColorType[i] == "Elvis 3") ? "elvis3" : (arrTicketColorType[i] == "Elvis 4") ? "elvis4" : (arrTicketColorType[i] == "Elvis 5") ? "elvis5" : (arrTicketColorType[i] == "Red") ? "red" : (arrTicketColorType[i] == "Yellow") ? "yellow" : (arrTicketColorType[i] == "Green") ? "green" : "";

                            ticketColorTypesNo.push({
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount
                            });



                            //saveObj[ColorName] 
                            saveObj = {
                                ticketName: arrTicketColorType[i],
                                ticketType: ColorName,
                                ticketPrice: ticketPrice,
                                ticketCount: ticketCount,
                                totalPurchasedTickets: 0,
                                isEightColors: eightColorFlg,
                                jackpot: {
                                    price: Number(req.body['jackpotPrice' + [subGameType]]),
                                    draw: Number(req.body['jackpotDraws' + [subGameType]])
                                },
                            }

                            let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;
                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    winningPatternName: rowPattern[j].name,
                                    winningPatternType: rowPattern[j].patType,
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                }

                                if (arrTicketColorType[i] == "Small White" || arrTicketColorType[i] == "Large White" || arrTicketColorType[i] == "Small Yellow" || arrTicketColorType[i] == "Large Yellow" || arrTicketColorType[i] == "Small Purple" || arrTicketColorType[i] == "Large Purple" || arrTicketColorType[i] == "Small Blue" || arrTicketColorType[i] == "Large Blue") {
                                    if (([subGameType] + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + [rowPattern[j].patType]] != '') { // This check this key in req.body if yes process other wise skip

                                        let extraWinnings = {}
                                        let tChest = {}

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;

                                        //tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + [rowPattern[j].patType]]);
                                        }

                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }

                                } else if (arrTicketColorType[i] == "Elvis 1" || arrTicketColorType[i] == "Elvis 2" || arrTicketColorType[i] == "Elvis 3" || arrTicketColorType[i] == "Elvis 4" || arrTicketColorType[i] == "Elvis 5" || arrTicketColorType[i] == "Red" || arrTicketColorType[i] == "Yellow" || arrTicketColorType[i] == "Green") {
                                    if (([subGameType] + '_' + ColorName + [rowPattern[j].patType] in req.body) && req.body[[subGameType] + '_' + ColorName + [rowPattern[j].patType]] != '') {
                                        let tChest = {}
                                        let extraWinnings = {};

                                        if (tmpObj.isMys == true) {
                                            extraWinnings = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                            }
                                        }

                                        if (tmpObj.isTchest == true) {
                                            tChest = {
                                                prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                                prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                                prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                                prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                                prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                                prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                                prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                                prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                                prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                                prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                                prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                                prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                            }
                                        }

                                        tmpObj.extraWinningsTchest = tChest;

                                        //tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        if (tmpObj.isGameTypeExtra == true) {
                                            tmpObj.winningValue = Number(0);
                                        } else {
                                            tmpObj.winningValue = Number(tmpBody[[subGameType] + '_' + ColorName + [rowPattern[j].patType]]);
                                        }
                                        tmpObj.extraWinnings = extraWinnings;
                                        //winning[rowPattern[j].patType] = tmpObj;
                                        winning.push(tmpObj);

                                    }
                                }
                            }
                            //saveObj[ColorName].winning = winning;
                            saveObj.winning = winning;
                            optionCreate.push(saveObj);

                        }

                        let obj = {
                            //[subGameType]: {
                            subGameId: subGameId,
                            gameName: subGameName,
                            gameType: subGameType,
                            ticketColorTypes: arrTicketColorType,
                            ticketColorTypesNo: ticketColorTypesNo,
                            jackpotValues: {
                                price: Number(req.body['jackpotPrice' + [subGameType]]),
                                draw: Number(req.body['jackpotDraws' + [subGameType]])
                            },
                            options: optionCreate
                            //}
                        }
                        storeGamesData.push(obj);


                        // Same Color save
                        let subGameRowData = await Sys.App.Services.subGame1Services.getSingleData({ _id: subGameId });
                        for (let k = 0; k < arrSameColorType.length; k++) {
                            let saveObj = {};
                            //let winning = {};
                            let winning = [];
                            let tmpBody = req.body;
                            let rowPattern = subGameRowData.patternRow;

                            let strLtd = arrSameColorType[k];
                            let splitColor = strLtd.split('_');
                            let nameColor1 = splitColor[0];
                            let nameColor2 = splitColor[1];

                            for (let j = 0; j < rowPattern.length; j++) {

                                let tmpObj = {
                                    pattern: rowPattern[j].patternType,
                                    isWoF: rowPattern[j].isWoF,
                                    isTchest: rowPattern[j].isTchest,
                                    isMys: rowPattern[j].isMys,
                                    extraPercent: rowPattern[j].rowPercentage,
                                    status: rowPattern[j].status,
                                    isJackpot: rowPattern[j].isJackpot,
                                    isLuckyBonus: rowPattern[j].isLuckyBonus,
                                    isGameTypeExtra: rowPattern[j].isGameTypeExtra,
                                }

                                let extraWinnings = {};
                                if (tmpObj.isMys == true) {
                                    extraWinnings = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'Prize5']) : 0
                                    }
                                }

                                tmpObj[rowPattern[j].patType] = {
                                    [nameColor1.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor1 + '_' + [rowPattern[j].patType]]),
                                    [nameColor2.toLowerCase()]: Number(tmpBody[[subGameType] + '_' + arrSameColorType[k] + '_' + nameColor2 + '_' + [rowPattern[j].patType]]),
                                }

                                tmpObj.rowKey = rowPattern[j].patType;
                                tmpObj.rowName = rowPattern[j].name;

                                let tChest = {};
                                if (tmpObj.isTchest == true) {
                                    tChest = {
                                        prize1: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest1']) : 0,
                                        prize2: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest2']) : 0,
                                        prize3: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest3']) : 0,
                                        prize4: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest4']) : 0,
                                        prize5: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest5']) : 0,
                                        prize6: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest6']) : 0,
                                        prize7: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest7']) : 0,
                                        prize8: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest8']) : 0,
                                        prize9: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest9']) : 0,
                                        prize10: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest10']) : 0,
                                        prize11: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest11']) : 0,
                                        prize12: (req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) ? Number(req.body[[subGameType] + [rowPattern[j].patType] + 'isTchest12']) : 0,
                                    }
                                }

                                tmpObj.extraWinningsTchest = tChest;
                                tmpObj.extraWinnings = extraWinnings;
                                // winning[rowPattern[j].patType] = tmpObj;
                                winning.push(tmpObj);
                            }

                            saveObj = {
                                subGameId: subGameId,
                                gameName: subGameName,
                                gameType: subGameType,
                                type: subGameType + "_" + arrSameColorType[k],
                                gameColorsCmbName: subGameType + " " + nameColor1 + " & " + nameColor2,
                                winning: winning
                            }

                            trafficLightOption.push(saveObj);
                        }

                    }
                }


                let hallArray = [];
                let hall = req.body.hallSelecteds;
                let hallData, hallObj = {};
                let allHallTabaleId = [];

                if (typeof (hall) === 'string') {
                    console.log("hall", hall);
                    let hallId = await Sys.Helper.bingo.obId(hall);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/agent');
                    } else {
                        hallObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                        hallArray.push(hallObj);
                        allHallTabaleId.push(hallData._id);
                    }
                } else {
                    for (let i = 0; i < hall.length; i++) {
                        let hallId = await Sys.Helper.bingo.obId(hall[i]);
                        hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                        if (!hallData) {
                            req.flash('error', 'Hall Not Found');
                            return res.redirect('/agent');
                        } else {
                            hallObj = {
                                _id: hallData._id,
                                name: hallData.name,
                                hallId: hallData.hallId,
                                status: hallData.status
                            }
                            hallArray.push(hallObj);
                            allHallTabaleId.push(hallData._id);
                        }
                    }
                }

                let masterObj = {};
                if (typeof (req.body.masterHallSelected) === 'string') {
                    let hallId = await Sys.Helper.bingo.obId(req.body.masterHallSelected);
                    hallData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId });
                    if (!hallData) {
                        req.flash('error', 'Hall Not Found');
                        return res.redirect('/gameManagement');
                    } else {
                        masterObj = {
                            _id: hallData._id,
                            name: hallData.name,
                            hallId: hallData.hallId,
                            status: hallData.status
                        }
                    }
                }

                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: gameType.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, //req.body.grace_time,
                    minTicketCount: sumOfAllTickets,
                    totalNoTickets: sumOfAllTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false,
                    mainGameName: req.body.mainGameName,
                });

                for (let o = 0; o < storeGamesData.length; o++) {

                    let SubGameAdd = await Sys.App.Services.GameService.insertGameData({
                        gameMode: req.body.gameMode,
                        gameName: 'Game1',
                        gameNumber: createID + '_G1',
                        gameType: gameType.type,
                        status: "active",
                        day: req.body.day,
                        gameTypeId: req.params.typeId,
                        createrId: req.session.details.id,
                        lastCreaterId: req.session.details.id,
                        startDate: startTime, //req.body.start_date,
                        graceDate: graceTime, //req.body.grace_time,
                        minTicketCount: storeGamesData[o].sumOfAllTicketsSubGames,
                        totalNoTickets: storeGamesData[o].sumOfAllTicketsSubGames,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        seconds: req.body.seconds * 1000,
                        trafficLightExtraOptions: trafficLightOption,
                        subGames: storeGamesData[o],
                        halls: hallArray,
                        allHallsId: allHallTabaleId,
                        masterHall: masterObj,
                        isMasterGame: false,
                        parentGameId: game._id,
                        isSubGame: true,
                        mainGameName: req.body.mainGameName,
                    });

                }


                updateGame = await Sys.App.Services.GameService.updateSaveGameData({ _id: GameId._id }, {
                    gameMode: req.body.gameMode,
                    gameName: 'Game1',
                    gameNumber: createID + '_G1',
                    gameType: gameType.type,
                    status: "active",
                    day: req.body.day,
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    startDate: startTime, //req.body.start_date,
                    graceDate: graceTime, //req.body.grace_time,
                    minTicketCount: sumOfAllTickets,
                    totalNoTickets: sumOfAllTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    seconds: req.body.seconds * 1000,
                    trafficLightExtraOptions: trafficLightOption,
                    subGames: storeGamesData,
                    halls: hallArray,
                    allHallsId: allHallTabaleId,
                    masterHall: masterObj,
                    isMasterGame: true,
                    isSubGame: false,
                    mainGameName: req.body.mainGameName,
                });




            } else if (gameType.type == "game_2") {

                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });
                if (!req.body.subGame) {
                    req.flash('error', translate.add_atleast_one_subgame);
                    return res.redirect('/gameManagement');
                } else {
                    req.body.subGame = req.body.subGame.map(function (subGame) {
                        //Price Nine
                        if (parseFloat(subGame.priceNine) > 0) {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNine),
                                isCash: true
                            }
                        } else {
                            subGame.priceNine = {
                                price: parseFloat(subGame.priceNinePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceNinePercent;

                        //Price Ten
                        if (parseFloat(subGame.priceTen) > 0) {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTen),
                                isCash: true
                            }
                        } else {
                            subGame.priceTen = {
                                price: parseFloat(subGame.priceTenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTenPercent;

                        //Price Eleven
                        if (parseFloat(subGame.priceEleven) > 0) {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceEleven),
                                isCash: true
                            }
                        } else {
                            subGame.priceEleven = {
                                price: parseFloat(subGame.priceElevenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceElevenPercent;

                        //Price Twelve
                        if (parseFloat(subGame.priceTwelve) > 0) {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelve),
                                isCash: true
                            }
                        } else {
                            subGame.priceTwelve = {
                                price: parseFloat(subGame.priceTwelvePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceTwelvePercent;

                        //Price Thirteen
                        if (parseFloat(subGame.priceThirteen) > 0) {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteen),
                                isCash: true
                            }
                        } else {
                            subGame.priceThirteen = {
                                price: parseFloat(subGame.priceThirteenPercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceThirteenPercent;

                        //Price 14 to 21
                        if (parseFloat(subGame.priceFourteenToTwentyone) > 0) {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyone),
                                isCash: true
                            }
                        } else {
                            subGame.priceFourteenToTwentyone = {
                                price: parseFloat(subGame.priceFourteenToTwentyonePercent),
                                isCash: false
                            }
                        }
                        delete subGame.priceFourteenToTwentyonePercent;

                        console.log("subGame after process", subGame);
                        return subGame;
                    })
                }

                let groupHalls = req.body.groupHalls;
                if (!Array.isArray(groupHalls)) {
                    groupHalls = [groupHalls]
                }
                // let halls = req.body.halls;
                let grpHalls = [];
                let hallsArray = [];
                for (let i = 0; i < groupHalls.length; i++) {
                    let grpHallsData = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: groupHalls[i] });
                    if (grpHallsData) {
                        console.log("for loop for group of Halls", grpHallsData.name);
                        grpHallsData.halls.filter((data) => {
                            hallsArray.push(data.id);
                        })
                        let grpArray = {
                            id: grpHallsData.id,
                            name: grpHallsData.name,
                            status: grpHallsData.status,
                            halls: grpHallsData.halls.map((data) => { return { id: data.id.toString(), name: data.name } })
                        }
                        console.log("groupArray i", grpArray);
                        grpHalls.push(grpArray);
                    }
                }
                let graceTime = req.body.end_date;
                if (req.body.end_date) {
                    graceTime = moment.tz(req.body.end_date, timeZone);
                    graceTime.utc().toDate();
                }

                if (updateGame != undefined) {
                    let data = {
                        startDate: startTime, //req.body.start_date,
                        // graceDate: graceTime, //req.body.grace_time,
                        endDate: graceTime, //req.body.grace_time,
                        days: req.body.days,
                        gameName: req.body.mainGameName,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        lastCreaterId: req.session.details.id,
                        groupHalls: grpHalls,
                        allHallsId: hallsArray,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                        subGames: req.body.subGame,
                        'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                        'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                        'otherData.totalBotGamePlayed': 0
                    }
                    let game = await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, data);
                    //console.log('game: ', game);

                    // [ Real Game Create Here ]

                    let query = { _id: game.gameTypeId };
                    let gameType = await Sys.App.Services.GameService.getGameTypeById(query);
                    //console.log("gameType", gameType);


                    let gameUpdated = await Sys.App.Services.GameService.insertParentGameData({
                        gameMode: game.gameMode,
                        gameName: game.gameName,
                        gameNumber: createID + '_G2',
                        gameType: game.gameType,
                        status: game.status,
                        days: game.days,
                        gameTypeId: game.gameTypeId,
                        createrId: req.session.details.id,
                        lastCreaterId: req.session.details.id,
                        startDate: startTime, //req.body.start_date,
                        // graceDate: graceTime, //req.body.grace_time,
                        endDate: graceTime,
                        minTicketCount: game.minTicketCount,
                        totalNoTickets: game.totalNoTickets,
                        notificationStartTime: game.notificationStartTime,
                        luckyNumberPrize: game.luckyNumberPrize,
                        ticketPrice: game.ticketPrice,
                        seconds: game.seconds,
                        jackPotNumber: game.jackPotNumber,
                        groupHalls: game.groupHalls,
                        allHallsId: game.allHallsId,
                        isParent: true,
                        subGames: game.subGames,
                        'otherData.isBotGame': (req.body.isBotGame == "Yes") ? true : false,
                        'otherData.botGameCount': (req.body.isBotGame == "Yes") ? +req.body.botGameCount : 0,
                        'otherData.totalBotGamePlayed': 0,
                        'otherData.closeDay': []
                    });

                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    var patternGroupNumberPrize = [];
                    let data = {
                        startDate: startTime, //req.body.start_date,
                        graceDate: graceTime, //req.body.grace_time,
                        day: req.body.day,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        totalNoPurchasedTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        patternGroupNumberPrize: patternGroupNumberPrize,
                        seconds: req.body.seconds * 1000,
                        lastCreaterId: req.session.details.id,
                    }
                    await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {

                updateGame = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.params.id });

                var newArrayBetAmount = req.body.betAmount.map(function (x) {
                    return parseInt(x, 10);
                });

                let n = 3; // [ Array Rows ]

                let arr1 = [];
                let arr2 = [];
                let arr3 = [];
                let arr4 = [];

                let cntt = 0;
                for (let i = 0; i < newArrayBetAmount.length; i++) {
                    let index = newArrayBetAmount.indexOf(newArrayBetAmount[i]);

                    if (cntt == n) {
                        arr1.push(newArrayBetAmount[i]);
                        cntt = 0;
                    } else if (cntt == (n - 1)) {
                        arr2.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else if (cntt == (n - 2)) {
                        arr3.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    } else {
                        arr4.push(newArrayBetAmount[i])
                        cntt = cntt + 1;
                    }
                }

                let result = [
                    [...arr4],
                    [...arr3],
                    [...arr2],
                    [...arr1]
                ];
                console.log('Result: ', result);

                let json = {};
                for (let i = 0; i < 4; i++) {
                    json['ticket' + (i + 1) + 'Multiplier'] = result[i];
                }
                console.log("JSON: ", json);

                if (updateGame != undefined) {
                    game = await Sys.App.Services.GameService.updateSaveGameData({ _id: req.params.id }, {
                        betAmount: req.body.betAmount,
                        ticketPrice: 1, //req.body.ticketPrice,
                        betMultiplier: req.body.betMultiplier,
                        betData: json,
                        day: req.body.day,
                        seconds2: req.body.seconds2 * 1000,
                        seconds: req.body.seconds * 1000,
                        lastCreaterId: req.session.details.id,
                        patternNamePrice: {
                            'Pattern1': req.body.Pattern1,
                            'Pattern2': req.body.Pattern2,
                            'Pattern3': req.body.Pattern3,
                            'Pattern4': req.body.Pattern4,
                            'Pattern5': req.body.Pattern5,
                            'Pattern6': req.body.Pattern6,
                            'Pattern7': req.body.Pattern7,
                            'Pattern8': req.body.Pattern8,
                            'Pattern9': req.body.Pattern9,
                            'Pattern10': req.body.Pattern10,
                            'Pattern11': req.body.Pattern11,
                            'Pattern12': req.body.Pattern12,
                            'Pattern13': req.body.Pattern13,
                            'Pattern14': req.body.Pattern14,
                            'Pattern15': req.body.Pattern15
                        }
                    });
                    console.log('game: ', game);
                }
            }

            if (!updateGame) {
                req.flash('error', translate.game_not_updated);
                return res.redirect('/savedGameList');
            } else {
                req.flash('success', translate.game_update_success);
                return res.redirect('/savedGameList');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getSaveGameManagementDelete: async function (req, res) {
        try {
            let game = await Sys.App.Services.GameService.getSingleSavedGameData({ _id: req.body.id });
            if (game) {
                await Sys.App.Services.GameService.deleteSaveGame(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    viewSaveGameManagementDetails: async function (req, res) {
        try {
            let keys = [
                "dashboard",
                "view",
                "add",
                "edit_text",
                "save_as",
                "enter_name_of_game",
                "save",
                "please",
                "game_name",
                "enter",
                "start_date_and_time",
                "start_date",
                "end_date",
                "end_date_and_time",
                "start_time",
                "end_time",
                "select",
                "group_hall",
                "choose",
                "minimum_ticket_count",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "no",
                "yes",
                "how_many_bot_game_to_run",
                "total_bot_game_to_run",
                "is_bot_game",
                "add_sub_game",
                "submit",
                "cancel",
                "time_period",
                "sub_game_name",
                "ticket_price",
                "jackpot_number_and_prize",
                "seconds",
                "sub_games",
                "error",
                "in_cash",
                "in_percent",
                "add_group",
                "add_pattern",
                "group_name",
                "pattern_group",
                "atleast_one_goh_in_subgames",
                "min_ticket_count_should_be_greater_20",
                "remove"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let dataGame = await Sys.App.Services.GameService.getByIdSavedGames(req.params.id);
            var gameType = await Sys.App.Services.GameService.getByIdGameType(dataGame.gameTypeId);
            console.log("game data ", dataGame);
            let hallOption = [
                'name',
                'hallId'
            ];
            let hallData = await Sys.App.Services.HallServices.getAllHallDataSelect({}, hallOption);
            var startDateAt = moment(new Date(dataGame.startDate)).tz('UTC').format(); //dateTimeFunction(dataGame.startDate);
            var graceDateAt = moment(new Date(dataGame.graceDate)).tz('UTC').format(); //dateTimeFunction(dataGame.graceDate);
            var endDateAt = moment(new Date(dataGame.endDate)).tz('UTC').format();
            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                // let ampm = hours >= 12 ? 'pm' : 'am';
                // hours = hours % 12;
                // hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes;
                return dateTime; // Function returns the dateandtime
            }

            let subGameList = await Sys.App.Services.subGame1Services.getAllDataSelect({ status: 'active' }, { ticketColor: 1, gameName: 1, subGameId: 1, gameType: 1, allPatternRowId: 1 });
            let subGameColorRow = {};
            let rows = [];
            for (let s = 0; s < subGameList.length; s++) {
                for (let r = 0; r < subGameList[s].allPatternRowId.length; r++) {
                    rows.push(subGameList[s].allPatternRowId[r])
                }
            }
            for (let s = 0; s < subGameList.length; s++) {
                let obj = {};
                obj.colors = subGameList[s].ticketColor;
                obj.gameName = subGameList[s].gameName;
                obj.subGameId = subGameList[s].subGameId;
                obj.gameType = subGameList[s].gameType;
                subGameColorRow[subGameList[s].gameType] = obj;
            }

            console.log(" subGameColorRow subGameColorRow : ", subGameColorRow)

            let days = [];
            let timings = [];
            if (Object.keys(dataGame.days).length) {
                days = Object.keys(dataGame.days);
                for (const day in dataGame.days) {
                    console.log(dataGame.days[day]);
                    timings.push(dataGame.days[day]);
                }
            }
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                savedGameList: 'active',
                Game: dataGame,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                EndTime: endDateAt,
                hallData: hallData,
                gameData: gameType,
                subGameColorRow: subGameColorRow,
                days: days,
                timings: timings,
                translate: translate,
                navigation: translate
            };
            if (dataGame.gameType == 'game_3') {
                return res.render('savedGame/game3View', data);
            } else {
                return res.render('savedGame/gameView', data);
            }

        } catch (error) {
            console.log("Error viewSaveGameManagementDetails", error);
        }
    },

    // [ Old Documention wise ] Game Menu 

    viweGameMenu: async function (req, res) {
        try {

            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});

            //console.log("gameType", gameType);
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }

            return res.send({
                status: 'success',
                data: gameData,
                GameMenu: 'active',
                DataOfGames: gameData
            });
        } catch (error) {
            Sys.Log.error('Error in gameType: ', error);
            return new Error(error);
        }
    },

    viweGameDetail: async function (req, res) {
        try {
            // console.log("Req.params calling");
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            //console.log("gameType", gameType);
            var theadField;
            if (gameType.type == "game_1") {
                theadField = [

                ]
            } else if (gameType.type == "game_2") {
                theadField = [
                    'Game number',
                    'Start Date and Time',
                    'Ticket price',
                    'Jack pot number',
                    'Price in number',
                    'Seconds',
                    'Action'
                ]

            } else if (gameType.type == "game_3") {
                theadField = [
                    'Game number',
                    'Start Date and Time',
                    'Ticket price',
                    'Seconds',
                    'Game Type',
                    'Action'
                ]
            } else if (gameType.type == "game_4") {
                theadField = [

                ]
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                gameData: gameType,
                theadField: theadField
            };
            // res.send(data);
            return res.render('GameFolder/gameDetail', data);

        } catch (error) {
            Sys.Log.error('Error in viweGameDetail: ', error);
            return new Error(error);
        }
    },

    getGameDetailList: async function (req, res) {
        try {
            console.log("getGameDetailList calling", req.query.gameType);

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            var gameName;

            if (req.query.gameType == "game_1") {
                gameName = "Game1";
            } else if (req.query.gameType == "game_2") {
                gameName = "Game2";
            } else if (req.query.gameType == "game_3") {
                gameName = "Game3";
            } else if (req.query.gameType == "game_4") {
                gameName = "Game4";
            }

            let query = { gameName: gameName };
            if (search != '') {
                query = { gameNumber: { $regex: '.*' + search + '.*' }, gameName: gameName };
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

            //console.log(query);
            let reqCount = await Sys.App.Services.GameService.getSelectedGameCount(query);

            let data = await Sys.App.Services.GameService.getGameDatatable(query, length, start);


            if (req.query.gameType == "game_1") {

            } else if (req.query.gameType == "game_2") {
                var gameData = [];

                for (var i = 0; i < data.length; i++) {
                    var dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        startDate: data[i].startDate,
                        ticketPrice: data[i].ticketPrice,
                        jackPotNumber: data[i].jackPotNumber[0],
                        priceNumber: data[i].jackPotNumber[0],
                        seconds: data[i].seconds,
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_3") {
                var gameData = [];

                for (var i = 0; i < data.length; i++) {
                    var dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        startDate: data[i].startDate,
                        ticketPrice: data[i].ticketPrice,
                        seconds: data[i].seconds,
                    }
                    gameData.push(dataGame);
                }

            } else if (req.query.gameType == "game_4") {

            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            //console.log("data:::::::::::::", data)

            res.send(obj);

        } catch (error) {
            Sys.Log.error('Error in getGameDetailList: ', error);
            return new Error(error);
        }
    },

    addGame: async function (req, res) {
        try {
            //console.log("addGame", req.params.id);
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            //console.log("gameType addGame", gameType);

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                gameData: gameType,
                slug: 'Add'
            };
            return res.render('GameFolder/addGame', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    addGamePostData: async function (req, res) {
        try {
            //console.log("addGamePostData params", req.params.typeId, req.params.type);
            console.log("addGamePostData", req.body);
            let randomNumber = Math.floor(100000 + Math.random() * 900000);

            var game;

            if (req.params.type == "game_1") {

            } else if (req.params.type == "game_2") {
                game = await Sys.App.Services.GameService.insertGameData({
                    gameMode: req.body.gameMode,
                    gameName: 'Game2',
                    gameNumber: randomNumber + Date.now() + '-Game2ID',
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    startDate: req.body.start_date,
                    graceDate: req.body.grace_time,
                    minTicketCount: req.body.minTicketCount,
                    totalNoTickets: req.body.totalNoTickets,
                    notificationStartTime: req.body.notificationStartTime,
                    luckyNumberPrize: req.body.luckyNumberPrize,
                    ticketPrice: req.body.ticketPrice,
                    seconds: req.body.seconds * 1000,
                    jackPotNumber: {
                        9: req.body.priceNine,
                        10: req.body.priceTen,
                        11: req.body.priceEleven,
                        12: req.body.priceTwelve,
                        13: req.body.priceThirteen,
                        1421: req.body.priceFourteenToTwentyone,
                    }
                });
            } else if (req.params.type == "game_3") {
                var patternGroupNumberPrize = [];
                game = await Sys.App.Services.GameService.insertGameData({
                    gameName: 'Game3',
                    gameNumber: randomNumber + Date.now() + '-Game3ID',
                    gameTypeId: req.params.typeId,
                    createrId: req.session.details.id,
                    lastCreaterId: req.session.details.id,
                    startDate: req.body.start_date,
                    ticketPrice: req.body.ticketPrice,
                    patternGroupNumberPrize: patternGroupNumberPrize,
                    seconds: req.body.seconds * 1000,
                });

                game = JSON.stringify(game);
                // let shakti = await redisClient.set('game3' + game._id, game);
                // let shiv = await redisClient.get('Rooms');

            } else if (req.params.type == "game_4") {

            }

            if (!game) {
                req.flash('error', 'Game was not created');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Game was create successfully');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editGame: async function (req, res) {
        try {
            //console.log("editGame", req.params);

            let Game = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

            var startDateAt = dateTimeFunction(Game.startDate);
            var graceDateAt = dateTimeFunction(Game.graceDate);

            function dateTimeFunction(dateData) {
                let dt = new Date(dateData);
                let date = dt.getDate();
                let month = parseInt(dt.getMonth() + 1);
                let year = dt.getFullYear();
                let hours = dt.getHours();
                let minutes = dt.getMinutes();
                let ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12;
                minutes = minutes < 10 ? '0' + minutes : minutes;
                let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
                return dateTime; // Function returns the dateandtime
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameMenu: 'active',
                Game: Game,
                StartDate: startDateAt,
                GraceTime: graceDateAt,
                gameData: gameType
            };
            return res.render('GameFolder/addGame', data);

        } catch (e) {
            console.log("Error", e);
        }
    },


    editGamePostData: async function (req, res) {
        try {

            // console.log("editGamePostData", req.params);

            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let updateGame;

            if (gameType.type == "game_1") {

            } else if (gameType.type == "game_2") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    let data = {
                        startDate: req.body.start_date,
                        graceDate: req.body.grace_time,
                        minTicketCount: req.body.minTicketCount,
                        totalNoTickets: req.body.totalNoTickets,
                        notificationStartTime: req.body.notificationStartTime,
                        luckyNumberPrize: req.body.luckyNumberPrize,
                        ticketPrice: req.body.ticketPrice,
                        seconds: req.body.seconds * 1000,
                        lastCreaterId: req.session.details.id,
                        jackPotNumber: {
                            9: req.body.priceNine,
                            10: req.body.priceTen,
                            11: req.body.priceEleven,
                            12: req.body.priceTwelve,
                            13: req.body.priceThirteen,
                            1421: req.body.priceFourteenToTwentyone,
                        },
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                    var gameType = await Sys.App.Services.GameService.getByIdGameType();

                }
            } else if (gameType.type == "game_3") {
                updateGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.params.id });

                if (updateGame != undefined) {
                    // var patternGroupNumberPrize = [];
                    // let data = {
                    //     startDate: req.body.start_date,
                    //     graceDate: req.body.grace_time,
                    //     minTicketCount: req.body.minTicketCount,
                    //     totalNoTickets: req.body.totalNoTickets,
                    //     notificationStartTime: req.body.notificationStartTime,
                    //     luckyNumberPrize: req.body.luckyNumberPrize,
                    //     ticketPrice: req.body.ticketPrice,
                    //     patternGroupNumberPrize: patternGroupNumberPrize,
                    //     seconds: req.body.seconds * 1000
                    // }
                    let data = {
                        days: req.body.days,
                        createrId: req.session.details.id,
                        lastCreaterId: req.session.details.id,
                        startDate: startTime,
                        endDate: graceTime,
                        groupHalls: grpHalls,
                        allHallsId: hallsArray,
                        subGames: req.body.subGames
                    }
                    await Sys.App.Services.GameService.updateGameData({ _id: req.params.id }, data)
                }
            } else if (gameType.type == "game_4") {

            }

            if (!updateGame) {
                req.flash('error', 'Game was not updated');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            } else {
                req.flash('success', 'Game was updated successfully');
                return res.redirect('/gameDetailList/' + req.params.typeId);
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameDelete: async function (req, res) {
        try {
            let player = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id });
            if (player || player.length > 0) {
                await Sys.App.Services.GameService.deleteGame(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    // [Old Code not being Used]
    // viewGameDetails: async function(req, res) {
    //     try {
    //         let dataGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
    //         var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });

    //         var startDateAt = dateTimeFunction(dataGame.startDate);
    //         var graceDateAt = dateTimeFunction(dataGame.graceDate);

    //         function dateTimeFunction(dateData) {
    //             let dt = new Date(dateData);
    //             let date = dt.getDate();
    //             let month = parseInt(dt.getMonth() + 1);
    //             let year = dt.getFullYear();
    //             let hours = dt.getHours();
    //             let minutes = dt.getMinutes();
    //             let ampm = hours >= 12 ? 'pm' : 'am';
    //             hours = hours % 12;
    //             hours = hours ? hours : 12;
    //             minutes = minutes < 10 ? '0' + minutes : minutes;
    //             let dateTime = year + '/' + month + '/' + date + ' ' + hours + ':' + minutes + ' ' + ampm;
    //             return dateTime; // Function returns the dateandtime
    //         }

    //         var data = {
    //             App: Sys.Config.App.details,
    //             Agent: req.session.details,
    //             error: req.flash("error"),
    //             success: req.flash("success"),
    //             GameMenu: 'active',
    //             Game: dataGame,
    //             StartDate: startDateAt,
    //             GraceTime: graceDateAt,
    //             gameData: gameType
    //         };
    //         return res.render('GameFolder/viewGameDetails', data);
    //     } catch (e) {
    //         console.log("Error", e);
    //     }
    // },

    // Repeat Game Controller



    // [View Game as Per Martin-Bingo Implementation]
    viewGameDetails: async function (req, res) {
        try {
            let keys = [
                "table",
                "dashboard",
                "game_history",
                "game_tickets_are_availbale",
                "game_id",
                "child_id",
                "game_name",
                "start_date",
                "total_no_ticket_sold",
                "total_earned_from",
                "tickets_sold",
                "action",
                "no_data_available",
                "ongoing_game2",
                "displayed_balls",
                "recent_game",
                "scheduled_game",
                "start_date",
                "day",
                "start_time_end_time",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "no_data_available_in_table",
                "total_winnings"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let gameType;
            console.log("View Game Details for", req.params);
            if (req.params.typeId === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            }
            
            let Game = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });


            let runningData, activeData, recentData;
            if (gameType.type == "game_1") {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            } else if (gameType.type == "game_2" || gameType.type == "game_3") {
                let runningGame = await Sys.App.Services.GameService.getSingleGameData({ parentGameId: req.params.id, status: "running" });
                if (runningGame) {
                    let purchasedTicketCount = await Sys.App.Services.GameService.getTicketCount({ gameId: runningGame._id.toString(), isPurchased: true }); //await Sys.App.Services.GameService.getTicketCount({ gameId: runningGame._id.toString(), $or: [{ isCancelled: false }, { isCancelled: { $exists: false } }] });
                    let ballsDisplayed = runningGame.withdrawNumberList.map(data => data.number);
                    console.log("Balls", ballsDisplayed);
                    runningData = {
                        "displayedBalls": ballsDisplayed,
                        "childId": runningGame.gameNumber,
                        "gameId": Game.gameNumber,
                        "name": runningGame.gameName,
                        "startDate": runningGame.startDate,
                        "totalSold": purchasedTicketCount,
                        "totalEarning": (runningGame.ticketPrice * purchasedTicketCount)
                    };
                }
                let activeGames = await Sys.App.Services.GameService.getByData({ parentGameId: req.params.id, status: "active" });
                activeData = [];
                if (activeGames.length) {
                   
                    for (let i = 0; i < activeGames.length; i++) {
                        let purchasedTicketCount = await Sys.App.Services.GameService.getTicketCount({ gameId: activeGames[i]._id.toString(), isPurchased: true }); //await Sys.App.Services.GameService.getTicketCount({ gameId: activeGames[i]._id.toString(), $or: [{ isCancelled: false }, { isCancelled: { $exists: false } }] });
                        const element = activeGames[i];
                        activeData.push({
                            "childId": element.gameNumber,
                            "gameId": Game.gameNumber,
                            "name": element.gameName,
                            "startDate": element.createdAt,
                            "totalSold": purchasedTicketCount,
                            "totalEarning": (element.ticketPrice * purchasedTicketCount)
                        })
                    }
                }
                let startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                let endofDay = new Date();
                endofDay.setHours(23, 59, 59, 999);
                let recentGame = await Sys.App.Services.GameService.getGamesByData({
                    parentGameId: req.params.id,
                    status: "finish",
                    startDate: {
                        $gte: startOfDay,
                        $lte: endofDay
                    }
                }, null,
                    { sort: { startDate: -1 } }
                );
                recentData = [];
                if (recentGame.length) {
                    for (let i = 0; i < recentGame.length; i++) {
                        let id = recentGame[i]._id.toString()
                        console.log("Recent Game Found", id);
                        /* let query = [{ $match: { "gameId": recentGame._id, "totalWinningOfTicket": { "$gt": i } } }, { "$group": { "_id": null, "totalWinnings": { "$sum": "$totalWinningOfTicket" } } }]; */
                        let query = [{
                            $match: {
                                gameId: id,
                                gameType: recentGame[i].gameType,
                                totalWinningOfTicket: {
                                    $gt: 0
                                }
                            }
                        }, {
                            $project: {
                                totalWinningOfTicket: 1
                            }
                        }, {
                            $group: {
                                _id: null,
                                totalWinnings: {
                                    $sum: '$totalWinningOfTicket'
                                }
                            }
                        }];
                        // console.log(query);
                        let data = await Sys.App.Services.GameService.aggregateQueryTickets(query); //Calculate total Winning amount.
                        let purchasedTicketCount = await Sys.App.Services.GameService.getTicketCount({ gameId: id, isPurchased: true }); //await Sys.App.Services.GameService.getTicketCount({ gameId: id, $or: [{ isCancelled: false }, { isCancelled: { $exists: false } }] });
                        // console.log(data);
                        recentData.push({
                            "childId": recentGame[i].gameNumber,
                            "gameId": Game.gameNumber,
                            "name": recentGame[i].gameName,
                            "startDate": recentGame[i].startDate,
                            "endDate": recentGame[i].updatedAt,
                            "totalSold": purchasedTicketCount,
                            "totalEarning": (recentGame[i].ticketPrice * purchasedTicketCount),
                            "totalWinnings": data.length ? data[0].totalWinnings : 0
                        })
                    }
                }

            } else if (gameType.type == "game_4") {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                gameData: gameType,
                runningData: runningData,
                activeData: activeData,
                recentData: recentData,
                Game: Game,
                translate: translate,
                navigation: translate
            };
            return res.render("GameManagement/viewGameDetails", data);

        } catch (error) {
            console.log("Error in viewGamDateils:::", error);
            return new Error(error);
        }
    },

    // [Marting Bingo New Addition ::: Repeat and Stop Game]
    repeatGame: async function (req, res) {
        try {
            console.log("Data in repatGame Controller :::::", req.body, req.params);
            var gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let startDate = req.body.start_date;
            let timeZone = req.body.ctimezone;
            if (req.body.start_date) {
                startDate = moment.tz(req.body.start_date, timeZone);
                startDate.utc().toDate();
            }
            let endDate = req.body.end_date;
            if (req.body.end_date) {
                endDate = moment.tz(req.body.end_date, timeZone);
                endDate.utc().toDate();
            }
            var ID = Date.now()
            var createID = dateTimeFunction(ID);

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
            let mainGame
            if (gameType.type = "game_2") {
                mainGame = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.repeatGameId });
                if (mainGame != undefined) {
                    game = await Sys.App.Services.GameService.insertGameData({
                        gameMode: mainGame.gameMode,
                        gameName: req.body.name,
                        gameNumber: createID + '_G2',
                        gameType: gameType.type,
                        status: "active",
                        gameTypeId: req.params.typeId,
                        createrId: req.session.details.id,
                        lastCreaterId: req.session.details.id,
                        startDate: startDate,
                        endDate: endDate,
                        minTicketCount: mainGame.minTicketCount,
                        totalNoTickets: mainGame.totalNoTickets,
                        totalNoPurchasedTickets: mainGame.totalNoTickets,
                        notificationStartTime: mainGame.notificationStartTime,
                        luckyNumberPrize: mainGame.luckyNumberPrize,
                        ticketPrice: mainGame.ticketPrice,
                        jackPotNumber: mainGame.jackPotNumber,
                        groupHalls: mainGame.groupHalls,
                        allHallsId: mainGame.allHallsId,
                        seconds: mainGame.seconds,
                    });

                    console.log('Game: ', game);
                    var sendData = {
                        columns: gameType.columns,
                        slug: gameType.type,
                        ticketSize: game.totalNoTickets,
                        gameId: game._id,
                        ticketPrice: game.ticketPrice
                    }

                    console.log("sendData: ", sendData);

                    var ticketBook = await Sys.Helper.bingo.ticketBook(sendData);
                }
            }
            if (!mainGame) {
                req.flash('error', 'Game not found.');
                return res.send({ "fail": "Game not found." });
            } else {
                if (!game) {
                    req.flash('error', 'Game was not created');
                    return res.send({ "fail": "Game was not created" });;
                } else {
                    req.flash('success', 'Game was create successfully');
                    return res.send({ "success": "Game was create successfully" });;
                }
            }

        } catch (error) {
            console.log("Error in Repeat Game Conroller", error);
            req.flash('error', 'Something Went Wrong !');
            return res.send({ "fail": "Internal server error" });
        }
    },

    stopGame: async function (req, res) {
        try {
            console.log("Data in stopGame Controller :::::", req.body, req.params);
            let gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.typeId });
            let stopGame
            if (gameType.type == "game_2" || gameType.type == "game_3") {
                stopGame = await Sys.App.Services.GameService.getParentById({ _id: req.body.id });
                if (stopGame) {
                    let data = {
                        "$set": {
                            "stopGame": true
                        }
                    }
                    await Sys.App.Services.GameService.updateParentGameData({ _id: req.body.id }, data);

                    eventEmitter.emit('stopBotTicketPurchase', { parentGameId: req.body.id });

                    // Refund Next Game If available
                    module.exports.refundNextGame(req.body.id, gameType.type, true);

                    // Throw player to lobby once game is deleted or stopped for game2 and game3
                    module.exports.throwPlayerToLobby(req.body.id, gameType.type);
                }
            }
            if (!stopGame) {
                return res.send("fail");
            } else {
                return res.send("success");
            }
        } catch (error) {
            console.log("Error While Stopping Game", error);
            return res.send("fail");
        }
    },

    closeDayGameManagement: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let startFlag = true;
            let pauseFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Games Management'] || [];
                let stringReplace =req.session.details.isPermission['Games Management'] || [];

                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Games Management'];

                if (stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }

                if (stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }

                if (stringReplace.indexOf("start") == -1) {
                    startFlag = false;
                }

                if (stringReplace.indexOf("pause") == -1) {
                    pauseFlag = false;
                }

            }
            let keys = [
                "game_name",
                "daily_schedule_id",
                "add",
                "close_date",
                "start_time",
                "end_time",
                "active",
                "date",
                "select",
                "update",
                "close",
                "close_day",
                "select_date",
                "start_date",
                "end_date",
                "add_close_day",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "end_time_must_be_greater_than_start_time",
                "delete_message",
                "not_be_able_to_recover_close_day",
                "yes_delete",
                "no_cancle",
                "deleted",
                "cancelled",
                "close_day_deleted_success",
                "close_day_not_deleted",
                "added",
                "updated",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            console.log("closeDayGameManagement");
            let { typeId, id, gameType } = req.params
            if (!typeId || !id || !gameType) {

                req.flash('error', 'TypeId ,GameType and id  Not found');
                return res.redirect('/gameManagement');

            }

            let query = { _id: typeId };
            let gameTypeD = await Sys.App.Services.GameService.getGameTypeById(query);
            if (!gameTypeD) {

                req.flash('error', 'Game type Not found');
                return res.redirect('/gameManagement');

            }
            console.log("dataGame", gameTypeD);
            console.log("dataGame", req.params.id);
            let dataGame = ''
            if (gameType == 'game_2' || gameType == 'game_3') {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: req.params.id });
            } else if (gameType == 'game_4' || gameType == 'game_5') {
                dataGame = await Sys.App.Services.GameService.getById({ _id: req.params.id });
            } else if (gameType == "game_1") {
                dataGame = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.params.id }, { status: 1, otherData: 1, stopGame: 1, dailyScheduleId: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1, gameType: 1 }, {});
                if (!dataGame) {
                    req.flash('error', 'Schedule Not Found.');
                    return res.redirect('/gameManagement');
                }
                if (dataGame.status == "finish" || dataGame.stopGame == true) {
                    req.flash('error', 'Can not Add close days for stopped or finished schedule.');
                    return res.redirect('/gameManagement');
                }
                let startDate = moment(moment(dataGame.startDate).format("YYYY-MM-DD") + " " + dataGame.startTime).tz('UTC');
                let endDate = moment(moment(dataGame.endDate).format("YYYY-MM-DD") + " " + dataGame.endTime).tz('UTC');
                dataGame.startDate = startDate;
                dataGame.endDate = endDate;
                dataGame.gameType = "game_1";
            }

            console.log("dataGame", dataGame);

            if (!dataGame) {

                req.flash('error', 'Game Not found');
                return res.redirect('/gameManagement');

            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                GameManagement: 'active',
                CloseDay: dataGame.otherData && dataGame.otherData.closeDay ? dataGame.otherData.closeDay : [],
                dataGame: dataGame,
                gameType: gameTypeD,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                viewFlag: viewFlag,
                startFlag: startFlag,
                pauseFlag: pauseFlag,
                translate: translate,
                navigation: translate
            };


            return res.render('GameManagement/closeDay', data);

        } catch (error) {
            console.log("closeDayGameManagement error", error);
            return new Error(error);
        }
    },

    getCloseDayData: async function (req, res) {
        try {
            console.log("req.body", req.body);
            let { gameId, gameType } = req.query

            if (!gameId) {

                req.flash('error', 'Game Id Not found');
                res.send({
                    status: "fail",
                    message: "Game Id Not found"
                });

            }

            let dataGame = ''
            if (gameType == 'game_2' || gameType == 'game_3') {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: gameId });
            } else if (gameType == 'game_4' || gameType == 'game_5') {
                dataGame = await Sys.App.Services.GameService.getById({ _id: gameId });
            } else if (gameType == "game_1") {
                dataGame = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: gameId }, { otherData: 1 }, {});
            }

            var obj = {
                'draw': req.query.draw,
                'recordsTotal': dataGame.otherData && dataGame.otherData.closeDay ? dataGame.otherData.closeDay.length : 0,
                'recordsFiltered': dataGame.otherData && dataGame.otherData.closeDay ? dataGame.otherData.closeDay.length : 0,
                'data': dataGame.otherData && dataGame.otherData.closeDay ? dataGame.otherData.closeDay : [],
            };

            res.send(obj);
        } catch (error) {
            console.log("getCloseDayData error", error);
            return new Error(error);
        }
    },

    closeDayAdd: async function (req, res) {
        try {
            console.log("closeDayAdd req.body", req.body);
            let translate = await Sys.Helper.bingo.getTraslateData(["close_day_added_success"], req.session.details.language)
            
            let { startDate, endDate, startTime, endTime, gameId, gameType } = req.body

            if (!startDate || !endDate || !startTime || !endTime || !gameId) {

                req.flash('error', 'StartDate , EndDate, startTime ,endTime , gameType and gameId Not found');
                res.send({
                    status: "fail",
                    message: "StartDate , EndDate, startTime ,endTime  and gameId Not found"
                });

            }

            let dataGame = ''
            if (gameType == 'game_2' || gameType == 'game_3') {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: gameId });
            } else if (gameType == 'game_4' || gameType == 'game_5') {
                dataGame = await Sys.App.Services.GameService.getById({ _id: gameId });
            } else if (gameType == "game_1") {
                dataGame = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: gameId }, { otherData: 1 }, {});
            }

            const start = new Date(new Date(startDate).setUTCHours(0, 0, 0, 0));
            const end = new Date(new Date(endDate).setUTCHours(0, 0, 0, 0));
            const date = new Date(start.getTime());
            let dates = [];

            while (date <= end) {
                dates.push(new Date(date).toISOString().split('T')[0]);
                date.setDate(date.getDate() + 1);
            }

            console.log("dates", dates.length);

            let xyz = [...dates]

            dates = xyz.map((e, i) => {
                let obj = {
                    closeDate: e,
                    startTime: startTime,
                    endTime: endTime
                }
                if (i == 0) {
                    if (xyz.length == 1) {
                        return obj
                    }
                    obj.endTime = "23:59"
                    return obj
                } else if (i == (xyz.length - 1)) {
                    obj.startTime = "00:00"
                    return obj
                } else {
                    obj.startTime = "00:00"
                    obj.endTime = "23:59"
                    return obj
                }
            })

            console.log("dates", dates);


            let newArray = [];
            let closeData = dataGame.otherData && dataGame.otherData.closeDay ? dataGame.otherData.closeDay : []
            closeData.forEach((e) => {
                // Check if the date exists in the 'dates' array
                const dateExists = dates.find((date) => date.closeDate === e.closeDate);
                console.log("dateExists", dateExists);
                if (!dateExists) {
                    newArray.push(e);
                } else {
                    newArray.push({
                        closeDate: e.closeDate,
                        startTime: dateExists.startTime,
                        endTime: dateExists.endTime,
                        utcDates: {
                            startTime: new Date(moment(moment(e.closeDate).format("YYYY-MM-DD") + " " + dateExists.startTime).tz('UTC')),
                            endTime: new Date(moment(moment(e.closeDate).format("YYYY-MM-DD") + " " + dateExists.endTime).tz('UTC'))
                        }
                    });
                }
            });


            // Append new dates to 'newArray'
            dates.forEach((date) => {
                const dateExists = newArray.filter((entry) => entry.closeDate === date.closeDate);
                console.log("dateExists", dateExists);
                if (!dateExists.length) {
                    newArray.push({
                        closeDate: date.closeDate,
                        startTime: date.startTime,
                        endTime: date.endTime,
                        utcDates: {
                            startTime: new Date(moment(moment(date.closeDate).format("YYYY-MM-DD") + " " + date.startTime).tz('UTC')),
                            endTime: new Date(moment(moment(date.closeDate).format("YYYY-MM-DD") + " " + date.endTime).tz('UTC'))
                        }
                    });
                }
            });

            console.log("newArray", newArray);


            if (gameType == 'game_2' || gameType == 'game_3') {
                await Sys.App.Services.GameService.updateParentGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
            } else if (gameType == 'game_4' || gameType == 'game_5') {

                await Sys.App.Services.GameService.updateGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
                if (dataGame.otherData.isBotGame == false) {
                    Sys.AvailableGamesForHall = {};
                    Sys.Io.emit("checkGameStatus", {});
                }
            } else if (gameType == "game_1") {
                await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: gameId }, {
                    "otherData.closeDay": newArray
                });
                Sys.Game.Common.Controllers.GameController.updateClosedayGame1(gameId);
            }

            res.send({
                status: "success",
                message: translate.close_day_added_success

            });


        } catch (error) {
            console.log("closeDayAdd error", error);
            return new Error(error);
        }
    },


    deleteCloseDay: async function (req, res) {
        try {
            console.log(" deleteCloseDay req.body", req.body);
            let { closeDay, gameId, gameType } = req.body

            if (!closeDay || !gameId) {

                req.flash('error', 'CloseDate and GameId Not found');
                res.send({
                    status: "fail",
                    message: "Close Date and gameId Not found"
                });

            }


            if (gameType == 'game_2' || gameType == 'game_3') {

                let dataGame = await Sys.App.Services.GameService.getParentById({ _id: gameId });

                let newArray = dataGame.otherData.closeDay.filter((e) => {
                    return e.closeDate != closeDay
                })

                await Sys.App.Services.GameService.updateParentGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
            } else if (gameType == 'game_4' || gameType == 'game_5') {

                let dataGame = await Sys.App.Services.GameService.getById({ _id: gameId });

                let newArray = dataGame.otherData.closeDay.filter((e) => {
                    return e.closeDate != closeDay
                })

                await Sys.App.Services.GameService.updateGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
                if (dataGame.otherData.isBotGame == false) {
                    Sys.AvailableGamesForHall = {};
                    Sys.Io.emit("checkGameStatus", {});
                }
            } else if (gameType == "game_1") {
                let dataGame = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: gameId }, { otherData: 1 }, {});
                let newArray = dataGame.otherData.closeDay.filter((e) => {
                    return e.closeDate != closeDay
                })
                await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: gameId }, {
                    "otherData.closeDay": newArray
                });
                Sys.Game.Common.Controllers.GameController.updateClosedayGame1(gameId);
            }

            res.send({
                status: "success",
                message: "Close Day Delete Successfully"

            });


        } catch (error) {
            console.log("deleteCloseDay error", error);
            return new Error(error);
        }
    },

    updateCloseDay: async function (req, res) {
        try {
            console.log(" updateCloseDay req.body", req.body);
            let translate = await Sys.Helper.bingo.getTraslateData(["close_day_updated"], req.session.details.language)
            let { date, startTime, endTime, gameId, gameType } = req.body

            if (!date || !startTime || !endTime || !gameId) {

                req.flash('error', 'CloseDate,StartTime,EndTime  and gameId Not found');
                res.send({
                    status: "fail",
                    message: "CloseDate,StartTime,EndTime  and gameId Not found"
                });

            }

            let dataGame = ''
            if (gameType == 'game_2' || gameType == 'game_3') {
                dataGame = await Sys.App.Services.GameService.getParentById({ _id: gameId });
            } else if (gameType == 'game_4' || gameType == 'game_5') {
                dataGame = await Sys.App.Services.GameService.getById({ _id: gameId });
            } else if (gameType == 'game_1') {
                dataGame = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: gameId }, { otherData: 1 }, {});
            }

            let newArray = dataGame.otherData.closeDay.map((e) => {
                console.log(">>>", e.closeDate, date);
                if (e.closeDate == date) {
                    e.startTime = startTime
                    e.endTime = endTime
                    e.utcDates = {
                        startTime: new Date(moment(moment(e.closeDate).format("YYYY-MM-DD") + " " + startTime).tz('UTC')),
                        endTime: new Date(moment(moment(e.closeDate).format("YYYY-MM-DD") + " " + endTime).tz('UTC'))
                    }
                }
                return e
            })

            if (gameType == 'game_2' || gameType == 'game_3') {
                await Sys.App.Services.GameService.updateParentGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
            } else if (gameType == 'game_4' || gameType == 'game_5') {

                await Sys.App.Services.GameService.updateGameData({ _id: gameId }, {
                    $set: {
                        "otherData.closeDay": newArray
                    }
                })
                if (dataGame.otherData.isBotGame == false) {
                    Sys.AvailableGamesForHall = {};
                    Sys.Io.emit("checkGameStatus", {});
                }
            } else if (gameType == "game_1") {
                await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: gameId }, {
                    "otherData.closeDay": newArray
                });
                Sys.Game.Common.Controllers.GameController.updateClosedayGame1(gameId);
            }

            res.send({
                status: "success",
                message: translate.close_day_updated

            });


        } catch (error) {
            console.log("updateCloseDay error", error);
            return new Error(error);
        }
    },

    refundNextGame: async function(gameId, gameType, isTomorrow ) {
        try {
            console.log("Game 2 & 3 Refund function called for pre order games", gameId, gameType, isTomorrow);
            let query = {};
            if (isTomorrow) {
                const tomorrow = moment().add(1, 'day');
                const endOfTomorrow = tomorrow.endOf('day').toDate();
                const dayOfWeek = tomorrow.format('ddd');
                query = {
                    status: "active", 
                    parentGameId: mongoose.Types.ObjectId(gameId),
                    startDate: { $lte: endOfTomorrow },
                    day: dayOfWeek,
                    isBotGame: false,
                    'otherData.isBotGame': false
                }
            }else{
                query = {
                    _id: mongoose.Types.ObjectId(gameId),
                    status: "active", 
                    isBotGame: false,
                    'otherData.isBotGame': false
                }
            }
            const subGameList = await Sys.App.Services.GameService.getGamesByData(query, { _id: 1 });
            
            for (const game of subGameList) {
                if(gameType === 'game_2'){
                    console.log("game 2 refund called form admin")
                    await Sys.Game.Game2.Controllers.GameController.processRefundAndFinishGame(game._id, null);
                }else if(gameType === 'game_3'){
                    console.log("game 3 refund called from admin")
                    await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(game._id, null);
                }
            }
        } catch (error) {
            console.error("Error in refund of next day game on delete games", error);
        }
    },

    throwPlayerToLobby: async function(parentGameId, gameType) {
        try {
            const games = await Sys.Game.Game2.Services.GameServices.getByData(
                { parentGameId, status: "running" }, 
                { _id: 1 }
            );
            
            if (games.length > 0) return;

            const namespace = gameType === 'game_2' 
                ? Sys.Config.Namespace.Game2 
                : Sys.Config.Namespace.Game3;
            Sys.Io.of(namespace).to(parentGameId).emit('RefreshRoom', { gameId: parentGameId });
            Sys.AvailableGamesForHall = {};
        } catch (error) {
            console.error("throwPlayerToLobby error:", error);
        }
    },

    /**
     * Toggles the auto-stop feature for a daily schedule and propagates the update to its related games.
     *
     * Steps:
     * 1. Validate request body:
     *    - Ensure `scheduleId` and `status` are provided.
     * 2. Update the schedule:
     *    - Set `otherData.isAutoStopped` to the given status.
     *    - If the schedule is not found, return a 404 error.
     * 3. Update all related games:
     *    - Match by `parentGameId` and apply the same `isAutoStopped` status.
     * 4. Return success response with the updated status and schedule ID.
     *
     * Error handling:
     * - If input is invalid → return 400 with localized message.
     * - If schedule not found → return 404 with localized message.
     * - On unexpected failure → return 500 with localized message.
    */
    autoStopOnOff: async function(req, res) {
        const language = req.session.details.language;
        const { scheduleId } = req.body;
        const status = req.body.status === 'true' || req.body.status === true;
    
        if (!scheduleId || typeof status === 'undefined') {
            const message = await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language);
            return res.status(400).json({ success: false, message });
        }
    
        try {
            // Update and return the updated document
            const updatedSchedule = await Sys.App.Services.scheduleServices.updateDailySchedulesData(
                { _id: scheduleId },
                { 'otherData.isAutoStopped': status },
            );
    
            if (!updatedSchedule) {
                const message = await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language);
                return res.status(404).json({ success: false, message });
            }
    
            // Update all related games
            await Sys.Game.Common.Services.GameServices.updateManyData(
                { parentGameId: scheduleId },
                { 'otherData.isAutoStopped': updatedSchedule.otherData.isAutoStopped }
            );
    
            return res.json({ 
                success: true,
                message: `Auto-stop ${status ? 'enabled' : 'disabled'} successfully`,
                data: {
                    scheduleId: updatedSchedule._id,
                    autoStop: updatedSchedule.otherData.isAutoStopped
                }
            });
    
        } catch (error) {
            console.error("autoStopOnOff error:", error);
            const message = await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language);
            return res.status(500).json({ success: false, message });
        }
    }
}

function get2DArrayFromString(s) {
    let arr = s.replace(/\./g, ",");
    arr = arr.split`,`.map(x => +x);
    return arr;
}