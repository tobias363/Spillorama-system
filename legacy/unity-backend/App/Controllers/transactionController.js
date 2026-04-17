var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
var moment = require('moment-timezone');
module.exports = {
    depositTransaction: async function (req, res) {
        try {

            let viewFlag = true;
            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Transactions Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                TransactionActive: 'active',
            };

            if (viewFlag == true) {
                return res.render('TransactionManagement/depositTransaction', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositTransaction", e);
            return new Error(e);
        }
    },

    getDepositTransaction: async function (req, res) {
        try {

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

            let query = {};
            if (search != '') {
                query = { playerName: { $regex: '.*' + search + '.*' } };
            }
            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }
            let reqCount = await Sys.App.Services.transactionServices.getCountDeposit(query);

            let data = await Sys.App.Services.transactionServices.getDatatableDeposit(query, length, start, sort);


            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getDepositTransaction", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    playerTransactions: async function (req, res) {
        try {

            let viewFlag = true;
            if (req.session.details.role == 'agent') {
                let stringReplace = req.session.details.isPermission['Players Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            const keysArray = [
                "transaction_history",
                "order_number",
                "tranaction_id",
                "date_time",
                "tranaction_type",
                "amount",
                "status",
                "reset",
                "search",
                "to_date",
                "from_date",
                "pending",
                "success",
                "fail",
                "all",
                "show",
                "entries"
            ];


            let transaction = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                PlayersManagement: 'active',
                playerId: req.params.id,
                transaction: transaction,
                navigation: transaction
            };

            if (viewFlag == true) {
                return res.render('player/ApprovedPlayers/playerTransactions', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositTransaction", e);
            return new Error(e);
        }
    },

    getPlayerTransactions: async function (req, res) {
        try {
            console.log('req.query', req.query);
            console.log('req.query.startdate', req.query.startdate);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            } else {
                sort = {
                    _id: -1
                }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;
            let isDate = false;
            let createdAt = {};
            if (req.query.startdate != '' && req.query.enddate != '') {
                /* let startdate = moment(req.query.startdate);
                let enddate = moment(req.query.enddate);
                let startDate =
                    startdate === undefined
                    ? moment(
                        new Date(nowdate.getFullYear(), nowdate.getMonth(), 1)
                        ).format("YYYY-MM-DD")
                    : startdate;
                let endDate =
                    enddate === undefined ? moment().format("YYYY-MM-DD") : enddate;
                if (endDate < startDate) {
                    request.flash("error", "Please Select Proper Date Range");
                }
                const fromDate = new Date(startDate);
                const toDate = new Date(endDate); */
                let startdate = moment(req.query.startdate).startOf('day');
                let enddate = moment(req.query.enddate).endOf('day');

                if (enddate < startdate) {
                    req.flash("error", "Please Select Proper Date Range");
                    var obj = {
                        'draw': 0,
                        'recordsTotal': 0,
                        'recordsFiltered': 0,
                        'data': [],
                    };
                    return res.send(obj);
                }
                const fromDate = new Date(startdate);
                const toDate = new Date(enddate);
                createdAt = {
                    $gte: fromDate,
                    $lte: toDate
                }
                isDate = true;
            }

            let query = {
                playerId: req.query.playerId,
                gameType: { $nin: ['game_2', 'game_3', 'game_4'] },
                amtCategory: "realMoney"
            };
            if (req.query.tstatus != '') {
                query = {
                    status: req.query.tstatus,
                    playerId: req.query.playerId,
                    amtCategory: "realMoney",
                    gameType: { $nin: ['game_2', 'game_3', 'game_4'] },
                };
            }
            if (search != '') {
                query = {
                    transactionId: { $regex: '.*' + search + '.*' },
                    playerId: req.query.playerId,
                    amtCategory: "realMoney",
                    gameType: { $nin: ['game_2', 'game_3', 'game_4'] },
                };
            }
            if (isDate) {
                query.createdAt = createdAt;
            }
            console.log('query', query);
            let reqCount = await Sys.App.Services.transactionServices.getCount(query);

            let data = await Sys.App.Services.transactionServices.getDatatable(query, length > 1 ? length : null, start, sort);


            var obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            return res.send(obj);
        } catch (e) {
            console.log("Error in getPlayerTransactions", e);
        }
    },

    playerGameHistory: async function (req, res) {
        try {
            console.log('req.params', req.params.id);
            let viewFlag = true;
            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Players Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            /* let query = {
                _id: req.params.id
            };
            let dataPlayer = await Sys.App.Services.PlayerServices.getById(query); */
            let gameType = await Sys.App.Services.GameService.getByDataGameType({ type: { $in: ['game_1', 'game_2', 'game_3', 'game_5'] } });

            const keysArray = [
                "game_type",
                "game_id",
                "start_date_time_parent_game",
                "variant_game_id",
                "start_date_time_variant_game",
                "ticket_no",
                "purchase_type",
                "before_balance",
                "ticket_price",
                "winning_price_in_kr",
                "after_balance_in_kr",
                "daily_schedule_id",
                "sub_game_id",
                "game_1_variant_game",
                "ticket_color_type",
                "winning_pattern",
                "total_winnings",
                "jackpot_roulette_winning",
                "to_date",
                "from_date",
                "search",
                "reset",
                "choose_game_type",
                "start_date_time",
                "ticket_id"
            ];

            let game = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                playerActive: 'active',
                PlayersManagement: 'active',
                playerId: req.params.id,
                gameTypes: gameType,
                game: game,
                navigation: game
            };

            if (viewFlag == true) {
                return res.render('player/ApprovedPlayers/playerGameHistory', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositTransaction", e);
            return new Error(e);
        }
    },

    getPlayerGameHistory: async function (req, res) {
        try {
            console.log('req.query', req.query);
            console.log('req.query.startdate', req.query.startdate);
            let order = req.query.order;
            let sort = {};
            if (order?.length) {
                let columnIndex = order[0].column;
                let sortBy = req.query.columns[columnIndex].data;
                sort = {
                    [sortBy]: order[0].dir == "asc" ? 1 : -1,
                }
            } else {
                sort = { _id: -1 }
            }

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            if (length == 1) {
                length = null
            }
            let search = req.query.search.value;
            let isDate = false;
            let createdAt = {};
            let obj = {};
            if (req.query.startdate != '' && req.query.enddate != '') {
                /* let startdate = moment(req.query.startdate);
                let enddate = moment(req.query.enddate);
                let startDate =
                    startdate === undefined
                    ? moment(
                        new Date(nowdate.getFullYear(), nowdate.getMonth(), 1)
                        ).format("YYYY-MM-DD")
                    : startdate;
                let endDate =
                    enddate === undefined ? moment().format("YYYY-MM-DD") : enddate;
                if (endDate < startDate) {
                    request.flash("error", "Please Select Proper Date Range");
                }
                const fromDate = new Date(startDate);
                const toDate = new Date(endDate); */
                let startdate = moment(req.query.startdate).startOf('day');
                let enddate = moment(req.query.enddate).endOf('day');
                if (enddate < startdate) {
                    req.flash("error", "Please Select Proper Date Range");
                    obj = {
                        'draw': 0,
                        'recordsTotal': 0,
                        'recordsFiltered': 0,
                        'data': [],
                    };
                    return res.send(obj);
                }
                const fromDate = new Date(startdate);
                const toDate = new Date(enddate);
                createdAt = {
                    $gte: fromDate,
                    $lte: toDate
                }
                isDate = true;
            }
            if (req.query.gameType == 'game_1') {
                let query = {}
                if (isDate) {
                    query.createdAt = createdAt;
                }
                query.playerIdOfPurchaser = req.query.playerId;
                query.gameType = req.query.gameType;

                if (search != '') {
                    search = search.trim();
                    let searching = { $regex: search, $options: 'i' }
                    // query = {};
                    query['$or'] = [
                        { dailyScheduleId: searching },
                        { gameId: searching },
                        { subGame1Id: searching },
                        { gameName: searching },
                        { ticketColorName: searching },
                        { ticketId: searching }
                    ]

                    //playerIdOfPurchaser: req.query.playerId, gameType : req.query.gameType
                }
                let reqCount = await Sys.App.Services.transactionServices.getTicketCount(query);

                let data = await Sys.App.Services.transactionServices.getTicketDataLimited(query, parseInt(start), length > 1 ? length : null, sort);
                console.log(data.length);
                obj = {
                    'draw': req.query.draw,
                    'recordsTotal': reqCount,
                    'recordsFiltered': reqCount,
                    'data': data,
                };
            } else if (req.query.gameType == 'game_5') {
                let query = {};
                if (isDate) {
                    query.createdAt = createdAt;
                }
                query.playerIdOfPurchaser = req.query.playerId;
                query.gameType = req.query.gameType;
                query.isPurchased = true;
                if (search != '') {
                    query.gameName = { $regex: '.*' + search + '.*' }
                }

                let reqCount = await Sys.App.Services.GameService.getTicketCount(query);
                let sort = { createdAt: -1 };
                let data = await Sys.App.Services.GameService.getTicketsByData(query, { ticketId: 1, ticketPrice: 1, ticketPurchasedFrom: 1, winningStats: 1, totalWinningOfTicket: 1, bonusWinningStats: 1, ticketColorName: 1, gameName: 1, gameStartDate: 1, createdAt: 1 }, { sort: sort, limit: length, skip: start });
                console.log(data.length);
                obj = {
                    'draw': req.query.draw,
                    'recordsTotal': reqCount,
                    'recordsFiltered': reqCount,
                    'data': data,
                };
            } else {
                let query = {
                    gameType: req.query.gameType,
                    playerId: req.query.playerId,
                    defineSlug: { $ne: "extraTransaction" }
                };
                if (search != '') {
                    // let search = { $regex: '.*' + search + '.*' }
                    // query = {
                    //     gameNumber: { $regex: '.*' + search + '.*' },
                    //     playerId: req.query.playerId
                    // };
                    query.gameId = { $regex: '.*' + search + '.*' }
                }
                if (isDate) {
                    query.createdAt = createdAt;
                }
                let reqCount = await Sys.App.Services.transactionServices.getCount(query);

                let data = await Sys.App.Services.transactionServices.getDatatable(query, length > 1 ? length : null, start, sort);


                obj = {
                    'draw': req.query.draw,
                    'recordsTotal': reqCount,
                    'recordsFiltered': reqCount,
                    'data': data,
                };
            }
            return res.send(obj);
        } catch (e) {
            console.log("Error in getPlayerGameHistory", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            });
        }
    },

    depositRequsests: async function (req, res) {
        try {
            let viewFlag = true;
            let acceptFlag = true;
            let rejectFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Transactions Management'] || [];
                let stringReplace =req.session.details.isPermission['Transactions Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Transactions Management'];

                if ((stringReplace.indexOf("view") == -1)) {
                    viewFlag = false;
                }

                if ((stringReplace.indexOf("accept") == -1)) {
                    acceptFlag = false;
                }

                if ((stringReplace.indexOf("reject") == -1)) {
                    rejectFlag = false;
                }
            }
            let keys = [
                "deposit_requests",
                "table",
                "pay_in_hall",
                "vipps_cards",
                "date_time",
                "order_number",
                "customer_number",
                "username",
                "amount",
                "hall_name",
                "status",
                "action",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "both_date_required",
                "acceptbtn",
                "rejectbtn",
                "refresh_table",
                "are_you_sure",
                "delete_message",
                "delete_button",
                "cancel_button",
                "rejected",
                "cancelled",
                "accepted",
                "deposit_requset_is_rejct_successfully",
                "requset_has_been_cancelled",
                "do_you_want_to_accept_this_reuest",
                "deposit_request_accepted_successfully",
                "request_has_been_cancelled",
                "yes_reject_it",
                "yes_accept_it",
                "do_you_want_to_reject_this_request",
                "wallet_amount"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            await Sys.App.Services.transactionServices.updateManyTransactions({ view: false }, { view: true })

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                depositActive: 'active',
                depositRequestsActive: 'active',
                viewFlag: viewFlag,
                acceptFlag: acceptFlag,
                rejectFlag: rejectFlag,
                deposit: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('TransactionManagement/depositRequests', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositRequsests", e);
            return new Error(e);
        }
    },

    getDepositRequests: async function (req, res) {
        try {
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

            let query = { status: "pending", };
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search)) ? null : Number(search) },
                    { playerName: { $regex: `.*${search}.*`, $options: 'i' } }
                ]
                //query.playerName = { $regex: `.*${search}.*`, $options: 'i' } 
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes") {
                query.createdAt = { $gte: startTo, $lt: endFrom };
            }

            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }

            if (req.query.transactionType == "offline") {
                query.operation = "Offline";
            } else {
                query.operation = "Online";
            }

            let reqCount = await Sys.App.Services.transactionServices.getCountDeposit(query);

            let data = await Sys.App.Services.transactionServices.getDepositsByData(query, { orderNumber: 1, transactionID: 1, playerName: 1, createdAt: 1, amount: 1, status: 1, operation: 1, hallName: 1, customerNumber: 1, walletAmount: 1 }, { sort: sort, limit: length, skip: start });

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getDepositRequests", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    acceptDepositRequest: async function (req, res) {
        try {
            const { id: depositId, paymentType } = req.body;
            const { role, id: sessionId, name, hall, is_admin, isPermission, language } = req.session.details;
    
            if (!paymentType) {
                return res.send({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
                });
            }
    
            const query = { _id: depositId, status: "pending" };
            if (role === 'agent') {
                const txnPerms = isPermission?.['Transactions Management'] || "";
                const accPerms = isPermission?.['Accounting'] || "";
                if (!txnPerms.includes("accept") && !accPerms.includes("accept")) {
                    return res.send({
                        status: "failed",
                        message: await Sys.Helper.bingo.getSingleTraslateData(["you_are_not_allowed_to_perform_this_operation"], language)
                    });
                }
                query.hallId = hall[0].id;
            }
    
            const transaction = await Sys.App.Services.depositMoneyServices.getSingleByData(query, {
                playerId: 1, status: 1, amount: 1, operation: 1, paymentBy: 1, hallId: 1
            });
    
            if (!transaction || transaction.operation !== "Offline") {
                return res.send({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
                });
            }

            let agentId = sessionId, agentName = name, shiftId = null;
            const hallId = role === 'agent' ? hall[0].id : transaction.hallId;
            console.log("hallId", hallId);
            const [player, hallData] = await Promise.all([
                Sys.Game.Common.Services.PlayerServices.getOneByData(
                    { _id: transaction.playerId }, 
                    { username: 1, hall: 1 }
                ),
                Sys.App.Services.HallServices.getSingleHallData(
                    { _id: hallId },
                    { activeAgents: 1, groupHall: 1, otherData: 1 }
                )
            ]);

            if (!player) {
                return res.send({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["player_not_found"], language)
                });
            }

            if (!hallData?.activeAgents?.length) {
                return res.json({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData([
                        role === "admin" ? "no_agent_available_in_hall" : "agent_not_found"],
                        language
                    )
                });
            }
    
            if (hallData.otherData?.isPreviousDaySettlementPending) {
                return res.json({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["previous_day_settlement_pending"], language)
                });
            }
    
            if (role === 'agent') {
                const active = hallData.activeAgents.some(agent => agent.id === sessionId);
                if (!active) {
                    return res.json({
                        status: "failed",
                        message: await Sys.Helper.bingo.getSingleTraslateData(["please_ensure_previous_agent_logs_out"], language)
                    });
                }
            } else {
                const firstAgent = hallData.activeAgents[0];
                agentId = firstAgent.id;
                agentName = firstAgent.name;
                shiftId = firstAgent.shiftId;
            }
    
            const { amount } = transaction;
            const updatedPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: transaction.playerId },
                { $inc: { walletAmount: amount } }
            );
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "deposit",
                playerId: transaction.playerId,
                hallId: hallId,
                deposit: amount
            });
            const transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + Math.floor(100000 + Math.random() * 900000);
    
            const previousBalance = updatedPlayer.walletAmount - amount;
            const afterBalance = updatedPlayer.walletAmount;

            const [updatedTransaction, depositUpdate] = await Promise.all([
                Sys.Game.Common.Services.PlayerServices.updateByData(
                    { 'depositType.depositId': transaction._id },
                    {
                        status: "success",
                        previousBalance,
                        afterBalance,
                        paymentBy: paymentType
                    },
                    { new: true }
                ),
                Sys.App.Services.depositMoneyServices.updateData(
                    { _id: transaction._id, status: { $ne: "completed" } },
                    {
                        status: "completed",
                        transactionID: transactionId,
                        updatedAt: Date.now(),
                        actionTakenBy: {
                            isAdmin: is_admin === "yes",
                            id: sessionId,
                            name
                        },
                        paymentBy: paymentType
                    }
                )
            ]);

            await Sys.App.Services.depositMoneyServices.updateData(
                { _id: transaction._id, status: { $ne: "completed" } },
                { transactionID: updatedTransaction.transactionId }
            );

            const result = await handleAgentTransaction(updatedTransaction, req, {
                operation: "add",
                action: "credit",
                typeOfTransaction: "Deposit By Pay in Hall",
                agentName,
                agentId,
                shiftId,
                role
            });
    
            if (result.status === "fail") {
                return res.send({
                    status: "failed",
                    message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
                });
            }
    
            return res.json({
                status: "success",
                message: "Transaction is successfully completed.",
                dailyBalance: result.dailyBalance,
                paymentType: result.paymentType
            });
    
        } catch (error) {
            console.error("Error in acceptDepositRequest:", error);
            return res.send({
                status: "failed",
                message: "Internal server error"
            });
        }
    },
    
    rejectDepositRequest: async function (req, res) {
        try {
            console.log("req data", req.session.details.role);
            let translation = await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_perform_this_operation", "player_not_found", "something_went_wrong"], req.session.details.language);
            let query = { _id: req.body.id, status: "pending" }
            let rejectFlag = true;
            if (req.session.details.role == 'agent') {
                let stringReplace = req.session.details.isPermission['Transactions Management'];
                if ((!stringReplace || stringReplace.indexOf("reject") == -1) && (!req.session.details.isPermission['Accounting'] || req.session.details.isPermission['Accounting'].indexOf("reject") == -1)) {
                    rejectFlag = false;
                }
                query.hallId = req.session.details.hall[0].id;
            }

            if (rejectFlag == false) {
                return res.send({ status: "failed", message: translation.you_are_not_allowed_to_perform_this_operation });
            }
            console.log("query to reject deposit", query)
            let transaction = await Sys.App.Services.depositMoneyServices.getSingleByData(query, { playerId: 1, status: 1, amount: 1, operation: 1, paymentBy: 1 });

            if (transaction && transaction.operation == "Offline") {
                let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: transaction.playerId }, { username: 1, hall: 1 });
                if (!player) {
                    return res.send({ status: "failed", message: translation.player_not_found });
                }

                //let transactionAmount = transaction.amount;

                let transactionId = 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000);
                await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" } }, {
                    status: "rejected",
                    transactionID: transactionId,
                    updatedAt: Date.now(),
                    actionTakenBy: {
                        isAdmin: (req.session.details.is_admin == "yes") ? true : false,
                        id: req.session.details.id,
                        name: req.session.details.name,
                    }
                });

                await Sys.Game.Common.Services.PlayerServices.updateByData({ 'depositType.depositId': transaction._id }, {
                    status: "rejected",
                }, { new: true });

                // let transactionPointData = {
                //     transactionId: transactionId,
                //     playerId: player._id,
                //     playerName: player.username,
                //     category: "credit",
                //     status: "rejected",
                //     amtCategory: "realMoney",
                //     defineSlug: "extraTransaction",
                //     typeOfTransaction: "Deposit By Pay in Hall",
                //     typeOfTransactionTotalAmount: transactionAmount,
                //     depositType: { type: transaction.operation, paymentBy: (transaction.operation == "Online") ? transaction.paymentBy: "" },
                //     hallId: player.hall.id,
                //     createdAt: Date.now(),
                // }
                // await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                return res.send({ status: "success", message: "Transaction is successfully Rejected." });
            } else {
                return res.send({ status: "failed", message: translation.something_went_wrong });
            }

        } catch (error) {
            console.log("Error in rejectDepositRequest", error);
        }
    },

    depositHistory: async function (req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Transactions Management'] || [];
                let stringReplace =req.session.details.isPermission['Transactions Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Transactions Management'];
                if ((stringReplace.indexOf("view") == -1)) {
                    viewFlag = false;
                }
            }
            let keys = [
                "deposit_history",
                "table",
                "start_date",
                "end_date",
                "pay_in_hall",
                "vipps_cards",
                "date_time",
                "order_number",
                "customer_number",
                "transaction_id",
                "username",
                "amount",
                "hall_name",
                "status",
                "action",
                "search",
                "reset",
                "show",
                "entries",
                "previous",
                "next",
                "result",
                "both_date_required",
                "refresh_table",
                "payment_method"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                depositActive: 'active',
                depositHistoryActive: 'active',
                deposit: translate,
                navigation: translate
            };

            if (viewFlag) {
                return res.render('TransactionManagement/depositHistory', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in depositHistory", e);
            return new Error(e);
        }
    },

    getDepositHistory: async function (req, res) {
        try {

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

            let query = { status: { $ne: "pending" } };
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search)) ? null : Number(search) },
                    { playerName: { $regex: `.*${search}.*`, $options: 'i' } }
                ]
                //query.playerName = {  $regex: `.*${search}.*`, $options: 'i'  } 
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes") {
                query.createdAt = { $gte: startTo, $lt: endFrom };
            }

            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }

            if (req.query.transactionType == "offline") {
                query.operation = "Offline";
            } else {
                query.operation = "Online";
            }
            console.log("query for history", query)
            let reqCount = await Sys.App.Services.transactionServices.getCountDeposit(query);

            let data = await Sys.App.Services.transactionServices.getDepositsByData(query, { orderNumber: 1, transactionID: 1, playerName: 1, updatedAt: 1, amount: 1, status: 1, hallName: 1, customerNumber: 1, paymentBy: 1 }, { sort: sort, limit: length, skip: start });

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getDepositTransaction", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    getNotificationsCount: async function (req, res) {
        try {
            console.log("getNotificationsCount called:", req.params);
            let { hallId } = req.params;
            let query = { hallId: hallId, status: "pending", view: false };
            let depositCount = await Sys.App.Services.transactionServices.getCountDeposit(query);
            let withdrawCount = await Sys.App.Services.transactionServices.getCountWithdraw(query);
            console.log("depositCount", depositCount);
            console.log("withdrawCount", withdrawCount);
            return res.json({ status: "success", depositCount: depositCount, withdrawCount: withdrawCount });
        } catch (error) {
            console.error('Error in getNotificationsCount:', error);
            return res.json({ status: "fail", message: "Something went wrong please try again later" });
        }
    }
}

