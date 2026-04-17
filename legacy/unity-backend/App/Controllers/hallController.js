var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
const moment = require('moment-timezone');
const { translate } = require('../../Config/i18n');
const { getAvailableHallLimit, updateAgentHallNameSession } = require('../../gamehelper/all');
module.exports = {
    getAllHalls: async function (req, res) {
        try {
            console.log("this route called", req.body, req.query);
            let query = {
                "groupHall.id": req.query.id
            }
            let result = await Sys.App.Services.HallServices.getAllHallDataSelect(query, { name: 1 });
            console.log("result", result.length);
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
    hallView: async function (req, res) {
        try {

            let editFlag = true;
            let deleteFlag = true;
            let addFlag = true;
            let viewFlag = true;

            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Hall Management'] || [];
                let stringReplace =req.session.details.isPermission['Hall Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Hall Management'];

                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("delete") == -1) {
                    deleteFlag = false;
                }
                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    addFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }


            let keys = [
                "hall_management",
                "dashboard",
                "hall",
                "select_new_hall",
                "select_hall_to_move_players",
                "select_hall",
                "select_agent",
                "submit",
                "cancel",
                "search",
                "all",
                "inactive",
                "active",
                "group_of_hall_name",
                "reset",
                "add_hall",
                "hall_id",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "group_of_hall",
                "status",
                "action",
                "set_hall_total_cash_balance",
                "total_cash_balance",
                "delete_message",
                "something_went_wroge",
                "cancelled",
                "hall_not_deleted",
                "show",
                "entries",
                "previous",
                "next",
                "search",
                "delete_player_message",
                "delete_button",
                "attention",
                "cancel_button"
            ]


            let hallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                hallActive: 'active',
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                viewFlag: viewFlag,
                hallData: hallData,
                navigation: hallData
            };


            if (viewFlag == true) {
                return res.render('Hall/hallManagement', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in hallView", e);
            return new Error(e);
        }
    },

    hallAccountReportsView: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Hall Account Report'] || [];
                let stringReplace =req.session.details.isPermission['Hall Account Report'] || [];
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
            let keys = [
                "hall_account_report",
                "hall",
                "hall_id",
                "hall_name",
                "dashboard",
                "view",
                "settlement_report",
                "action",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                hallAccountReportActive: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                hallReport: translate,
                navigation: translate
            };


            return res.render('hallAccountReport/list', data);

        } catch (e) {
            console.log("Error in hallAccountReportView", e);
            return new Error(e);
        }
    },
    hallAccountReportTableView: async function (req, res) {
        try {
            console.log("hallAccountReportTableView page called", req.params.id);

            let keys = [
                "hall_account_report",
                "hall",
                "hall_id",
                "hall_name",
                "dashboard",
                "view",
                "settlement_report",
                "from_date",
                "to_date",
                "start_date",
                "end_date",
                "game_type",
                "real",
                "bot",
                "action",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "both_date_required",
                "date",
                "week_day",
                "resultat_bingonet",
                "bilag",
                "profit_transfer_to_bank",
                "other",
                "deposit_to_dropsafe",
                "cash_in_out_settlement",
                "comments"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                hallId: req.params.id,
                error: req.flash("error"),
                success: req.flash("success"),
                hallAccountReportActive: 'active',
                hallReport: translate,
                navigation: translate
            };


            return res.render('hallAccountReport/hallAccount', data);

        } catch (e) {
            console.log("Error in hallAccountReportView", e);
            return new Error(e);
        }
    },


    // gethallAccountReportData: async function (req, res) {
    //     try {
    //         console.log("halldatatable query", req.query);
    //         let order = req.query.order;
    //         let sort = {};
    //         if (order?.length) {
    //             let columnIndex = order[0].column;
    //             let sortBy = req.query.columns[columnIndex].data;
    //             sort = {
    //                 [sortBy]: order[0].dir == "asc" ? 1 : -1
    //             }
    //         }
    //         let start = parseInt(req.query.start);
    //         let length = parseInt(req.query.length);
    //         let fromDate = req.query.start_date;
    //         let toDate = req.query.end_date;

    //         if (fromDate) {
    //             let startOfToday = new Date(fromDate);
    //             fromDate = startOfToday.setHours(0, 0, 0, 0)
    //         }
    //         if (toDate) {
    //             let endDate = new Date(toDate);
    //             toDate = endDate.setHours(23, 59, 59, 999)
    //         }

    //         let isBotGame = false;
    //         if(req.query.playerType == "bot"){
    //             isBotGame = true
    //         }

    //         let query = [
    //             {
    //                 '$match': {
    //                     'hallId': req.query.hall,
    //                     'createdAt':{
    //                         '$gte': new Date(fromDate),
    //                         '$lte': new Date(toDate)
    //                     },
    //                     "isBotGame": isBotGame,
    //                     "gameType": {
    //                         "$exists": true, 
    //                         "$ne": "" 
    //                     }   
    //                 }
    //             }, {
    //                 '$group': {
    //                     '_id': {
    //                         'hallId': '$hallId',
    //                         'gameType': '$gameType',
    //                         'date': {
    //                             '$dateToString': {
    //                                 'format': '%d-%m-%Y',
    //                                 'date': '$createdAt'
    //                             }
    //                         }
    //                     },
    //                     'buyTicket': {
    //                         '$sum': {
    //                             '$cond': [
    //                                 {
    //                                     '$or': [
    //                                         {
    //                                             '$eq': [
    //                                                 '$game1Slug', 'buyTicket'
    //                                             ]
    //                                         }, {
    //                                             '$eq': [
    //                                                 '$defineSlug', 'buyTicket'
    //                                             ]
    //                                         }, {
    //                                             $and: [ {'$eq': ['$gameType', 'game_5'] }, {  '$eq': ['$typeOfTransaction', 'Game Joined'] }]

    //                                         }
    //                                     ]
    //                                 }, '$typeOfTransactionTotalAmount', 0
    //                             ]
    //                         }
    //                     },
    //                     'cancelTicket': {
    //                         '$sum': {
    //                             '$cond': [
    //                                 {
    //                                     '$or': [
    //                                         {
    //                                             '$eq': [
    //                                                 '$game1Slug', 'cancelTicket'
    //                                             ]
    //                                         }, {
    //                                             '$eq': [
    //                                                 '$defineSlug', 'cancelTicket'
    //                                             ]
    //                                         }
    //                                     ]
    //                                 }, '$typeOfTransactionTotalAmount', 0
    //                             ]
    //                         }
    //                     },
    //                     'UTD': {
    //                         '$sum': '$winningPrice'
    //                     }
    //                 }
    //             }, {
    //                 '$addFields': {
    //                     'OMS': {
    //                         '$subtract': [
    //                             '$buyTicket', '$cancelTicket'
    //                         ]
    //                     },
    //                     'parseDate':{
    //                         '$dateFromString': {
    //                             'dateString': "$_id.date",
    //                             'format': "%d-%m-%Y"
    //                         }
    //                     }
    //                 }
    //             }, {
    //                 '$group': {
    //                     '_id': {
    //                         'hallId': '$_id.hallId',
    //                         'date': '$_id.date',
    //                         'parseDate':'$parseDate'
    //                     },
    //                     'transactions': {
    //                         '$push': {
    //                             'k': "$_id.gameType",
    //                             'v': {
    //                                 '$subtract': [
    //                                     "$OMS",
    //                                     "$UTD"
    //                                 ]
    //                             },
    //                         },
    //                     }
    //                 }
    //             },
    //             {
    //                 '$lookup': {

    //                     'from': 'hallReport',
    //                     'let': {
    //                         'hallObjId': {
    //                             '$toString': '$_id.hallId'
    //                         },
    //                         'reportDate': '$_id.parseDate'
    //                     },
    //                     'pipeline': [
    //                         {
    //                             '$match': {
    //                                 '$expr': {
    //                                     $and: [
    //                                       {
    //                                         '$eq': ['$hallId', '$$hallObjId']
    //                                       },
    //                                       {
    //                                         '$eq': ['$date', '$$reportDate' ]
    //                                       }
    //                                 ]
    //                                 }
    //                             }
    //                         }, {
    //                             '$project': {
    //                                 '_id': 1,
    //                                 'stationery': 1,
    //                                 'coffeeServed': 1,
    //                                 'coffeeBill': 1,
    //                                 'transferToBank': 1,
    //                                 'cardPayment': 1,
    //                                 'cashDepositInBingoBank': 1,
    //                                 'comment': 1,
    //                             }
    //                         }
    //                     ],
    //                     'as': 'hallReport'

    //                 }
    //             },
    //             {
    //                 '$project': {
    //                     '_id': 0,
    //                     'date': '$_id.date',
    //                     'parseDate':'$_id.parseDate',
    //                     'games': { '$arrayToObject': '$transactions' },
    //                     'hallReport': '$hallReport'
    //                 },
    //             },
    //             {
    //                 "$sort":{
    //                     "parseDate":-1
    //                 }
    //             }
    //         ];

    //         let data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(query);
    //         console.log('Hall Data', data.length);
    //         for (let i = 0; i < data.length; i++) {
    //             if (data[i]["games"]['game_1']) {
    //                 data[i].game1 = parseFloat(data[i]["games"]['game_1']).toFixed(3);
    //             } else {
    //                 data[i].game1 = 0
    //             }
    //             if (data[i]["games"]['game_2']) {
    //                 data[i].game2 = parseFloat(data[i]["games"]['game_2']).toFixed(3)
    //             } else {
    //                 data[i].game2 = 0
    //             }
    //             if (data[i]["games"]['game_3']) {
    //                 data[i].game3 = parseFloat(data[i]["games"]['game_3']).toFixed(3);
    //             } else {
    //                 data[i].game3 = 0
    //             }
    //             if (data[i]["games"]['game_4']) {
    //                 data[i].game4 = parseFloat(data[i]["games"]['game_4']).toFixed(3);
    //             } else {
    //                 data[i].game4 = 0
    //             }
    //             if (data[i]["games"]['game_5']) {
    //                 data[i].game5 = parseFloat(data[i]["games"]['game_5']).toFixed(3);
    //             } else {
    //                 data[i].game5 = 0
    //             }
    //             delete data[i]["games"];
    //         }

    //         let obj = {
    //             'draw': req.query.draw,
    //             'recordsTotal': data.length,
    //             'recordsFiltered': data.length,
    //             'data': data,
    //         };

    //         console.log("HallData:::::::::::::", data)

    //         return res.send(obj);
    //     } catch (e) {
    //         console.log("Error in getHall", e);
    //         return res.send({
    //             'draw': req.query.draw,
    //             'recordsTotal': 0,
    //             'recordsFiltered': 0,
    //             'data': []
    //         })
    //     }
    // },

    gethallAccountReportData: async function (req, res) {
        try {
            //console.log("halldatatable query", req.query);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let fromDate = req.query.start_date;
            let toDate = req.query.end_date;

            if (fromDate) {
                let startOfToday = new Date(fromDate);
                fromDate = startOfToday.setHours(0, 0, 0, 0)
            }
            if (toDate) {
                let endDate = new Date(toDate);
                toDate = endDate.setHours(23, 59, 59, 999)
            }

            let data = [];
            if (req.query.playerType == "bot") {

                let query = [
                    {
                        '$match': {
                            'hallId': req.query.hall,
                            'createdAt': {
                                '$gte': new Date(fromDate),
                                '$lte': new Date(toDate)
                            },
                            "isBotGame": true,
                            "gameType": {
                                "$exists": true,
                                "$ne": ""
                            }
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$hallId',
                                'gameType': '$gameType',
                                'date': {
                                    '$dateToString': {
                                        'format': '%d-%m-%Y',
                                        'date': '$createdAt'
                                    }
                                }
                            },
                            'buyTicket': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$or': [
                                                {
                                                    '$eq': [
                                                        '$game1Slug', 'buyTicket'
                                                    ]
                                                }, {
                                                    '$eq': [
                                                        '$defineSlug', 'buyTicket'
                                                    ]
                                                }, {
                                                    $and: [{ '$eq': ['$gameType', 'game_5'] }, { '$eq': ['$typeOfTransaction', 'Game Joined'] }]

                                                }
                                            ]
                                        }, '$typeOfTransactionTotalAmount', 0
                                    ]
                                }
                            },
                            'cancelTicket': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$or': [
                                                {
                                                    '$eq': [
                                                        '$game1Slug', 'cancelTicket'
                                                    ]
                                                }, {
                                                    '$eq': [
                                                        '$defineSlug', 'cancelTicket'
                                                    ]
                                                }
                                            ]
                                        }, '$typeOfTransactionTotalAmount', 0
                                    ]
                                }
                            },
                            'UTD': {
                                '$sum': '$winningPrice'
                            }
                        }
                    }, {
                        '$addFields': {
                            'OMS': {
                                '$subtract': [
                                    '$buyTicket', '$cancelTicket'
                                ]
                            },
                            'parseDate': {
                                '$dateFromString': {
                                    'dateString': "$_id.date",
                                    'format': "%d-%m-%Y"
                                }
                            }
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$_id.hallId',
                                'date': '$_id.date',
                                'parseDate': '$parseDate'
                            },
                            'transactions': {
                                '$push': {
                                    'k': "$_id.gameType",
                                    'v': {
                                        '$subtract': [
                                            "$OMS",
                                            "$UTD"
                                        ]
                                    },
                                },
                            }
                        }
                    },
                    {
                        '$project': {
                            '_id': 0,
                            'date': '$_id.date',
                            'parseDate': '$_id.parseDate',
                            'games': { '$arrayToObject': '$transactions' },
                        },
                    },
                    {
                        "$sort": {
                            "parseDate": -1
                        }
                    }
                ];

                data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(query);
                console.log('Hall Data for bot', data.length, data);
                for (let i = 0; i < data.length; i++) {
                    if (data[i]["games"]['game_1']) {
                        data[i].game1 = parseFloat(data[i]["games"]['game_1']).toFixed(3);
                    } else {
                        data[i].game1 = 0
                    }
                    if (data[i]["games"]['game_2']) {
                        data[i].game2 = parseFloat(data[i]["games"]['game_2']).toFixed(3)
                    } else {
                        data[i].game2 = 0
                    }
                    if (data[i]["games"]['game_3']) {
                        data[i].game3 = parseFloat(data[i]["games"]['game_3']).toFixed(3);
                    } else {
                        data[i].game3 = 0
                    }
                    if (data[i]["games"]['game_4']) {
                        data[i].game4 = parseFloat(data[i]["games"]['game_4']).toFixed(3);
                    } else {
                        data[i].game4 = 0
                    }
                    if (data[i]["games"]['game_5']) {
                        data[i].game5 = parseFloat(data[i]["games"]['game_5']).toFixed(3);
                    } else {
                        data[i].game5 = 0
                    }
                    data[i].allGameProfit = (+data[i].game1 + +data[i].game2 + +data[i].game3 + +data[i].game4 + +data[i].game5)
                    data[i]._id = moment(data[i].parseDate).format("YYYY-MM-DD");
                    data[i].totalAmountMetronia = 0;
                    data[i].totalAmountOkBingo = 0;
                    data[i].totalAmountFranco = 0;
                    data[i].totalAmountOtium = 0;
                    data[i].totalAmountNorskTotalt = 0;
                    data[i].totalAmountNorskRikstotoTotalt = 0;
                    data[i].totalAmountRekvisita = 0;
                    data[i].totalAmountSellProduct = 0;
                    data[i].totalAmountBilag = 0;
                    data[i].totalAmountBank = 0;
                    data[i].totalAmountTransferredByBank = 0;
                    data[i].totalAmountAnnet = 0;
                    data[i].totalDropSafeAmount = 0;
                    data[i].withdrawFromtotalBalance = 0;
                    data[i].settlmentNote = [];

                    delete data[i]["games"];
                }
            } else {
                let query = [
                    {
                        $match: {
                            hallId: mongoose.Types.ObjectId(req.query.hall),
                            date: { $gte: new Date(fromDate), $lte: new Date(toDate) }
                        }
                    },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                            allGameProfit: { $last: "$allGameProfit" },
                            totalAmountMetronia: { $sum: "$totalAmountMetronia" },
                            totalAmountOkBingo: { $sum: "$totalAmountOkBingo" },
                            totalAmountFranco: { $sum: "$totalAmountFranco" },
                            totalAmountOtium: { $sum: "$totalAmountOtium" },
                            totalAmountNorskTotalt: { $sum: "$totalAmountNorskTotalt" },
                            totalAmountNorskRikstotoTotalt: { $sum: "$totalAmountNorskRikstotoTotalt" },
                            totalAmountRekvisita: { $sum: "$totalAmountRekvisita" },
                            totalAmountSellProduct: { $sum: "$totalAmountSellProduct" },
                            totalAmountBilag: { $sum: "$totalAmountBilag" },
                            totalAmountBank: { $sum: "$totalAmountBank" },
                            totalAmountTransferredByBank: { $sum: "$totalAmountTransferredByBank" },
                            totalAmountAnnet: { $sum: "$totalAmountAnnet" },
                            totalDropSafeAmount: { $sum: "$settlementToDropSafe" },
                            withdrawFromtotalBalance: { $sum: "$withdrawFromtotalBalance" },
                            settlmentNote: { $push: "$settlmentNote" }
                        }
                    },
                    {
                        $sort: { _id: 1 }
                    },
                ];
                data = await Sys.App.Services.AgentServices.aggregateQuerySettlement(query);
            }

            console.log('Hall Data', data.length);

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': data.length,
                'recordsFiltered': data.length,
                'data': data,
            };

            console.log("HallData:::::::::::::", data)

            return res.send(obj);
        } catch (e) {
            console.log("Error in getHall", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            })
        }
    },

    getHall: async function (req, res) {
        try {
            console.log("halldatatable query", req.query);
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
            if (req.query.playerStatus != '') {
                query.status = req.query.playerStatus;
            }
            if (req.query.grpHallId != '') {
                query['groupHall.id'] = req.query.grpHallId;
            }
            if (search != '') {
                query["$or"] = [
                    { hallId: { $regex: '.*' + search + '.*' } },
                    { name: { $regex: '.*' + search + '.*', $options: 'i' } },
                    { number: { $regex: '.*' + search + '.*', $options: 'i' } }
                ]
            }
            console.log('query:-', query);
            let reqCount = await Sys.App.Services.HallServices.getHallCount(query);

            let data = await Sys.App.Services.HallServices.getHallDatatable(query, length, start, sort);
            console.log('Hall Data', data);

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            console.log("HallData:::::::::::::", data)

            return res.send(obj);
        } catch (e) {
            console.log("Error in getHall", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            })
        }
    },

    addHall: async function (req, res) {
        try {
            // Use session-stored form data to repopulate after validation errors (more reliable than flash)
            let formData = {};
            if (req.session && req.session.hallFormData) {
                formData = req.session.hallFormData;
                delete req.session.hallFormData; // clear after first use
            }

            let keys = [
                "edit_hall",
                "add_hall",
                "dashboard",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel"

            ]

            let hallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                formData,
                hallActive: 'active',
                hallData: hallData,
                navigation: hallData
            };
            return res.render('Hall/addHall', data);
        } catch (e) {
            console.log("Error in add hall page", e);
        }
    },

    addHallPostData: async function (req, res) {
        try {
            console.log("addHallPostData", req.body);
            const retainForm = () => {
                if (req.session) {
                    req.session.hallFormData = req.body;
                }
            };
            if (req.body.hallName == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_name_required"], req.session.details.language))//'Hall Name Required');
                retainForm();
                return res.redirect('/addHall');
            }
            if (req.body.ip == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_ip_address_required"], req.session.details.language))//'Hall IP Address Required');
                retainForm();
                return res.redirect('/addHall');
            }

            if (req.body.address == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_address_required"], req.session.details.language))//'Hall Address Required');
                retainForm();
                return res.redirect('/addHall');
            }
            if (req.body.city == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_city_name_required"], req.session.details.language))//'Hall City Name Required');
                retainForm();
                return res.redirect('/addHall');
            }
            if (req.body.hallNumber == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_number_required"], req.session.details.language))//'Hall Number Required');
                retainForm();
                return res.redirect('/addHall');
            }
            let name = req.body.hallName.trim();
            let IP = req.body.ip.trim();
            let address = req.body.address.trim();
            let city = req.body.City.trim();
            let number = req.body.hallNumber.trim();
            //Check if IP address Already Taken
            let existingIP = await Sys.App.Services.HallServices.getSingleHall({ "ip": IP });
            if (existingIP) {
                req.flash('error', `${await Sys.Helper.bingo.getSingleTraslateData(["ip_address_already_taken_in"], req.session.details.language)} ${existingIP.name}`);
                retainForm();
                return res.redirect('/addHall');
            }

            //Check if Hall number Already Taken
            let existingNumber = await Sys.App.Services.HallServices.getSingleHall({ "number": number });
            if (existingNumber) {
                req.flash('error', `${await Sys.Helper.bingo.getSingleTraslateData(["hall_number_already_taken_in"], req.session.details.language)} ${existingNumber.name}`);
                retainForm();
                return res.redirect('/addHall');
            }

            let ID = Date.now()
            let createID = await Sys.Helper.bingo.dateTimeFunction(ID);
            let hall = await Sys.App.Services.HallServices.insertHallData({
                name: name,
                number: number,
                hallId: createID + '_Hall',
                ip: IP,
                address: address,
                city: city,
                status: req.body.status == 'inactive' ? req.body.status : 'active'
            });
            if (!hall) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_not_created"], req.session.details.language))//'Hall Not Created');
                retainForm();
                return res.redirect('/addHall');
            } else {
                req.flash('success', await Sys.Helper.bingo.getSingleTraslateData(["hall_create_successfully"], req.session.details.language))//'Hall create successfully');
                return res.redirect('/hall');
            }
        } catch (e) {
            console.log("Error ", e);
            req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["internal_server_error"], req.session.details.language))//'Internal Server Error');
            return res.redirect('/hall');
        }
    },

    editHall: async function (req, res) {
        try {
            if (req.params.id == '') {
                req.flash("error", "Hall not Found");
                return res.redirect('/hall');
            }
            let hall = await Sys.App.Services.HallServices.getById({ _id: req.params.id });

            let keys = [
                "edit_hall",
                "add_hall",
                "dashboard",
                "hall_name",
                "hall_number",
                "ip_address",
                "address",
                "city",
                "status",
                "active",
                "inactive",
                "submit",
                "cancel"

            ]

            let hallData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                hallActive: 'active',
                Hall: hall,
                hallData: hallData,
                navigation: hallData
            };
            return res.render('Hall/addHall', data);

        } catch (e) {
            console.log("Error in edit hall page", e);
        }
    },


    editHallPostData: async function (req, res) {
        try {
            console.log("editHallPostData", req.body);
            if (req.params.id == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["no_hall_found"], req.session.details.language))//'No Hall found');
                return res.redirect('/hall');
            }
            if (req.body.hallName == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_name_required"], req.session.details.language))//'Hall Name Required');
                return res.redirect('/hall');
            }
            if (req.body.ip == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_ip_address_required"], req.session.details.language))//'Hall IP Address Required');
                return res.redirect('/hall');
            }

            if (req.body.address == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_address_required"], req.session.details.language))//'Hall Address Required');
                return res.redirect('/hall');
            }
            if (req.body.city == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_city_name_required"], req.session.details.language))//'Hall City Name Required');
                return res.redirect('/hall');
            }
            if (req.body.hallNumber == '') {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["hall_number_required"], req.session.details.language))//'Hall Number Required');
                return res.redirect('/hall');
            }
            let id = req.params.id.trim();
            let name = req.body.hallName.trim();
            let IP = req.body.ip.trim();
            let address = req.body.address.trim();
            let city = req.body.City.trim();
            let number = req.body.hallNumber.trim();

            //Check if IP address Already Taken
            let existingIP = await Sys.App.Services.HallServices.getSingleHall({ "_id": { "$ne": id }, "ip": IP });
            if (existingIP) {
                req.flash('error', `${await Sys.Helper.bingo.getSingleTraslateData(["ip_address_already_taken_in"], req.session.details.language)} ${existingIP.name}`);
                return res.redirect(`/hallEdit/${id}`);
            }

            //Check if Hall number Already Taken
            let existingNumber = await Sys.App.Services.HallServices.getSingleHall({ "_id": { "$ne": id }, "number": number });
            if (existingNumber) {
                req.flash('error', `${await Sys.Helper.bingo.getSingleTraslateData(["hall_number_already_taken_in"], req.session.details.language)} ${existingNumber.name}`);
                return res.redirect(`/hallEdit/${id}`);
            } 
            
            let hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: id });
                
            if (!hall) {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["no_hall_found"], req.session.details.language))//'No Hall found');
                return res.redirect(`/hallEdit/${id}`);
            }

            if (hall.groupHall.name != undefined && req.body.status == "inactive") {
                req.flash('error', await Sys.Helper.bingo.getSingleTraslateData(["first_remove_hall_from_grouphall_in_order_to_inactive"], req.session.details.language))//'First Remove hall from GroupHall in oreder to inactive the hall.');
                return res.redirect(`/hallEdit/${id}`);
            }

            // if (hall.agents.length) {
            //     let agentIds = hall.agents.map((v, i) => { return v.id });
            //     await Sys.App.Services.AgentServices.updateAgentData({
            //         "_id": {
            //             "$in": agentIds
            //         },
            //         "hall.id": hall._id
            //     }, {
            //         "$set": {
            //             "hall.$.name": name
            //         }
            //     });
            // }
            if (hall.groupHall.id) {
                await Sys.App.Services.GroupHallServices.updateHallData({
                    "_id": hall.groupHall.id,
                    "halls.id": hall._id.toString()
                }, {
                    "$set": {
                        "halls.$.name": name
                    }
                });
            }

            let data = {
                name: req.body.hallName.trim(),
                ip: IP,
                number: number,
                address: address,
                city: city,
                status: req.body.status == 'inactive' ? req.body.status : 'active',
                products: (hall.products?.length > 0) ? hall.products : []
            }


            await Sys.App.Services.HallServices.updateHallData({ _id: id }, data)

            // Check if hall name has changed and update players
            if (hall.name !== name) {
                await module.exports.updatePlayerAgentHallName(id, name, hall?.groupHall?.id);
            }

            req.flash('success', 'Hall updated successfully');
            return res.redirect('/hall');

        } catch (e) {
            console.log("Error in editHall", e);
            req.flash('error', 'Internal Server Error.');
            return res.redirect('/hall');
        }
    },

    //Check if hall can be deleted or not.
    getHallDelete: async function (req, res) {
        try {
            let keys = [
                "can_not_delete_hall_as_assigned_in_game"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            
            if (req.body.id.trim() == '') {
                return res.send({ status: "error" });
            }
            let hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.body.id });
            if (hall) {
                let query = {
                    "status": { "$in": ["active", "running"] },
                    "allHallsId": { $in: [hall._id.toString()] }
                }
                let gameCount = await Sys.App.Services.GameService.getSelectedParentGameCount(query);
                if (!gameCount) {
                    gameCount = await Sys.App.Services.scheduleServices.getDailySchedulesCount({
                        "status": { "$in": ["active", "running"] },
                        "halls": { $in: [hall._id.toString()] },
                        "stopGame": false
                    });
                }
                if (gameCount) {
                    return res.send({
                        status: "success",
                        isDelete: 0,
                        message: translate.can_not_delete_hall_as_assigned_in_game
                    });
                } else {
                    let playerCount = await Sys.App.Services.PlayerServices.getPlayerCount({
                        // "hall.id": hall._id.toString(),
                        // "hall.status": {
                        //     "$in" : ['Approved','Pending']
                        // },
                        // "isDeleted":false
                        "approvedHalls": { $elemMatch: { 'id': hall._id.toString(), 'status': {"$in" : ['Approved','Pending']} } },
                        "isDeleted":false
                    });
                    if (playerCount >= 1) {
                        //Hall cannot be deleted
                        query = {
                            "_id": { "$ne": hall._id },
                            "status": "active",
                            "agents": { $exists: true, $type: 'array', $ne: [] }
                        }
                        let column = ["_id", "name", "agents"];
                        let newHallOptions = await Sys.App.Services.HallServices.getAllHallDataSelect(query, column);

                        if (newHallOptions.length) {
                            return res.send({
                                status: "success",
                                isDelete: 1,
                                message: "Please select new hall for players of existing hall!!!",
                                halls: newHallOptions
                            });
                        } else {
                            return res.send({
                                status: "success",
                                isDelete: 0,
                                message: "There are no halls available for exixting Players to move.Please Create one and try again.",
                                halls: []
                            });
                        }
                    } else {
                        //Hall can be deleted
                        if (hall.groupHall.id) {
                            //Remove Hall From its GroupofHalls
                            await Sys.App.Services.GroupHallServices.updateHallData({ "_id": hall.groupHall.id }, {
                                "$pull": {
                                    "halls": { "id": hall._id.toString() }
                                }
                            });
                        }

                        for (let i = 0; i < hall.agents.length; i++) {
                            //Remove Hall From its assigned Agent
                            await Sys.App.Services.AgentServices.updateAgentData({ "_id": hall.agents.id }, {
                                "$pull": {
                                    "hall": { "id": hall._id.toString() }
                                }
                            });
                        }

                        //Finally Delete Hall From Database
                        await Sys.App.Services.HallServices.deleteHall(hall._id);
                        return res.send({
                            status: "success",
                            isDelete: 1,
                            message: "Hall Deleted Sucessfully!!",
                            halls: []
                        });
                    }
                    // if (hall.agents.id) {
                    //     await Sys.App.Services.AgentServices.updateAgentData({
                    //         "_id": hall.agents.id
                    //     }, {
                    //         "$pull": {
                    //             "hall": { id: hall._id.toString() }
                    //         }
                    //     });
                    // }
                    // await Sys.App.Services.HallServices.deleteHall(hall._id)
                    // return res.send({status:"success", isDelete:1});
                }
                // if (hall.groupHall.name != undefined) {
                //     return res.send({ status: "success", isDelete: 0, message: "Please Remove Hall From GroupHall First" });
                // }
            } else {
                return res.send({ status: "error" });
            }
        } catch (e) {
            console.log("Error in delete Hall", e);
            return res.send({ status: "error" });
        }
    },

    //Move Players to another hall and delete the selected hall
    // transferPlayersToHall: async function (req, res) {
    //     try {
    //         console.log("transferPlayersToHall called",req.body);
    //         let currentHallId,newHallId,newAgentId;
    //         if (req.body.currentHall !== '' && req.body.newHall !== '' && req.body.newAgent !== '') {
    //             currentHallId = req.body.currentHall;
    //             newHallId = req.body.newHall;
    //             newAgentId = req.body.newAgent;
    //         }else{
    //             return res.send({ status: "error" });
    //         }

    //         //Get Current Hall
    //         let currentHall = await Sys.App.Services.HallServices.getSingleHall({ "_id": currentHallId });

    //         //Get Selected Hall To move Players 
    //         let newHall = await Sys.App.Services.HallServices.getSingleHall({ "_id": newHallId });
    //         let newAgent = await Sys.App.Services.AgentServices.getSingleAgentData({ "_id": newAgentId });
    //         if (newHall && newAgent) {
    //             //Get All Players in Current Hall (Exclude Rejected Players)
    //             let currentHallPlayers = await Sys.App.Services.PlayerServices.getByData({
    //                 "hall.id": currentHallId,
    //                 "hall.status":{"$ne":"Rejected"}
    //             });
    //             console.log("currentHallPlayers", currentHallPlayers.length);
    //             let operations = [];

    //             //If any Players Found
    //             if (currentHallPlayers.length) {
    //                 for (let i = 0; i < currentHallPlayers.length; i++) {
    //                     const player = currentHallPlayers[i];
    //                     console.log("player",player.username,player.hall.status);
    //                     let query;
    //                     if ((player.hall.status === "Approved" || player.hall.status === "Pending") && player.hall.actionBy) {
    //                         query = {
    //                             updateOne: {
    //                                 filter: { _id: player.id },
    //                                 update: { 
    //                                     $set: { 
    //                                         "hall.id": newHallId,
    //                                         "hall.name": newHall.name,
    //                                         "hall.agent":{
    //                                             "id": newAgent._id.toString(),
    //                                             "name": newAgent.name
    //                                         },
    //                                         "hall.actionBy":{
    //                                             "id": newAgent._id.toString(),
    //                                             "name": newAgent.name,
    //                                             "role": "agent"
    //                                         }
    //                                     } 
    //                                 }
    //                             }
    //                         }
    //                     } else {
    //                         query = {
    //                             updateOne: {
    //                                 filter: { _id: player.id },
    //                                 update: {
    //                                     $set: {
    //                                         "hall.id": newHallId,
    //                                         "hall.name": newHall.name,
    //                                         "hall.agent": {
    //                                             "id": newAgent._id.toString(),
    //                                             "name": newAgent.name
    //                                         }
    //                                     }
    //                                 }
    //                             }
    //                         }
    //                     }
    //                     if (query) {
    //                         //Push Query Operations
    //                         operations.push(query);
    //                     }
    //                 }
    //             }

    //             if (operations.length) {
    //                 console.log("query before operation", JSON.stringify(operations));
    //                 //BulkWrite data into database
    //                 let data = await Sys.App.Services.PlayerServices.bulkWritePlayerData(operations,{
    //                     ordered : false
    //                 });
    //                 console.log("data after bulk write",data);
    //             }
    //             if (currentHall.groupHall.id) {
    //                 //Remove Hall From its GroupofHalls
    //                 await Sys.App.Services.GroupHallServices.updateHallData({ "_id": currentHall.groupHall.id},{
    //                     "$pull" : {
    //                         "halls": { "id": currentHall._id.toString() }
    //                     }
    //                 });
    //             }
    //             //Remove Hall From its assigned Agent
    //             await Sys.App.Services.AgentServices.updateAgentData({ "_id": currentHall.agents.id }, {
    //                 "$pull": {
    //                     "hall": { "id": currentHall._id.toString() }
    //                 }
    //             });
                
    //             //Finally Delete Hall From Database
    //             await Sys.App.Services.HallServices.deleteHall(currentHallId);
    //             return res.send({status:"success"});
    //         }else{
    //             return res.send({ status: "error" });
    //         }
    //     } catch (e) {
    //         console.log("Error in transferPlayersToHall", e);
    //         return res.send({ status: "error" });
    //     }
    // },

    transferPlayersToHall: async function (req, res) {
        try {
            console.log("transferPlayersToHall called", req.body);
            let currentHallId, newHallId, newAgentId;
            if (req.body.currentHall !== '' && req.body.newHall !== '' && req.body.newAgent !== '') {
                currentHallId = req.body.currentHall;
                newHallId = req.body.newHall;
                newAgentId = req.body.newAgent;
            } else {
                return res.send({ status: "error" });
            }

            //Get Current Hall
            let currentHall = await Sys.App.Services.HallServices.getSingleHall({ "_id": currentHallId });

            //Get Selected Hall To move Players 
            let newHall = await Sys.App.Services.HallServices.getSingleHall({ "_id": newHallId });
            let newAgent = await Sys.App.Services.AgentServices.getSingleAgentData({ "_id": newAgentId });
            let oldAgents = await Sys.App.Services.AgentServices.getAllAgentDataSelect({ "hall": {$elemMatch: {'id': currentHallId} } }, {name: 1});
            const oldAgentIds = oldAgents.length > 0 ? oldAgents.map(agent => agent._id.toString()): [];
            const newPlayerAgent = {
                id: newAgent.id,
                name: newAgent.name
            }
            console.log("oldAgentIds & newPlayerAgent---", oldAgentIds, newPlayerAgent);
            if (newHall && newAgent) {
                //Get All Players in Current Hall (Exclude Rejected Players)
                let currentHallPlayers = await Sys.App.Services.PlayerServices.getByData({
                    "approvedHalls": { $elemMatch: { 'id': currentHallId, 'status': {"$in" : ['Approved','Pending']} } },
                });
                console.log("currentHallPlayers", currentHallPlayers);
                const newHallData = {
                    status: "Approved",
                    id: newHall.id,
                    name: newHall.name,
                    groupHall: newHall.groupHall // Dynamic groupHall
                };
                
                let operations = [];
                let socketIds = [];
                //If any Players Found
                if (currentHallPlayers.length) {
                    for (let i = 0; i < currentHallPlayers.length; i++) {
                        const player = currentHallPlayers[i];
                        console.log("player",player.username,player.hall.status);
                        //let updatedHallObj = player.hall;
                        if(player.hall && player.hall.id == currentHallId ){
                            socketIds.push({socketId: player.socketId, language: player.selectedLanguage});
                            //updatedHallObj = {};
                        }
                        
                        const isEmptyObject = (obj) => Object.keys(obj).length === 0 && obj.constructor === Object;
                        const updatedPlayerAgent = (isEmptyObject(player.playerAgent) || oldAgentIds.includes(player.playerAgent.id)) 
                        ? newPlayerAgent // Set the newPlayerAgent if condition is met
                        : player.playerAgent;

                        operations.push(

                            {
                                updateOne: {
                                    filter: { _id: player.id },
                                    update: {
                                        $pull: { 
                                            approvedHalls: { id: { $in: [currentHallId, newHallData.id] } } // Remove old hall by ID
                                        },
                                        $set: {
                                           // hall: updatedHallObj,
                                            playerAgent: updatedPlayerAgent
                                        }
                                    },
                                    upsert: true
                                }
                            },

                            {
                                updateOne: {
                                    filter: { _id: player.id },
                                    update: {
                                        $addToSet: {
                                            approvedHalls: newHallData // Add the new hall after pulling the old ones
                                        }
                                    },
                                    upsert: true
                                }
                            },

                            // {
                            //     updateOne: {
                            //         filter: { _id: player.id },
                            //         update: {
                            //             $set: {
                            //                 playerAgent: updatedPlayerAgent
                            //             }
                            //         },
                            //         upsert: true
                            //     }
                            // }

                        );
                        
                    }
                }
                
                if (operations.length) {
                    console.log("query before operation", JSON.stringify(operations));
                    //BulkWrite data into database
                    let data = await Sys.App.Services.PlayerServices.bulkWritePlayerData(operations,{
                        ordered : true
                    });
                    console.log("data after bulk write", data);
                }
                if (currentHall.groupHall.id) {
                    //Remove Hall From its GroupofHalls
                    await Sys.App.Services.GroupHallServices.updateHallData({ "_id": currentHall.groupHall.id }, {
                        "$pull": {
                            "halls": { "id": currentHall._id.toString() }
                        }
                    });
                }
                //Remove Hall From its assigned Agent
                await Sys.App.Services.AgentServices.updateAgentData({ "_id": currentHall.agents.id }, {
                    "$pull": {
                        "hall": { "id": currentHall._id.toString() }
                    }
                });

                //Finally Delete Hall From Database
                await Sys.App.Services.HallServices.deleteHall(currentHallId);
                if(socketIds.length > 0){
                    for(let s=0; s < socketIds.length; s++){
                        console.log("socketIds[s]", socketIds[s]);
                        await Sys.Io.to(socketIds[s].socketId).emit('ForceLogout', {
                            playerId: "",
                            message: await translate({ key: "logout_as_hall_change", language: socketIds[s].language }), //"You are logged off due to hall change.",
                        });
                    }
                }
                return res.send({status:"success"});
            }else{
                return res.send({ status: "error" });
            }
        } catch (e) {
            console.log("Error in transferPlayersToHall", e);
            return res.send({ status: "error" });
        }
    },

    saveHallReportData: async function (req, res) {
        try {
            let report = await Sys.App.Services.HallServices.getSingleHallReportData({ hallId: req.body.hallId, date: req.body.date }, { hallId: 1 });
            if (report) {
                await Sys.App.Services.HallServices.updateHalReportData({ hallId: req.body.hallId, date: req.body.date }, {
                    [req.body.name]: req.body.value
                });
            } else {
                await Sys.App.Services.HallServices.insertHallReportData({
                    createrId: req.session.details.id,
                    hallId: req.body.hallId,
                    date: req.body.date,
                    [req.body.name]: req.body.value,
                });
            }
            res.send({ status: "success" });
        } catch (e) {
            console.log("Error in saveHallReportData", e);
            res.send({ status: "failed" });
        }
    },

    setHallCashBalance: async function (req, res) {
        try {
            let { amount, id } = req.body;
            amount = parseFloat(amount);
            if (isNaN(amount) || amount <= 0) {
                return res.json({ status: "fail", message: 'Amount must be greater than zero' });
            }

            if (!id) {
                return res.json({ status: "fail", message: 'Something went wrong, please try again later.' });
            }

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: id }, { hallCashBalance: 1 });
            if (hallsData) {
                // if(hallsData.hallCashBalance > 0 || hallsData.otherData?.hallCashBalanceAdded == true){
                //     return res.json({ status: "fail", message: 'Can not update Hall cash Balance.' });
                // }
                //let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id }, { $inc: { "hallCashBalance": +amount }, $set: { 'otherData.hallCashBalanceAdded': true } }, { new: true });

                let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallsData.id }, { $set: { "hallCashBalance": +amount, 'otherData.hallCashBalanceAdded': true } }, { new: true });

                let hallTransaction = {
                    transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: null,
                    hallId: hallsData.id,
                    agentId: req.session.details.id,
                    type: "Add Hall Cash",
                    category: "credit",
                    amount: amount,
                    previousBalance: +parseFloat(updatedHall.hallCashBalance - (+amount)).toFixed(2),
                    afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                    createdAt: Date.now(),
                }
                await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);

                res.json({ status: "success", message: "Hall's Total Cash Balance updated Successfully." });
            } else {
                return res.json({ status: "fail", message: 'Something went wrong, please try again later.' });
            }
        } catch (e) {
            console.log("Error while adding daily balance :", e);
            return res.json({ status: "fail", message: 'Something went wrong, please try again later.' });
        }
    },

    individualSettlementView: async function (req, res) {
        try {
            let viewFlag = true;
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Hall Account Report'] || [];
                let stringReplace =req.session.details.isPermission['Hall Account Report'] || [];
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
            let keys = [
                "hall_account_report",
                "settlement_report",
                "date",
                "hall",
                "hall_id",
                "hall_name",
                "dashboard",
                "view",
                "settlement_report",
                "from_date",
                "to_date",
                "start_date",
                "end_date",
                "game_type",
                "real",
                "bot",
                "action",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "both_date_required",
                "edit_settlement",
                "download_bills",
                "agent_name",
                "title",
                "in",
                "out",
                "sum",
                "upload"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                hallId: req.params.id,
                error: req.flash("error"),
                success: req.flash("success"),
                settlementReportActive: 'active',
                editFlag: editFlag,
                viewFlag: viewFlag,
                role: req.session.details.role,
                hallReport: translate,
                navigation: translate
            };
            return res.render('hallAccountReport/settlement', data);

        } catch (e) {
            console.log("Error in hallAccountReportView", e);
            return new Error(e);
        }
    },

    getIndividualSettlement: async function (req, res) {
        try {
            console.log("getIndividualSettlement---")
            let order = req.query.order;
            let sort = { createdAt: -1 };
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1
                }
            }
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let fromDate = req.query.start_date;
            let toDate = req.query.end_date;

            if (fromDate) {
                let startOfToday = new Date(fromDate);
                fromDate = startOfToday.setHours(0, 0, 0, 0)
            }
            if (toDate) {
                let endDate = new Date(toDate);
                toDate = endDate.setHours(23, 59, 59, 999)
            }

            let query = {
                hallId: mongoose.Types.ObjectId(req.query.hall),
                date: { $gte: new Date(fromDate), $lte: new Date(toDate) }
            }

            if (req.session.login && req.session.details.role == 'agent') {
                query.agentId = req.session.details.id;
            }

            let reqCount = 0;
            let data = [];
            if (req.query.allData == true) {
                reqCount = await Sys.App.Services.AgentServices.getSettlementCount(query);
                data = await Sys.App.Services.AgentServices.getSettlementByData(query, {}, { sort: sort });
            } else {
                reqCount = await Sys.App.Services.AgentServices.getSettlementCount(query);
                data = await Sys.App.Services.AgentServices.getSettlementByData(query, {}, { sort: sort, limit: length, skip: start });
            }


            // let individualSettlement = [];
            // if(data && data.length > 0){
            //     for(let s=0; s < data.length; d++){
            //         let allGameProfit = 0;
            //         if(data[s].otherData?.individualSettlementProfits?.allGameProfit){
            //             allGameProfit = data[s].otherData?.individualSettlementProfits?.allGameProfit;
            //         }
            //         individualSettlement.push({
            //             date: data[s].date,
            //             day: data[s].day,
            //             allGameProfit: allGameProfit,
            //             totalAmountMetronia: data[s].totalAmountMetronia,
            //             totalAmountOkBingo: data[s].totalAmountOkBingo,
            //             totalAmountFranco: data[s].totalAmountFranco,
            //             totalAmountOtium: data[s].totalAmountOtium,
            //             totalAmountNorskTotalt: data[s].totalAmountNorskTotalt,
            //             totalAmountNorskRikstotoTotalt: data[s].totalAmountNorskRikstotoTotalt,
            //             totalAmountRekvisita: data[s].totalAmountRekvisita,
            //             totalAmountSellProduct: data[s].totalAmountSellProduct,
            //             totalAmountBilag: data[s].totalAmountBilag,
            //             totalAmountTransferredByBank: data[s].totalAmountTransferredByBank,
            //             totalAmountBank: data[s].totalAmountBank,
            //             totalAmountAnnet: data[s].totalAmountAnnet
            //         });
            //     }
            // }

            data.forEach(item => {
                item.allGameProfit = item.otherData?.individualSettlementProfits?.allGameProfit || 0;
            });
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            return res.send(obj);
        } catch (e) {
            console.log("Error in getIndividualSettlement", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            })
        }
    },

    // Check hall number validity
    checkHallNumber: async function (req, res) {
        try {
            let hallNumber = req.body.hallNumber;
            let hallId = req.body.hallId || '';
            
            if (!hallNumber) {
                return res.send({ valid: false, message: 'Hall number is required' });
            }

            let query = { number: hallNumber };
            if (hallId) {
                query._id = { $ne: hallId };
            }

            let existingHall = await Sys.App.Services.HallServices.getSingleHallByData(query, {name: 1});
            
            return res.send({ 
                valid: !existingHall,
                message: existingHall ? 'Hall number already taken' : 'Hall number is available'
            });
        } catch (e) {
            console.log("Error in checkHallNumber:", e);
            return res.send({ valid: false, message: 'Error checking hall number' });
        }
    },

    // Check IP address validity
    checkIpAddress: async function (req, res) {
        try {
            let ip = req.body.ip;
            let hallId = req.body.hallId || '';
            
            if (!ip) {
                return res.send({ valid: false, message: 'IP address is required' });
            }

            let query = { ip: ip };
            if (hallId) {
                query._id = { $ne: hallId };
            }

            let existingHall = await Sys.App.Services.HallServices.getSingleHallByData(query, {name: 1});
            
            return res.send({ 
                valid: !existingHall,
                message: existingHall ? 'IP address already taken' : 'IP address is available'
            });
        } catch (e) {
            console.log("Error in checkIpAddress:", e);
            return res.send({ valid: false, message: 'Error checking IP address' });
        }
    },

    updatePlayerAgentHallName: async function (hallId, newHallName, groupHallId) {
        try {
            const hallIdString = hallId.toString();
            const groupHallIdString = groupHallId ? groupHallId.toString() : null;
            
            // UPDATE PLAYERS
            await Sys.App.Services.PlayerServices.updateManyPlayers(
                { $or: [{ "hall.id": hallId }, { "approvedHalls.id": hallId }] },
                {
                    $set: {
                        "hall.name": newHallName,
                        "approvedHalls.$[elem].name": newHallName
                    }
                },
                {
                    arrayFilters: [{ "elem.id": hallId }]
                }
            );

            // UPDATE AGENTS
            await Sys.App.Services.AgentServices.updateManyAgents(
                { "hall.id": hallId },
                {
                    $set: {
                        "hall.$[elem].name": newHallName
                    }
                },
                {
                    arrayFilters: [{ "elem.id": hallId }]
                }
            );

            // UPDATE GAME 
            if (groupHallIdString) {
                await Sys.App.Services.GameService.updateManyGameData(
                    { 
                        "gameType": { $in: ["game_1", "game_2", "game_3"] },
                        "status": { $in: ["active", "running"] },
                        "groupHalls.id": groupHallIdString 
                    },
                    {
                        $set: {
                            "groupHalls.$[group].halls.$[hall].name": newHallName
                        }
                    },
                    {
                        arrayFilters: [
                            { "group.id": groupHallIdString },
                            { "hall.id": hallIdString }
                        ]
                    }
                );

                // Update selectedHalls only for game_1
                await Sys.App.Services.GameService.updateManyGameData(
                    { 
                        "gameType": "game_1",
                        "status": { $in: ["active", "running"] },
                        "groupHalls.id": groupHallIdString 
                    },
                    {
                        $set: {
                            "groupHalls.$[group].selectedHalls.$[sel].name": newHallName
                        }
                    },
                    {
                        arrayFilters: [
                            { "group.id": groupHallIdString },
                            { "sel.id": hallIdString }
                        ]
                    }
                );

                // await Sys.App.Services.GameService.updateManyGameData(
                //     { 
                //         "gameType": { $in: ["game_1", "game_2", "game_3"] },
                //         "status": { $in: ["active", "running"] },
                //         "groupHalls.id": groupHallIdString 
                //     },
                //     {
                //         $set: {
                //             // Update halls array inside groupHalls
                //             "groupHalls.$[group].halls.$[hall].name": newHallName,
    
                //             // Update selectedHalls array inside groupHalls
                //             "groupHalls.$[group].selectedHalls.$[sel].name": newHallName
                //         }
                //     },
                //     {
                //         arrayFilters: [
                //             { "group.id": groupHallIdString },   // group filter
                //             { "hall.id": hallIdString },         // hall inside halls[]
                //             { "sel.id": hallIdString }           // hall inside selectedHalls[]
                //         ]
                //     }
                // );
            }

            // UPDATE PARENT GAME
            if (groupHallIdString) {
                await Sys.App.Services.GameService.updateManyParentGameData(
                    {
                        "status": { $in: ["active", "running"] },
                        "groupHalls.id": groupHallIdString 
                    },
                    {
                        $set: {
                            // Update halls array inside groupHalls
                            "groupHalls.$[group].halls.$[hall].name": newHallName
                        }
                    },
                    {
                        arrayFilters: [
                            { "group.id": groupHallIdString },   // group filter
                            { "hall.id": hallIdString },         // hall inside halls[]
                        ]
                    }
                );
            }

            // Get All Online User and Send playerApprovedHalls broadcast
            const connectedPlayers = Sys.ConnectedPlayers || {};
            const onlinePlayerIds = Object.keys(connectedPlayers).filter(
                pid => connectedPlayers[pid]?.status === "Online" && connectedPlayers[pid]?.socketId
            );

            if (onlinePlayerIds.length > 0) {
                const playerObjectIds = onlinePlayerIds.map(id => mongoose.Types.ObjectId(id));
              
                const players = await Sys.App.Services.PlayerServices.getAllPlayersData(
                    { _id: { $in: playerObjectIds }, "approvedHalls.id": hallId },
                    { approvedHalls: 1, hall: 1, groupHall: 1, socketId: 1 }
                );

                for (const player of players || []) {
                    try {
                        const playerApprovedHalls = await getAvailableHallLimit({
                            playerId: player._id.toString(),
                            approvedHalls: player.approvedHalls || [],
                            selectedHallId: player?.hall?.id
                        });

                        const socketId =
                            connectedPlayers[player._id.toString()]?.socketId || player.socketId;
                        if (socketId) {
                            await Sys.Io.to(socketId).emit('playerApprovedHalls', {
                                approvedHalls: playerApprovedHalls
                            });
                        }
                    } catch (err) {
                        console.log(`Error broadcasting playerApprovedHalls for player ${player._id}:`, err);
                    }
                }
            }

            // Update Agent dashboard Hall Name
            updateAgentHallNameSession({ hallId: hallIdString, newHallName });

            console.log(`Updated hall name for all players with hall id: ${hallIdString}`);
            return true;
        } catch (e) {
            console.log("PlayerServices Error in updatePlayersHallName", e);
            return new Error(e);
        }
    }
    

}