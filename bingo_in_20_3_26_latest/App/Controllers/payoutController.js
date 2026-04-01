var Sys = require('../../Boot/Sys');
const redisClient = require('../../Config/Redis');
var bcrypt = require('bcryptjs');
const moment = require('moment');
const mongoose = require('mongoose');
var back = require('express-back');

module.exports = {

    //[ Payout for Player ]
    viweGameManagementPayoutPlayer: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Payout Management'] || [];
                let stringReplace =req.session.details.isPermission['Payout Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Payout Management'];

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }
            const keysArray = [
                "payout_management",
                "choose_a_game",
                "ticket_purchase",
                "search_player_name",
                "view_tickets",
                "dashboard",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "submit",
                "action",
                "status",
                "cancel",
                "date",
                "profit",
                "loss",
                
            ]
                  
            let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                payoutPlayer: 'active',
                PayoutMenu: 'active',
                DataOfGames: gameData,
                gameReport: lanTransaltion,
                navigation: lanTransaltion
            };

            if (viewFlag) {
                return res.render('PayoutforPlayers/payoutPlayers', data);
            } else {
                req.flash('error', await Sys.Helper.bingo.getTraslateData(["not_access_that_page"], req.session.details.language));
                return res.redirect('/dashboard');
            }

        } catch (error) {
            Sys.Log.error('Error in viweGameManagementPayout: ', error);
            return new Error(error);
        }
    },

    PayoutGameManagementDetailListPlayer: async function (req, res) {
        try {
            var gameType;
            console.log("Req.params calling", req.params);
            let searchDate = req.query.dateRange;
            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: await Sys.Helper.bingo.getTraslateData(["fail_because_option_not_selected"], req.session.details.language) });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            var theadField;
            if (gameType.type == "game_1") {
                theadField = [
                    'Username',
                    'Sub Game ID',
                    'Game Name',
                    // 'Ticket Numbers',
                    'Total ticket price',
                    'Winnings',
                    'Profit',
                    'Loss',
                    'Action'
                ]

                if(req.session.details.language == "norwegian"){
                    theadField = [
                       'Brukernavn',
                       'Underspill-ID',
                       'Spillnavn',
                       'Total ticket price',
                       'Gevinster',
                       'Fortjeneste',
                       'Tap',
                       'Handling'
                    ];
                }
            } else if (gameType.type == "game_2") {
                theadField = [
                    'Username',
                    'Sub Game ID',
                    'Game Name',
                    // 'Ticket Numbers',
                    'Total ticket price',
                    'Winnings',
                    'Profit',
                    'Loss',
                    'Action'
                ]
                if(req.session.details.language == "norwegian"){
                    theadField = [
                       'Brukernavn',
                       'Underspill-ID',
                       'Spillnavn',
                       'Total ticket price',
                       'Gevinster',
                       'Fortjeneste',
                       'Tap',
                       'Handling'
                    ];
                }

            } else if (gameType.type == "game_3") {
                theadField = [
                    'Username',
                    'Sub Game ID',
                    'Game Name',
                    // 'Ticket Numbers',
                    'Total ticket price',
                    'Winnings',
                    'Profit',
                    'Loss',
                    'Action'
                ]
                if(req.session.details.language == "norwegian"){
                    theadField = [
                       'Brukernavn',
                       'Underspill-ID',
                       'Spillnavn',
                       'Total ticket price',
                       'Gevinster',
                       'Fortjeneste',
                       'Tap',
                       'Handling'
                    ];
                }
            } else if (gameType.type == "game_4") {
                theadField = [
                    'Username',
                    'Game Name',
                    'Total Bet Placed',
                    'Winnings',
                    'Profit',
                    'Loss',
                    'Action'
                ]
                if(req.session.details.language == "norwegian"){
                    theadField = [
                       'Brukernavn',
                       'Spillnavn',
                       'Total innsats plassert',
                       'Gevinster',
                       'Fortjeneste',
                       'Tap',
                       'Handling'
                    ];
                }
            } else if (gameType.type == "game_5") {
                theadField = [
                    'Username',
                    'Game Name',
                    'Total Bet Placed',
                    'Winnings',
                    'Profit',
                    'Loss',
                    'Action'
                ]
                if(req.session.details.language == "norwegian"){
                    theadField = [
                       'Brukernavn',
                       'Spillnavn',
                       'Total innsats plassert',
                       'Gevinster',
                       'Fortjeneste',
                       'Tap',
                       'Handling'
                    ];
                }
            } else {
                req.flash('error', await Sys.Helper.bingo.getTraslateData(["game_not_found"], req.session.details.language));
                return res.redirect('/dashboard');
            }

            if (gameType.type == "game_1") {
                dataQuery = [{
                    $match: {
                        gameType: "game_1"
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerIdOfPurchaser": "$playerIdOfPurchaser",
                            "gameId": "$gameId",
                            "subGame1Id": "$subGame1Id"
                        },
                        playerName: { $last: '$playerNameOfPurchaser' },
                        ticketNumber: { $addToSet: "$ticketId" },
                        totalTicketPrice: {
                            $sum: {
                                $add: [
                                    {
                                        $ifNull: [
                                            {
                                                $cond: [
                                                    { "$eq": ["$ticketColorType", "large"] },
                                                    { "$divide": ["$ticketPrice", 3] },
                                                    "$ticketPrice"
                                                ]
                                            }, 0]
                                    },
                                    { $ifNull: ["$totalReplaceAmount", 0] }
                                ]
                            },
                        },
                        // totalTicketPrice: {
                        //     $sum: {
                        //         $add: [
                        //             { $ifNull: ["$ticketPrice", 0] }, // If sales_amount is missing, use 0
                        //             { $ifNull: ["$totalReplaceAmount", 0] } // If other_sales_amount is missing, use 0
                        //         ]
                        //     },
                        // },
                        //winningPrice: { "$sum": '$winningStats.finalWonAmount' },
                        tchw: { '$first': "$tChestWinners.WinningAmount" },
                        wofw: { '$first': "$wofWinners.WinningAmount" },
                        mystryw: { '$first': "$mystryWinners.WinningAmount" },

                        winningPrice: {
                            "$sum": {
                                $add:
                                    [
                                        { "$ifNull": ["$winningStats.finalWonAmount", 0] },
                                        { "$ifNull": ["$bonusWinningStats.wonAmount", 0] },
                                        { "$ifNull": ["$luckyNumberWinningStats.wonAmount", 0] },
                                        { "$ifNull": ['$tchw', 0] },
                                        { "$ifNull": ['$wofw', 0] },
                                        { "$ifNull": ['$mystryw', 0] }
                                    ]
                            }
                        },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: 'Game1',
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: '$totalTicketPrice',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (gameType.type == "game_2") {
                dataQuery = [{
                    $match: {
                        gameType: "game_2",
                        defineSlug: {
                            "$nin": ["extraTransaction", "loyaty", "leaderboard", "voucher"]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        ticketPrice: {
                            '$first': '$ticketPrice'
                        },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        cancelTicket: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            '$defineSlug', 'cancelTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        // autoTicket: {
                        //     $sum: {
                        //         $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                        //     }
                        // },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        // differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: {
                            $cond: { if: { $eq: ["$gameType", 'game_2'] }, then: '', else: 'Game2' }
                        },
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (gameType.type == "game_3") {
                dataQuery = [{
                    $match: {
                        gameType: "game_3",
                        defineSlug: {
                            "$nin": ["extraTransaction", "loyaty", "leaderboard", "voucher"]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        ticketPrice: {
                            '$first': '$ticketPrice'
                        },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        cancelTicket: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            '$defineSlug', 'cancelTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        // autoTicket: {
                        //     $sum: {
                        //         $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                        //     }
                        // },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        // differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: {
                            $cond: { if: { $eq: ["$gameType", 'game_3'] }, then: '', else: 'Game3' }
                        },
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (gameType.type == "game_4") {
                dataQuery = [{
                    $match: {
                        gameType: "game_4",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: {
                            $cond: { if: { $eq: ["$gameType", 'game_4'] }, then: '', else: 'Game4' }
                        },
                        totalBetPlace: '$differenceAmount',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (gameType.type == "game_5") {
                dataQuery = [
                    {
                        $match: {
                            'otherData.isBotGame': false
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalProfit: {
                                $sum: {
                                    $cond: [
                                        { $gt: ["$finalGameProfitAmount", 0] },
                                        "$finalGameProfitAmount",
                                        0
                                    ]
                                }
                            },
                            totalLoss: {
                                $sum: {
                                    $cond: [
                                        { $lt: ["$finalGameProfitAmount", 0] },
                                        "$finalGameProfitAmount",
                                        0
                                    ]
                                }
                            }
                        }
                    },
                    {

                        $project: {
                            _id: 0,
                            totalProfit: 1,
                            totalLoss: 1
                        }

                    },
                ];
            }

            // let startOfToday = new Date();
            // let endDate = new Date();
            // if (searchDate) {
            //     if (searchDate == "Today") {
            //         startOfToday.setHours(0, 0, 0, 0);
            //         endDate.setHours(23, 59, 59, 999);
            //         dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }
            //     }

            //     if (searchDate == "Yesterday") {
            //         startOfToday.setDate(startOfToday.getDate() - 1);
            //         startOfToday.setHours(0, 0, 0, 0);

            //         endDate.setDate(endDate.getDate() - 1);
            //         endDate.setHours(23, 59, 59, 999);

            //         dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }

            //     }

            //     if (searchDate == "Weekly") {

            //         startOfToday.setDate(startOfToday.getDate() - 7);
            //         startOfToday.setHours(0, 0, 0, 0);

            //         endDate.setHours(23, 59, 59, 999);

            //         dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }

            //     }

            //     if (searchDate == "Monthly") {

            //         startOfToday.setDate(startOfToday.getDate() - 30);
            //         startOfToday.setHours(0, 0, 0, 0);

            //         endDate.setHours(23, 59, 59, 999);

            //         dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }

            //     }
            // }

            let gameData = [];
            if (gameType.type == "game_1") {
                Sys.Log.info('start query : ');
                console.log(JSON.stringify(dataQuery));
                gameData = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
                console.log("gamedata first in player payout----", gameData.length)
                Sys.Log.info('end query : ');
            } else {
                if (gameType.type == "game_5") {
                    if (req.session.details.role == "agent") {
                        dataQuery[0][`$match`][`halls`] = { "$elemMatch": { "id": req.session.details.hall[0].id } };
                    }
                    gameData = await Sys.Game.Game5.Services.GameServices.aggregateSubgameQuery(dataQuery);
                } else {
                    gameData = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
                }
            }

            let profit = 0;
            let loss = 0;
            if (gameType.type == "game_1") {
                for (let i = 0; i < gameData.length; i++) {
                    profit = (gameData[i].totalTicketPrice > gameData[i].totalWinning) ? Number(gameData[i].totalTicketPrice) - Number(gameData[i].totalWinning) + profit : profit;
                    loss = (gameData[i].totalTicketPrice < gameData[i].totalWinning) ? Number(gameData[i].totalWinning) - Number(gameData[i].totalTicketPrice) + loss : loss;
                }
            } else if (gameType.type == "game_2") {
                for (let i = 0; i < gameData.length; i++) {
                    profit = (gameData[i].totalTicketPrice > gameData[i].totalWinning) ? Number(gameData[i].totalTicketPrice) - Number(gameData[i].totalWinning) + profit : profit;
                    loss = (gameData[i].totalTicketPrice < gameData[i].totalWinning) ? Number(gameData[i].totalWinning) - Number(gameData[i].totalTicketPrice) + loss : loss;
                }
            } else if (gameType.type == "game_3") {
                for (let i = 0; i < gameData.length; i++) {
                    profit = (gameData[i].totalTicketPrice > gameData[i].totalWinning) ? Number(gameData[i].totalTicketPrice) - Number(gameData[i].totalWinning) + profit : profit;
                    loss = (gameData[i].totalTicketPrice < gameData[i].totalWinning) ? Number(gameData[i].totalWinning) - Number(gameData[i].totalTicketPrice) + loss : loss;
                }
            } else if (gameType.type == "game_4") {
                for (let i = 0; i < gameData.length; i++) {
                    profit = (gameData[i].totalBetPlace > gameData[i].totalWinning) ? Number(gameData[i].totalBetPlace) - Number(gameData[i].totalWinning) + profit : profit;
                    loss = (gameData[i].totalBetPlace < gameData[i].totalWinning) ? Number(gameData[i].totalWinning) - Number(gameData[i].totalBetPlace) + loss : loss;
                }
            } else if (gameType.type == "game_5") {
                if (gameData.length > 0) {
                    profit = gameData[0].totalProfit;
                    loss = gameData[0].totalLoss;
                }
            }


            var data = {
                gameData: gameType,
                theadField: theadField,
                profit: profit,
                loss: loss
            };
            res.send(data);

        } catch (error) {
            Sys.Log.error('Error in PayoutGameManagementDetailListPlayer: ', error);
            return new Error(error);
        }
    },

    payoutPlayerGetGameManagementDetailList: async function (req, res) {
        try {

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
            let searchDate = req.query.columns[2].search.value; //req.query.dateRange;
            let dataQuery = [];
            let tmp11 = [];

            console.log(" searchDate :", searchDate)

            var startOfToday = new Date();
            var endDate = new Date();

            if (searchDate) {
                if (searchDate == "Today") {

                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setHours(23, 59, 59, 999);
                    tmp11 = [{
                        $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    }];


                }


                if (searchDate == "Yesterday") {

                    startOfToday.setDate(startOfToday.getDate() - 1);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setDate(endDate.getDate() - 1);
                    endDate.setHours(23, 59, 59, 999);

                    tmp11 = [{
                        $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    }];
                }

                if (searchDate == "Weekly") {

                    startOfToday.setDate(startOfToday.getDate() - 7);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setHours(23, 59, 59, 999);
                    tmp11 = [{
                        $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    }];


                }

                if (searchDate == "Monthly") {

                    startOfToday.setDate(startOfToday.getDate() - 30);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setHours(23, 59, 59, 999);
                    tmp11 = [{
                        $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    }];


                }
            } else {
                startOfToday.setHours(0, 0, 0, 0);

                endDate.setHours(23, 59, 59, 999);
                // tmp11 = [{
                //     $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                // }];
            }

            console.log(" startOfToday startOfToday : " + startOfToday + " ::endDate endDate :  " + endDate)


            if (req.query.gameType == "game_1") {
                dataQuery = [{
                    $match: {
                        gameType: "game_1"
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerIdOfPurchaser": "$playerIdOfPurchaser",
                            "gameId": "$gameId",
                            "subGame1Id": "$subGame1Id"
                        },
                        gameName: { $last: "$gameName" },
                        playerName: { $last: '$playerNameOfPurchaser' },
                        ticketNumber: { $addToSet: "$ticketId" },
                        totalTicketPrice: {
                            $sum: {
                                $add: [
                                    {
                                        $ifNull: [
                                            {
                                                $cond: [
                                                    { "$eq": ["$ticketColorType", "large"] },
                                                    { "$divide": ["$ticketPrice", 3] },
                                                    "$ticketPrice"
                                                ]
                                            }, 0]
                                    },
                                    { $ifNull: ["$totalReplaceAmount", 0] }
                                ]
                            },
                        },
                        // totalTicketPrice: {
                        //     $sum: {
                        //         $add: [
                        //             { $ifNull: ["$ticketPrice", 0] }, // If sales_amount is missing, use 0
                        //             { $ifNull: ["$totalReplaceAmount", 0] } // If other_sales_amount is missing, use 0
                        //         ]
                        //     },
                        // },
                        // winningPrice: { "$sum": '$winningStats.finalWonAmount' },
                        tchw: { '$first': "$tChestWinners.WinningAmount" },
                        wofw: { '$first': "$wofWinners.WinningAmount" },
                        mystryw: { '$first': "$mystryWinners.WinningAmount" },

                        winningPrice: {
                            "$sum": {
                                $add:
                                    [
                                        { "$ifNull": ["$winningStats.finalWonAmount", 0] },
                                        { "$ifNull": ["$bonusWinningStats.wonAmount", 0] },
                                        { "$ifNull": ["$luckyNumberWinningStats.wonAmount", 0] },
                                        { "$ifNull": ['$tchw', 0] },
                                        { "$ifNull": ['$wofw', 0] },
                                        { "$ifNull": ['$mystryw', 0] }
                                    ]
                            }
                        },
                        createdAt: { $last: '$createdAt' },
                        playerNameOfPurchaser: { $last: '$playerNameOfPurchaser' },
                        subGameId: {
                            "$last": "$subGame1Id"
                        }
                    }
                },
                {
                    $addFields: {
                        profit: { $subtract: ["$totalTicketPrice", "$winningPrice"] }
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameType: 'Game1',
                        gameName: '$gameName',
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: '$totalTicketPrice',
                        totalWinning: '$winningPrice',
                        createdAt: '$createdAt',
                        profit: '$profit',
                        playerNameOfPurchaser: '$playerNameOfPurchaser',
                        subGameId: "$subGameId"
                    }
                }
                ];
                // dataQuery = [{
                //         $match: {
                //             gameType: "game_1",
                //         }
                //     },
                //     {
                //         $group: {
                //             _id: {
                //                 "playerId": "$playerId",
                //                 "gameId": "$gameId"
                //             },
                //             playerName: { $last: '$playerName' },
                //             createdAt: { $last: '$createdAt' },
                //             buyTicket: {
                //                 $sum: {
                //                     $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                //                 }
                //             },
                //             autoTicket: {
                //                 $sum: {
                //                     $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                //                 }
                //             },
                //             ticketNumber: { $addToSet: "$ticketNumber" },
                //             differenceAmount: { "$sum": '$differenceAmount' },
                //             winningPrice: { "$sum": '$winningPrice' },
                //         }
                //     },
                //     {
                //         $project: {
                //             playerName: '$playerName',
                //             gameName: {
                //                 $cond: { if: { $eq: ["$gameType", 'game_1'] }, then: '', else: 'Game1' }
                //             },
                //             createdAt: '$createdAt',
                //             ticketNumber: '$ticketNumber',
                //             totalTicketPrice: '$differenceAmount',
                //             totalWinning: '$winningPrice',
                //         }
                //     }
                // ];
            } else if (req.query.gameType == "game_2") {


                dataQuery = [{
                    $match: {
                        gameType: "game_2",
                        defineSlug: {
                            "$nin": ["extraTransaction", "loyaty", "leaderboard", "voucher"]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        gameName: { $last: { $ifNull: ["$gameName", "Game2"] } },
                        createdAt: { $last: '$createdAt' },
                        ticketPrice: {
                            '$first': '$ticketPrice'
                        },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        cancelTicket: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            '$defineSlug', 'cancelTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        // autoTicket: {
                        //     $sum: {
                        //         $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                        //     }
                        // },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        // differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: '$gameName',
                        createdAt: '$createdAt',
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (req.query.gameType == "game_3") {
                dataQuery = [{
                    $match: {
                        gameType: "game_3",
                        defineSlug: {
                            "$nin": ["extraTransaction", "loyaty", "leaderboard", "voucher"]
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        gameName: { $last: { $ifNull: ["$gameName", "Game3"] } },
                        createdAt: { $last: '$createdAt' },
                        ticketPrice: {
                            '$first': '$ticketPrice'
                        },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        cancelTicket: {
                            $sum: {
                                $cond: [
                                    {
                                        $eq: [
                                            '$defineSlug', 'cancelTicket'
                                        ]
                                    }, 1, 0
                                ]
                            }
                        },
                        // autoTicket: {
                        //     $sum: {
                        //         $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                        //     }
                        // },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        // differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        createdAt: '$createdAt',
                        gameName: '$gameName',
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: {
                            '$multiply': [
                                '$ticketPrice', {
                                    '$subtract': [
                                        '$buyTicket', '$cancelTicket'
                                    ]
                                }
                            ]
                        },
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (req.query.gameType == "game_4") {
                dataQuery = [{
                    $match: {
                        gameType: "game_4",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        createdAt: { $last: '$createdAt' },
                        playerName: { $last: '$playerName' },
                        differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        createdAt: '$createdAt',
                        gameName: {
                            $cond: { if: { $eq: ["$gameType", 'game_4'] }, then: '', else: 'Game4' }
                        },
                        totalBetPlace: '$differenceAmount',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            }

            console.log(" temppppppppppppppppppppppppp : ", tmp11)

            if (tmp11.length > 0) {
                dataQuery = dataQuery.concat(tmp11);
            }
            if (req.query.gameType != "game_5" && req.session.details.role == "agent") {
                dataQuery[0][`$match`][`hallId`] = req.session.details.hall[0].id;
            }
            if (req.query.gameType == "game_1") {

                console.log(" server payout data : ", JSON.stringify(dataQuery))

                let dataCntt = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
                console.log(" dataCntt dataCntt dataCntt : ", dataCntt.length)
                if (sort.loss) {
                    if (sort.loss == 1) {
                        sort.profit = -1;
                    } else {
                        sort.profit = 1;
                    }
                }
                let tmp = [
                    { $sort: sort },
                    { $skip: parseInt(start) },
                    { $limit: start + length },
                    // { $sort: { "gameStartDate": -1, "_id.gameId": -1, "playerName": -1} },
                ];

                if (search) {
                    tmp.push({ $match: { 'playerNameOfPurchaser': { $regex: '.*' + search + '.*' } } });
                }

                dataQuery = dataQuery.concat(tmp);
                //console.log("data query", dataQuery)
                let gameData;
                Sys.Log.info('start query : ');
                gameData = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
                console.log("gameData in player payout second", gameData.length)
                Sys.Log.info('end query : ');
                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': dataCntt.length,
                    'recordsFiltered': dataCntt.length,
                    'data': gameData,
                };
                res.send(obj);
            } else if (req.query.gameType == "game_5") {

                let game5Query = { 'otherData.isBotGame': false, status: "Finished" };
                if (req.session.details.role == "agent") {
                    game5Query.halls = { $elemMatch: { id: req.session.details.hall[0].id } }
                }
                if (searchDate != "" && searchDate != "all") {
                    game5Query.createdAt = { $gte: startOfToday, $lt: endDate };
                }
                // if(searchDate != "all"){
                //     game5Query.createdAt =  { $gte: startOfToday, $lt: endDate };
                // }
                if (search != '') {
                    game5Query['player.username'] = { $regex: '.*' + search + '.*' };
                }
                console.log("game5Query---", game5Query);
                let game5Count = await Sys.Game.Game5.Services.GameServices.getSubgameCount(game5Query);
                let game5Data = await Sys.Game.Game5.Services.GameServices.getSubgameByData(game5Query, { gameNumber: 1, player: 1, earnedFromTickets: 1, totalWinning: 1, finalGameProfitAmount: 1, otherData: 1, createdAt: 1 }, { sort: sort, limit: length, skip: start });

                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': game5Count,
                    'recordsFiltered': game5Count,
                    'data': game5Data,
                };
                res.send(obj);
            } else {

                let dataCntt = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);

                let tmp = [
                    { $limit: start + length },
                    { $skip: parseInt(start) },
                    { $sort: sort },
                ];

                if (search) {
                    tmp.push({ $match: { 'playerName': { $regex: '.*' + search + '.*' } } });
                }

                dataQuery = dataQuery.concat(tmp);
                //console.log("data query game 234", dataQuery)
                let gameData;
                gameData = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);

                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': dataCntt.length,
                    'recordsFiltered': dataCntt.length,
                    'data': gameData,
                };
                res.send(obj);
            }


        } catch (error) {
            Sys.Log.error('Error in payoutGetGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    viewPlayerPayout: async function (req, res) {
        try {
            console.log("viewPlayerPayout", req.params);
            let Game;
            let dataQuery = [];
            let profit, loss;
            if (req.params.type == "game_1") {
                Game = "game_1";
                dataQuery = [{
                    $match: {
                        gameType: "game_1",
                        playerIdOfPurchaser: req.params.id,
                        gameId: req.params.gameId,
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerIdOfPurchaser": "$playerIdOfPurchaser",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerNameOfPurchaser' },
                        ticketNumber: { $addToSet: "$ticketId" },
                        totalTicketPrice: { "$sum": '$ticketPrice' },
                        //winningPrice: { "$sum": '$winningStats.finalWonAmount' },
                        tChestWinnersf: { $first: "$tChestWinners.WinningAmount" },
                        wofWinnersf: { $first: "$wofWinners.WinningAmount" },
                        mystryWinnersf: { $first: "$mystryWinners.WinningAmount" },
                        winningPrice: {
                            "$sum": {
                                $add:
                                    [
                                        { "$ifNull": ["$winningStats.finalWonAmount", 0] },
                                        { "$ifNull": ["$bonusWinningStats.wonAmount", 0] },
                                        { "$ifNull": ["$luckyNumberWinningStats.wonAmount", 0] },
                                        { "$ifNull": ["$tChestWinnersf", 0] },
                                        { "$ifNull": ["$wofWinnersf", 0] },
                                        { "$ifNull": ["$mystryWinnersf", 0] }
                                    ]
                            }
                        },
                        gameName: { $last: '$gameName' },
                        createdAt: { $last: '$createdAt' },

                    }
                },

                {
                    $project: {
                        playerName: '$playerName',
                        gameType: 'Game1',
                        gameName: '$gameName',
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: '$totalTicketPrice',
                        totalWinning: '$winningPrice',
                        createdAt: '$createdAt',
                    }
                }
                ];
            } else if (req.params.type == "game_2") {
                Game = "game_2";
                dataQuery = [{
                    $match: {
                        playerId: req.params.id,
                        gameId: req.params.gameId,
                        gameType: "game_2",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        autoTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                            }
                        },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: "Game2",
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: '$differenceAmount',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (req.params.type == "game_3") {
                Game = "game_3";
                dataQuery = [{
                    $match: {
                        playerId: req.params.id,
                        gameId: req.params.gameId,
                        gameType: "game_3",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        autoTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                            }
                        },
                        ticketNumber: { $addToSet: "$ticketNumber" },
                        differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: "Game3",
                        ticketNumber: '$ticketNumber',
                        totalTicketPrice: '$differenceAmount',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            } else if (req.params.type == "game_4") {
                Game = "game_4";
                dataQuery = [{
                    $match: {
                        playerId: req.params.id,
                        gameId: req.params.gameId,
                        gameType: "game_4",
                    }
                },
                {
                    $group: {
                        _id: {
                            "playerId": "$playerId",
                            "gameId": "$gameId"
                        },
                        playerName: { $last: '$playerName' },
                        differenceAmount: { "$sum": '$differenceAmount' },
                        winningPrice: { "$sum": '$winningPrice' },
                    }
                },
                {
                    $project: {
                        playerName: '$playerName',
                        gameName: "Game4",
                        totalBetPlace: '$differenceAmount',
                        totalWinning: '$winningPrice',
                    }
                }
                ];
            }

            let gameData = [];
            if (req.params.type == "game_1") {
                gameData = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
            } else {
                gameData = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
            }

            console.log(" gameData  totalTicketPrice totalTicketPrice :", gameData)

            if (req.params.type == "game_1") {
                profit = (gameData[0].totalTicketPrice > gameData[0].totalWinning) ? gameData[0].totalTicketPrice - gameData[0].totalWinning : 0;
                loss = (gameData[0].totalTicketPrice < gameData[0].totalWinning) ? gameData[0].totalWinning - gameData[0].totalTicketPrice : 0;
            } else if (req.params.type == "game_2") {
                profit = (gameData[0].totalTicketPrice > gameData[0].totalWinning) ? gameData[0].totalTicketPrice - gameData[0].totalWinning : 0;
                loss = (gameData[0].totalTicketPrice < gameData[0].totalWinning) ? gameData[0].totalWinning - gameData[0].totalTicketPrice : 0;
            } else if (req.params.type == "game_3") {
                profit = (gameData[0].totalTicketPrice > gameData[0].totalWinning) ? gameData[0].totalTicketPrice - gameData[0].totalWinning : 0;
                loss = (gameData[0].totalTicketPrice < gameData[0].totalWinning) ? gameData[0].totalWinning - gameData[0].totalTicketPrice : 0;
            } else if (req.params.type == "game_4") {
                profit = (gameData[0].totalBetPlace > gameData[0].totalWinning) ? gameData[0].totalBetPlace - gameData[0].totalWinning : 0;
                loss = (gameData[0].totalBetPlace < gameData[0].totalWinning) ? gameData[0].totalWinning - gameData[0].totalBetPlace : 0;
            }
            const keysArray = [
                "view_player_payout",
                "username",
                "total_bet_placed",
                "total_ticket_price",
                "winnings",
                "profit",
                "loss",
                "dashboard",
                "cancel",
                "game",
                "hall_name",
                "total_no_ticket_sold"
            ]
                  
            let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                PayoutMenu: 'active',
                payoutPlayer: 'active',
                username: gameData[0].playerName,
                ticketNumber: gameData[0].ticketNumber,
                totalTicketPrice: gameData[0].totalTicketPrice,
                totalBetPlace: gameData[0].totalBetPlace,
                totalWinning: gameData[0].totalWinning,
                Profit: profit,
                Loss: loss,
                Game: Game,
                gameReport: lanTransaltion,
                navigation: lanTransaltion
            };

            return res.render('PayoutforPlayers/viewPayoutPlayers', data);


        } catch (error) {
            Sys.Log.error('Error in viewPlayerPayout: ', error);
            return new Error(error);
        }
    },

    //[ Payout for Ticket ]
    viweGameManagementPayoutTickets: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Payout Management'] || [];
                let stringReplace =req.session.details.isPermission['Payout Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // var stringReplace = req.session.details.isPermission['Payout Management'];

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            var gameType = await Sys.App.Services.GameService.getByDataSortGameType({});
            var gameData = [];
            var dataGame = {};
            for (var i = 0; i < gameType.length; i++) {
                dataGame = {
                    _id: gameType[i]._id,
                    name: gameType[i].name,
                }
                gameData.push(dataGame);
            }
            const keysArray = [
                "payout_ticket_management",
                "choose_a_game",
                "ticket_purchase",
                "search_player_name",
                "search_hall",
                "search_username",
                "view_game",
                "view_tickets",
                "dashboard",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "submit",
                "action",
                "status",
                "cancel",
                "date",
                "profit",
                "loss"
            ]
                  
            let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                payoutTicket: 'active',
                PayoutMenu: 'active',
                DataOfGames: gameData,
                gameReport: lanTransaltion,
                navigation: lanTransaltion
            };

            if (viewFlag) {
                return res.render('PayoutforPlayers/payoutTickets', data);
            } else {
                await Sys.Helper.bingo.getTraslateData(["not_access_that_page"], req.session.details.language)
                return res.redirect('/dashboard');
            }


        } catch (error) {
            Sys.Log.error('Error in viweGameManagementPayoutTickets: ', error);
            return new Error(error);
        }
    },

    PayoutGameManagementDetailListTickets: async function (req, res) {
        try {
            var gameType;
            //console.log("Req.params calling", req.params);

            if (req.params.id === null) {
                return res.send({ 'status': 'fail', message: 'Fail because option is not selected..' });
            } else {
                gameType = await Sys.App.Services.GameService.getByIdGameType({ _id: req.params.id });
            }

            var theadField;
            if (gameType.type == "game_1") {
                theadField = [
                    'Sub Game Id',
                    'Group of Hall',
                    'Hall name',
                    'Total paper ticket sold in hall',
                    'Total digital ticket sold in hall'
                    // 'Action'
                ]
            } else if (gameType.type == "game_2") {
                theadField = [
                    'Sub Game Id',
                    'Group of Hall',
                    'Hall name',
                    'Total digital ticket sold online'
                ]

            } else if (gameType.type == "game_3") {
                theadField = [
                    'Sub Game Id',
                    'Group of Hall',
                    'Hall name',
                    'Total digital ticket sold online'
                ]
            } else if (gameType.type == "game_4") {
                theadField = [
                    'Game name',
                    'Total digital ticket sold online',
                    'Action'
                ]
            } else if (gameType.type == "game_5") {
                theadField = [
                    'Game Number',
                    'User Name',
                    'Group of Hall',
                    'Hall name',
                    'Total digital ticket sold online'
                ]
            } else {
                req.flash('error', 'Game Not Found');
                return res.redirect('/dashboard');
            }

            var data = {
                gameData: gameType,
                theadField: theadField,
            };
            return res.send(data);

        } catch (error) {
            Sys.Log.error('Error in PayoutGameManagementDetailListTickets: ', error);
            return new Error(error);
        }
    },

    payoutTicketsGetGameManagementDetailList: async function (req, res) {
        try {

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
            let searchDate = req.query.columns[2].search.value;
            let dataQuery = [];
            let tmp11 = [];
            console.log("searchDate :", req.query.columns[3], searchDate)

            let startOfToday = new Date();
            let endDate = new Date();

            if (req.query.gameType == "game_1") {
                dataQuery = [
                    {
                        '$match': {
                            'gameType': 'game_1'
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$hallId',
                                'groupHallId': '$groupHallId',
                                'gameId': '$gameId'
                            },
                            'hallName': {
                                '$last': '$hallName'
                            },
                            'groupHallName': {
                                '$last': '$groupHallName'
                            },
                            'createdAt': {
                                '$last': '$createdAt'
                            },
                            'physicalTickets': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$eq': [
                                                '$isPhysicalTicket', true
                                            ]
                                        }, 1, 0
                                    ]
                                }
                            },
                            'digitalTickets': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$eq': [
                                                '$isPhysicalTicket', true
                                            ]
                                        }, 0, 1
                                    ]
                                }
                            }
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'hallObjId': {
                                    '$toObjectId': '$_id.hallId'
                                }
                            },
                            'from': 'hall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$hallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'hallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$hallData'
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'groupHallObjId': {
                                    '$toObjectId': '$_id.groupHallId'
                                }
                            },
                            'from': 'groupHall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$groupHallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'groupHallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$groupHallData'
                        }
                    }, {
                        '$project': {
                            'SubGameId': '$_id.gameId',
                            'hallName': '$hallData.name',
                            'groupHallName': '$groupHallData.name',
                            'totalPhysical': '$physicalTickets',
                            'totalDigital': '$digitalTickets',
                            'createdAt': '$createdAt'
                        }
                    }
                ];
            } else if (req.query.gameType == "game_2") {
                // dataQuery = [{
                //         $match: {
                //             gameType: "game_2",
                //         }
                //     },
                //     {
                //         $group: {
                //             _id: '$gameId',
                //             createdAt: { $last: '$createdAt' },
                //             buyTicket: {
                //                 $sum: {
                //                     $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                //                 }
                //             },
                //             autoTicket: {
                //                 $sum: {
                //                     $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                //                 }
                //             },
                //         }
                //     },
                //     {
                //         $project: {
                //             Game: {
                //                 $cond: { if: { $eq: ["$gameType", 'game_2'] }, then: '', else: 'Game2' }
                //             },
                //             createdAt: '$createdAt',
                //             totalNumberOfTicketSold: { $add: ['$buyTicket', '$autoTicket'] },
                //         }
                //     }
                // ];
                dataQuery = [
                    {
                        '$match': {
                            'gameType': 'game_2',
                            'isPurchased': true
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$hallId',
                                'groupHallId': '$groupHallId',
                                'subGameId': '$gameId'
                            },
                            'hallName': {
                                '$last': '$hallName'
                            },
                            'groupHallName': {
                                '$last': '$groupHallName'
                            },
                            'createdAt': {
                                '$last': '$createdAt'
                            },
                            'totalTickets': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$eq': [
                                                '$isPurchased', true
                                            ]
                                        }, 1, 0
                                    ]
                                }
                            }
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'hallObjId': {
                                    '$toObjectId': '$_id.hallId'
                                }
                            },
                            'from': 'hall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$hallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'hallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$hallData'
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'groupHallObjId': {
                                    '$toObjectId': '$_id.groupHallId'
                                }
                            },
                            'from': 'groupHall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$groupHallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'groupHallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$groupHallData'
                        }
                    }, {
                        '$project': {
                            'SubGameId': '$_id.subGameId',
                            'hallName': '$hallData.name',
                            'groupHallName': '$groupHallData.name',
                            'totalTickets': '$totalTickets',
                            'createdAt': '$createdAt'
                        }
                    }
                ];
            } else if (req.query.gameType == "game_3") {
                // dataQuery = [{
                //         $match: {
                //             gameType: "game_3",
                //         }
                //     },
                //     {
                //         $group: {
                //             _id: '$gameId',
                //             createdAt: { $last: '$createdAt' },
                //             buyTicket: {
                //                 $sum: {
                //                     $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                //                 }
                //             },
                //         }
                //     },
                //     {
                //         $project: {
                //             Game: {
                //                 $cond: { if: { $eq: ["$gameType", 'game_3'] }, then: '', else: 'Game3' }
                //             },
                //             createdAt: '$createdAt',
                //             totalNumberOfTicketSold: '$buyTicket',
                //         }
                //     }
                // ];
                dataQuery = [
                    {
                        '$match': {
                            'gameType': 'game_3',
                            'isPurchased': true
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$hallId',
                                'groupHallId': '$groupHallId',
                                'subGameId': '$gameId'
                            },
                            'hallName': {
                                '$last': '$hallName'
                            },
                            'groupHallName': {
                                '$last': '$groupHallName'
                            },
                            'createdAt': {
                                '$last': '$createdAt'
                            },
                            'totalTickets': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$eq': [
                                                '$isPurchased', true
                                            ]
                                        }, 1, 0
                                    ]
                                }
                            }
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'hallObjId': {
                                    '$toObjectId': '$_id.hallId'
                                }
                            },
                            'from': 'hall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$hallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'hallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$hallData'
                        }
                    }, {
                        '$lookup': {
                            'let': {
                                'groupHallObjId': {
                                    '$toObjectId': '$_id.groupHallId'
                                }
                            },
                            'from': 'groupHall',
                            'pipeline': [
                                {
                                    '$match': {
                                        '$expr': {
                                            '$eq': [
                                                '$_id', '$$groupHallObjId'
                                            ]
                                        }
                                    }
                                }, {
                                    '$project': {
                                        'name': 1
                                    }
                                }
                            ],
                            'as': 'groupHallData'
                        }
                    }, {
                        '$unwind': {
                            'path': '$groupHallData'
                        }
                    }, {
                        '$project': {
                            'SubGameId': '$_id.subGameId',
                            'hallName': '$hallName',
                            'hallName': '$hallData.name',
                            'groupHallName': '$groupHallData.name',
                            'totalTickets': '$totalTickets',
                            'createdAt': '$createdAt'
                        }
                    }
                ];
            } else if (req.query.gameType == "game_4") {
                dataQuery = [{
                    $match: {
                        gameType: "game_4",
                    }
                },
                {
                    $group: {
                        _id: '$gameId',
                        createdAt: { $last: '$createdAt' },
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                    }
                },
                {
                    $project: {
                        Game: {
                            $cond: { if: { $eq: ["$gameType", 'game_4'] }, then: '', else: 'Game4' }
                        },
                        createdAt: '$createdAt',
                        totalNumberOfTicketSold: '$buyTicket',
                    }
                }
                ];
            }
            if (searchDate) {
                if (searchDate == "Today") {

                    startOfToday.setHours(0, 0, 0, 0);
                    endDate.setHours(23, 59, 59, 999);
                    // tmp11 = [{
                    //     $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    // }];
                    if (req.query.gameType != "game_5") {
                        dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }
                    }
                }

                if (searchDate == "Yesterday") {

                    startOfToday.setDate(startOfToday.getDate() - 1);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setDate(endDate.getDate() - 1);
                    endDate.setHours(23, 59, 59, 999);
                    // tmp11 = [{
                    //     $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    // }];
                    if (req.query.gameType != "game_5") {
                        dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }
                    }

                }

                if (searchDate == "Weekly") {


                    startOfToday.setDate(startOfToday.getDate() - 7);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setHours(23, 59, 59, 999);
                    // tmp11 = [{
                    //     $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    // }];
                    if (req.query.gameType != "game_5") {
                        dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }
                    }
                }

                if (searchDate == "Monthly") {

                    startOfToday.setDate(startOfToday.getDate() - 30);
                    startOfToday.setHours(0, 0, 0, 0);

                    endDate.setHours(23, 59, 59, 999);
                    // tmp11 = [{
                    //     $match: { "createdAt": { $gte: startOfToday, $lt: endDate } }
                    // }];
                    if (req.query.gameType != "game_5") {
                        dataQuery[0]["$match"]['createdAt'] = { $gte: startOfToday, $lt: endDate }
                    }
                }
            }
            if (req.query.gameType == "game_1" || req.query.gameType == "game_2" || req.query.gameType == "game_3") {
                if (req.session.details.role == "agent") {
                    dataQuery[0][`$match`][`hallId`] = req.session.details.hall[0].id;
                }

                if (search) {
                    dataQuery.push({ $match: { 'hallName': { $regex: '.*' + search + '.*' } } });
                }

                let dataCntt = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);

                let tmp = [
                    { $sort: sort },
                    { $skip: parseInt(start) },
                    { $limit: parseInt(length) },
                  ];

                dataQuery = dataQuery.concat(tmp);
                
                console.log("final query", JSON.stringify(dataQuery));
                let gameData;

                gameData = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
                console.log("gameData", gameData.length, dataCntt.length);
                var obj = {
                    'draw': req.query.draw,
                    'recordsTotal': dataCntt.length,
                    'recordsFiltered': dataCntt.length,
                    'data': gameData,
                };
                res.send(obj);
            } else if (req.query.gameType == "game_5") {
                let game5Query = { 'otherData.isBotGame': false, status: "Finished" };
                if (req.session.details.role == "agent") {
                    game5Query.halls = { $elemMatch: { id: req.session.details.hall[0].id } }
                }
                if (searchDate != "" && searchDate != "all") {
                    game5Query.createdAt = { $gte: startOfToday, $lt: endDate };
                }
                if (search != '') {
                    game5Query['player.username'] = { $regex: '.*' + search + '.*' };
                }
                console.log("game5Query---", game5Query);
                let game5Count = await Sys.Game.Game5.Services.GameServices.getSubgameCount(game5Query);
                let game5Data = await Sys.Game.Game5.Services.GameServices.getSubgameByData(game5Query, { gameNumber: 1, player: 1, otherData: 1, groupHalls: 1, halls: 1, createdAt: 1 }, { sort: sort, limit: length, skip: start });

                let obj = {
                    'draw': req.query.draw,
                    'recordsTotal': game5Count,
                    'recordsFiltered': game5Count,
                    'data': game5Data,
                };
                res.send(obj);
            } else {
                let dataCntt = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);

                let tmp = [
                    { $limit: start + length },
                    { $skip: parseInt(start) },
                    { $sort: sort },
                ];

                // if (search) {
                //     tmp.push({ $match: { 'playerName': { $regex: '.*' + search + '.*' } } });
                // }

                dataQuery = dataQuery.concat(tmp);

                let gameData;

                gameData = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);

                var obj = {
                    'draw': req.query.draw,
                    'recordsTotal': dataCntt.length,
                    'recordsFiltered': dataCntt.length,
                    'data': gameData,
                };
                res.send(obj);
            }


        } catch (error) {
            Sys.Log.error('Error in payoutTicketsGetGameManagementDetailList: ', error);
            return new Error(error);
        }
    },

    viewTicketPayout: async function (req, res) {
        try {
            console.log("viewTicketPayout", req.params);
            let Game;
            let dataQuery = [];
            if (req.params.type == "game_1") {
                Game = "game_1";
                dataQuery = [{
                    $match: {
                        hallName: req.params.gameId,
                        gameType: "game_1",
                    }
                },
                {
                    $group: {
                        _id: '$hallName',
                        count: { $sum: 1 },
                    }
                },
                {
                    $project: {
                        Game: 'Game1',
                        hallName: '$_id',
                        totalNumberOfTicketSold: '$count',
                    }
                }
                ];
            } else if (req.params.type == "game_2") {
                Game = "game_2";
                dataQuery = [{
                    $match: {

                        gameId: req.params.gameId,
                        gameType: "game_2",
                    }
                },
                {
                    $group: {
                        _id: '$gameId',
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                        autoTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'autoTicket'] }, 1, 0]
                            }
                        },
                    }
                },
                {
                    $project: {
                        Game: "Game2",
                        totalNumberOfTicketSold: { $add: ['$buyTicket', '$autoTicket'] },
                    }
                }
                ];
            } else if (req.params.type == "game_3") {
                Game = "game_3";
                dataQuery = [{
                    $match: {

                        gameId: req.params.gameId,
                        gameType: "game_3",
                    }
                },
                {
                    $group: {
                        _id: '$gameId',
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                    }
                },
                {
                    $project: {
                        Game: "Game3",
                        totalNumberOfTicketSold: '$buyTicket',
                    }
                }
                ];
            } else if (req.params.type == "game_4") {
                Game = "game_4";
                dataQuery = [{
                    $match: {

                        gameId: req.params.gameId,
                        gameType: "game_4",
                    }
                },
                {
                    $group: {
                        _id: '$gameId',
                        buyTicket: {
                            $sum: {
                                $cond: [{ $eq: ['$defineSlug', 'buyTicket'] }, 1, 0]
                            }
                        },
                    }
                },
                {
                    $project: {
                        Game: "Game4",
                        totalNumberOfTicketSold: '$buyTicket',
                    }
                }
                ];
            }

            let gameData = [];
            if (req.params.type == "game_1") {
                gameData = await Sys.App.Services.GameService.aggregateQueryTickets(dataQuery);
            } else {
                gameData = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(dataQuery);
            }
            console.log("gamedata", gameData)

            const keysArray = [
                "view_ticket_payout",
                "dashboard",
                "cancel",
                "game",
                "hall_name",
                "total_no_ticket_sold"
            ]
                  
            let lanTransaltion = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                payoutTicket: 'active',
                PayoutMenu: 'active',
                GameName: gameData[0].Game,
                hallName: gameData[0].hallName,
                totalNumberOfTicketSold: gameData[0].totalNumberOfTicketSold,
                Game: Game,
                gameReport: lanTransaltion,
                navigation: lanTransaltion
            };

            return res.render('PayoutforPlayers/viewPayoutTickets', data);


        } catch (error) {
            Sys.Log.error('Error in viewPayoutTickets: ', error);
            return new Error(error);
        }
    },

}