async function handleAgentTransaction(updatedTransaction, req, options = {}) {
    try {
        let transaction = {
            playerId: updatedTransaction.playerId,
            agentId: options.agentId,
            hallId: updatedTransaction.hallId,
            amount: updatedTransaction.typeOfTransactionTotalAmount,
            paymentType: updatedTransaction.paymentBy,
            agentName: options.agentName,
            operation: options.operation || "Offline",
            action: options.action || "credit",
            typeOfTransaction: options.typeOfTransaction || "Deposit By Pay in Hall",
            hall: updatedTransaction.hall,
            groupHall: updatedTransaction.groupHall,
            userType: updatedTransaction.userType,
            isPlayerTxAlreadyDone: true
        };

        let trResponse = await Sys.Helper.gameHelper.transferMoneyByHall(transaction);
        console.log("trResponse of transfer money by hall", trResponse);
        
        if (trResponse && trResponse.status == "success") {
            if (options.role == 'agent' && updatedTransaction.paymentBy == 'Cash') {
                req.session.details.dailyBalance = trResponse.dailyBalance;
                return {
                    status: "success",
                    dailyBalance: req.session.details.dailyBalance,
                    paymentType: updatedTransaction.paymentBy,
                    userwallet: trResponse.userwallet
                };
            }else if(options.role == 'admin' && updatedTransaction.paymentBy == 'Cash'){
                Sys.Helper.gameHelper.updateSession({ agentId: options.agentId, hallId:  updatedTransaction.hallId, shiftId: options.shiftId })
            }
            return {
                status: "success",
            }; 
        }
        
        return {
            status: "fail",
            message: "Something went wrong please try again later"
        };
    } catch (error) {
        console.error('Error during transfer:', error);
        return {
            status: "fail",
            message: "Something went wrong please try again later"
        };
    }
}