var Sys = require('../../Boot/Sys');
var bcrypt = require('bcryptjs');
const rolesArray = ['admin', 'master', 'agent', 'childAgent'];
var moment = require('moment-timezone');
var fs = require("fs"); //Load the filesystem module

module.exports = {

    withdrawAmt: async function(req, res) {
        try {


            let acceptFlag = true;
            let rejectFlag = true;


            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Withdraw Management'];

                if (!stringReplace || stringReplace.indexOf("accept") == -1) {
                    acceptFlag = false;
                }

                if (!stringReplace || stringReplace.indexOf("reject") == -1) {
                    rejectFlag = false;
                }

            }

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                withdrawAmt: 'true',
                mywithdrawActive: 'active',
                acceptFlag: acceptFlag,
                rejectFlag: rejectFlag

            };

            return res.render('Amountwithdraw/withdrawAmount', data);

        } catch (e) {
            console.log("Error", e);
        }
    },

    getAllTXN: async function(req, res) {

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

            let query = {};
            if (search != '') {
                query = { name: { $regex: '.*' + search + '.*' } };
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes" && search == '') {
                query = { createdAt: { $gte: startTo, $lt: endFrom } };
            }

            if (req.query.is_date_search == "yes" && search != '') {
                query = { name: { $regex: '.*' + search + '.*' }, createdAt: { $gte: startTo, $lt: endFrom } };
            }
            if (req.session.details.role == "agent") {
                query.hallId = req.session.details.hall[0].id;
            }
            let reqCount = await Sys.App.Services.WithdrawServices.getCount(query);

            let data = await Sys.App.Services.WithdrawServices.getDatatable(query, length, start, sort);

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data
            };

            res.send(obj);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getDelete: async function(req, res, socket) {
        try {

            if (req.body.remark == '') {
                return res.send({ 'status': 'fail', message: 'Fail because Remark is empty..' });
            }
            let withdraw = await Sys.App.Services.WithdrawServices.getById({ _id: req.body.id });

            if (withdraw || withdraw.length > 0) {

                var currentPlayer = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: withdraw.playerId }); //, optSession

                var transactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: currentPlayer._id,
                    playerName: currentPlayer.username,
                    category: "debit",
                    status: "failed",
                    amtCategory: "realMoney",
                    defineSlug: "withdraw",
                    hallId: currentPlayer.hall.id,
                    previousBalance: currentPlayer.walletAmount,
                    afterBalance: currentPlayer.walletAmount,
                    withdrawAmount: withdraw.withdrawAmount,
                    withdrawType: "withdraw",
                    remark: req.body.remark, //remark on transaction
                    createdAt: Date.now(),
                }

                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                await Sys.App.Services.WithdrawServices.delete(req.body.id)
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },


    chipsAction: async function(req, res) {
        try {

            let query = {
                _id: req.body.withdrawId
            }
            if (req.body.remark == '') {
                return res.send({ 'status': 'fail', message: 'Fail because Remark is empty..' });
            }

            let withdraw = await Sys.App.Services.WithdrawServices.getSingleData(query);

            if (withdraw) {

                var currentPlayer = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: withdraw.playerId }, { $inc: { walletAmount: -withdraw.withdrawAmount } }); //, optSession

                var transactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: currentPlayer._id,
                    playerName: currentPlayer.username,
                    category: "debit",
                    status: "success",
                    amtCategory: "realMoney",
                    defineSlug: "withdraw",
                    previousBalance: currentPlayer.walletAmount + withdraw.withdrawAmount,
                    afterBalance: currentPlayer.walletAmount,
                    withdrawAmount: withdraw.withdrawAmount,
                    withdrawType: "withdraw",
                    hallId: currentPlayer.hall.id,
                    remark: req.body.remark, //remark on transaction
                    createdAt: Date.now(),
                }

                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

                let ExtratransactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: currentPlayer._id,
                    defineSlug: "extraTransaction",
                    typeOfTransaction: "Withdraw",
                    category: "debit",
                    status: "success",
                    hallId: currentPlayer.hall.id,
                    typeOfTransactionTotalAmount: withdraw.withdrawAmount,
                    amtCategory: "realMoney",
                    createdAt: Date.now(),
                }

                await Sys.Game.Common.Services.PlayerServices.createTransaction(ExtratransactionPointData);

                await Sys.App.Services.WithdrawServices.delete(withdraw._id);
                return res.send("success");
            } else {
                return res.send("fail");
            }

        } catch (error) {
            console.log("Error", error);
        }
    },

    withdrawAmtHistory: async function(req, res) {
        try {

            let viewFlag = true;
            if (req.session.details.role == 'agent') {
                var stringReplace = req.session.details.isPermission['Withdraw Management'];

                if (!stringReplace || stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }


            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                withdrawAmtHistory: 'true',
                mywithdrawActive: 'active',
            };

            if (viewFlag == true) {
                return res.render('Amountwithdraw/withdrawHistory', data);
            } else {
                req.flash('error', 'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    getAllTXNHistory: async function(req, res) {

        // res.send(req.query.start); return false;
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

            let query = { category: "debit", withdrawType: "withdraw" };
            if (search != '') {
                query = { withdrawType: "withdraw" };
                query.playerName = new RegExp(search, "i");
            }
            if (req.session.details.role == "agent") {
                query.hallId = req.session.details.hall[0].id
            }
            console.log("query", query);

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);


            if (req.query.is_date_search == "yes" && search == '') {
                query = { createdAt: { $gte: startTo, $lt: endFrom }, withdrawType: "withdraw" };
            }

            if (req.query.is_date_search == "yes" && search != '') {
                query = { createdAt: { $gte: startTo, $lt: endFrom }, withdrawType: "withdraw" };
                query.playerName = new RegExp(search, "i");
            }

            //console.log(query);
            let reqCount = await Sys.App.Services.transactionServices.getCount(query);

            let data = await Sys.App.Services.transactionServices.getDatatable(query, length, start, sort);

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

    // New Withdraw Flow
    withdrawRequestInHall: async function(req, res) {
        try {
            let viewFlag = true;
            let acceptFlag = true;
            let rejectFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Withdraw Management'];

                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
               
                if (stringReplace.indexOf("accept") == -1) {
                    acceptFlag = false;
                }

                if (stringReplace.indexOf("reject") == -1) {
                    rejectFlag = false;
                }
            }

            const keysArray = [
                "withdraw_request_in_hall",
                "dashboard",
                "withdraw_request",
                "refresh_table",
                "search",
                "date",
                "customer_number",
                "fullname",
                "withdraw_amount",
                "hall_name",
                "status",
                "action",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_request",
                "delete_button",
                "cancel_button",
                "rejected",
                "withdraw_request_is_rejected_successfully",
                "cancelled",
                "request_has_been_cancelled",
                "accepted",
                "withdraw_request_accepted_successfully",
                "do_you_want_to_accept_this_request",
                "withdraw_request_has_been_cancelled",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "acceptbtn",
                "rejectbtn",
                "you_are_not_allowed_to_perform_this_operation",
                "yes_reject_it",
                "yes_accept_it"
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawInHallActive: 'active',
                acceptFlag: acceptFlag,
                rejectFlag: rejectFlag,
                withdraw: withdraw,
                navigation: withdraw
            };

            if (viewFlag) {
                await Sys.App.Services.transactionServices.updateManyWithdraw({ view: false }, { view: true });
                return res.render('Amountwithdraw/hallRequests', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in withdraw request In Hall", e);
            return new Error(e);
        }
    }, 

    withdrawRequestInBank: async function(req, res) {
        try {
            let viewFlag = true;
            let acceptFlag = true;
            let rejectFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }

                if (stringReplace.indexOf("accept") == -1) {
                    acceptFlag = false;
                }

                if (stringReplace.indexOf("reject") == -1) {
                    rejectFlag = false;
                }
            }

            const keysArray = [
                "withdraw_request_in_hall",
                "dashboard",
                "withdraw_request",
                "refresh_table",
                "search",
                "date",
                "customer_number",
                "fullname",
                "withdraw_amount",
                "hall_name",
                "status",
                "action",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_request",
                "delete_button",
                "cancel_button",
                "rejected",
                "withdraw_request_is_rejected_successfully",
                "cancelled",
                "request_has_been_cancelled",
                "accepted",
                "withdraw_request_accepted_successfully",
                "do_you_want_to_accept_this_request",
                "withdraw_request_has_been_cancelled",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "acceptbtn",
                "rejectbtn",
                "you_are_not_allowed_to_perform_this_operation",
                "yes_reject_it",
                "yes_accept_it",
                "bank_account_number"
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawInBankActive: 'active',
                acceptFlag: acceptFlag,
                rejectFlag: rejectFlag,
                withdraw: withdraw,
                navigation: withdraw
            };

            if (viewFlag) {
                return res.render('Amountwithdraw/bankRequests', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in withdraw request In Hall", e);
            return new Error(e);
        }
    }, 

    getWithdrawRequest: async function(req, res) {
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

            let query = {status: "pending"};
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search) ) ? null : Number(search) },
                    { name: {  $regex: `.*${search}.*`, $options: 'i'  } } 
                ] 
               //query.name = { $regex: `.*${search}.*`, $options: 'i' } 
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes") {
                query.createdAt= { $gte: startTo, $lt: endFrom } ;
            }

            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }

            if(req.query.transactionType == "hall"){
                query.withdrawType = "Withdraw in Hall";
            }else{
                query.withdrawType = "Withdraw in Bank";
            }
           
            let reqCount = await Sys.App.Services.WithdrawServices.getCount(query);

            let data = await Sys.App.Services.WithdrawServices.getWithdrawByData(query, { name: 1, createdAt: 1, withdrawAmount: 1, status: 1, withdrawType: 1, bankAccountNumber: 1, hallName: 1, customerNumber: 1}, {sort: sort, limit: length,skip: start} );

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in get withdraw request in hall", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    acceptWithdrawRequest: async function(req, res){
        try {
            console.log("req data", req.session.details.role);
            
            let query = {_id: req.body.id, status: "pending"}
            let acceptFlag = true;
            if (req.session.details.role == 'agent') {
                let stringReplace = req.session.details.isPermission['Withdraw Management'];
                if ( (!stringReplace || stringReplace.indexOf("accept") == -1) && (!req.session.details.isPermission['Accounting'] || req.session.details.isPermission['Accounting'].indexOf("accept") == -1) ) {
                    acceptFlag = false;
                }
                query.hallId = req.session.details.hall[0].id;
            }

            if(acceptFlag == false){
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_perform_this_operation"], req.session.details.language);
                return res.send({status: "failed", message: withdrawData.you_are_not_allowed_to_perform_this_operation });
            }
            console.log("query to accept deposit", query)
            let transaction = await Sys.App.Services.WithdrawServices.getSingleByData(query, {playerId: 1, status: 1, withdrawAmount: 1, withdrawType: 1, transactionId: 1});
            
            if (transaction && ( transaction.withdrawType == "Withdraw in Hall" || transaction.withdrawType == "Withdraw in Bank") ) {
                let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({_id: transaction.playerId}, { username: 1, hall: 1 });
                if(!player){
                    let withdrawData = await Sys.Helper.bingo.getTraslateData(["player_not_found"], req.session.details.language);
                    return res.send({status: "failed", message: withdrawData.player_not_found });
                }

                await Sys.App.Services.WithdrawServices.updateData({_id: transaction._id, playerId: player._id, status: {$ne: "completed"} }, {
                    status: "completed",
                    updatedAt: Date.now(),
                    actionTakenBy: {
                        isAdmin: (req.session.details.is_admin == "yes") ? true : false ,
                        id: req.session.details.id,
                        name: req.session.details.name,
                    },
                });

                // to update pending transaction
                Sys.Game.Common.Services.PlayerServices.updateByData({transactionId: transaction.transactionId, playerId: player._id}, {
                    status: "success", 
                }, {new : true});
                //console.log("updatedTransaction----", updatedTransaction);
                
                return res.send({status: "success", message: "Transaction is successfully completed."});
            } else {
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["something_went_wrong"], req.session.details.language);
                return res.send({status: "failed", message: withdrawData.something_went_wrong });
            }

        } catch (error) {
            console.log("Error", error);
        }
    },

    rejectWithdrawRequest: async function(req, res){
        try {
            console.log("req data", req.session.details.role);
            let query = {_id: req.body.id, status: "pending"}
            let rejectFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Withdraw Management'];
                if (stringReplace.indexOf("reject") == -1) {
                    rejectFlag = false;
                }
                query.hallId = req.session.details.hall[0].id;
            }

            if(rejectFlag == false){
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_perform_this_operation"], req.session.details.language);
                return res.send({status: "failed", message:  withdrawData.you_are_not_allowed_to_perform_this_operation});
            }
            console.log("query to reject deposit", query)
            let transaction = await Sys.App.Services.WithdrawServices.getSingleByData(query, {playerId: 1, status: 1, withdrawAmount: 1, withdrawType: 1, transactionId: 1});

            if (transaction && (transaction.withdrawType == "Withdraw in Hall" || transaction.withdrawType == "Withdraw in Bank") ) {
                let player = await Sys.Game.Common.Services.PlayerServices.getOneByData({_id: transaction.playerId}, { username: 1, hall: 1, walletAmount:1 });
                if(!player){
                    let withdrawData = await Sys.Helper.bingo.getTraslateData(["player_not_found"], req.session.details.language);
                    return res.send({status: "failed", message: withdrawData.player_not_found});
                }

                let updatedPlayer = await Sys.App.Services.PlayerServices.updatePlayerData({ _id: player._id }, { $inc: { walletAmount: +transaction.withdrawAmount } });
                console.log("updatedPlayer---", updatedPlayer);
                
                if(updatedPlayer && updatedPlayer.modifiedCount == 0){
                    let withdrawData = await Sys.Helper.bingo.getTraslateData(["something_went_wrong"], req.session.details.language);
                    return {
                        status: 'fail',
                        result: null,
                        message: withdrawData.something_went_wrong
                    }
                }
                
                await Sys.App.Services.WithdrawServices.updateData({ _id: transaction._id, playerId: player._id, status: {$ne: "completed"} }, {
                    status: "rejected",
                    updatedAt: Date.now(),
                    actionTakenBy: {
                        isAdmin: (req.session.details.is_admin == "yes") ? true : false ,
                        id: req.session.details.id,
                        name: req.session.details.name,
                    }
                });
                
                Sys.Game.Common.Services.PlayerServices.updateByData({transactionId: transaction.transactionId, playerId: player._id}, {
                    status: "rejected", 
                }, {new : true});
                let transactionPointData = {
                    transactionId: transaction.transactionId,
                    playerId: player._id,
                    playerName: player.username,
                    category: "credit",
                    status: "refunded",
                    amtCategory: "realMoney",
                    defineSlug: "extraTransaction",
                    typeOfTransaction: "Withdraw",
                    typeOfTransactionTotalAmount: +transaction.withdrawAmount,
                    hallId: player.hall.id,
                    previousBalance: +player.walletAmount,
                    afterBalance: player.walletAmount + (+transaction.withdrawAmount),
                    createdAt: Date.now(),
                }
                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
                
                return res.send({status: "success", message: "Transaction is successfully Rejected."});
            } else {
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["something_went_wrong"], req.session.details.language);
                return res.send({status: "failed", message: withdrawData.something_went_wrong});
            }

        } catch (error) {
            console.log("Error in rejectDepositRequest", error);
        }
    },

    withdrawHistoryHall: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Withdraw Management'];
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            const keysArray = [
                "withdraw_history_table",
                "dashboard",
                "withdraw_history_hall",
                "from_date",
                "to_date",
                "group_of_hall_name",
                "hall_name",
                "date_time",
                "transaction_id",
                "amount",
                "hall",
                "refresh_table",
                "search",
                "date",
                "customer_number",
                "fullname",
                "status",
                "action",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "acceptbtn",
                "rejectbtn",
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawAmtHistoryHall: 'active',
                withdraw: withdraw,
                navigation: withdraw
            };

            if (viewFlag) { 
                return res.render('Amountwithdraw/historyHall', data);
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

    getWithdrawHistoryHall: async function(req, res) {
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
            let groupId = req.query.groupHall;
            let hallId = req.query.hall;

            let query = { status: {$ne: "pending"} };
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search) ) ? null : Number(search) },
                    { name: {  $regex: `.*${search}.*`, $options: 'i'  } } 
                ] 
                //query.name = {  $regex: `.*${search}.*`, $options: 'i'  } 
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes") {
                query.createdAt= { $gte: startTo, $lt: endFrom } ;
            }
            
            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }else{
                if(hallId){
                    query.hallId = hallId;
                }else{
                    if(groupId){
                        let halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "groupHall.id": groupId}, { name: 1 });
                        let hallIds = [];
                        if(halls && halls.length > 0){
                            for(let h=0; h < halls.length; h++){
                                hallIds.push(halls[h].id);
                            }
                        }
                        query.hallId = {$in: hallIds };
                    }
                }
            }
            
            query.withdrawType = "Withdraw in Hall";
        
            //console.log("query for history", query, hallId, groupId)
            let reqCount = await Sys.App.Services.WithdrawServices.getCount(query);

            let data = await Sys.App.Services.WithdrawServices.getWithdrawByData(query, { name: 1, updatedAt: 1, withdrawAmount: 1, status: 1, withdrawType: 1, transactionId: 1, bankAccountNumber: 1, hallName: 1, customerNumber: 1}, {sort: sort, limit: length,skip: start} );

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in withdraw history", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    withdrawHistoryBank: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }

            const keysArray = [
                "withdraw_history_table",
                "dashboard",
                "withdraw_history_bank",
                "from_date",
                "to_date",
                "group_of_hall_name",
                "hall_name",
                "date_time",
                "transaction_id",
                "bank_account_number",
                "amount",
                "hall",
                "hall_name",
                "refresh_table",
                "search",
                "date",
                "customer_number",
                "fullname",
                "status",
                "action",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "acceptbtn",
                "rejectbtn",
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawAmtHistoryBank: 'active',
                withdraw: withdraw,
                navigation: withdraw,
                viewFlag: viewFlag
            };

            if (viewFlag) {
                return res.render('Amountwithdraw/historyBank', data);
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

    getWithdrawHistoryBank: async function(req, res) {
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
            let groupId = req.query.groupHall;
            let hallId = req.query.hall;

            let query = { status: {$ne: "pending"} };
            if (search != '') {
                query.$or = [
                    { customerNumber: isNaN(Number(search) ) ? null : Number(search) },
                    { name: {  $regex: `.*${search}.*`, $options: 'i'  } } 
                ] 
                //query.name = {  $regex: `.*${search}.*`, $options: 'i'  } 
            }

            let startTo = new Date(req.query.start_date);
            let endFrom = new Date(req.query.end_date);
            endFrom.setHours(23, 59, 59);

            if (req.query.is_date_search == "yes") {
                query.createdAt= { $gte: startTo, $lt: endFrom } ;
            }
            
            if (req.session.details.role == 'agent') {
                query.hallId = req.session.details.hall[0].id;
            }else{
                if(hallId){
                    query.hallId = hallId;
                }else{
                    if(groupId){
                        let halls = await Sys.App.Services.HallServices.getAllHallDataSelect({ "groupHall.id": groupId}, { name: 1 });
                        let hallIds = [];
                        if(halls && halls.length > 0){
                            for(let h=0; h < halls.length; h++){
                                hallIds.push(halls[h].id);
                            }
                        }
                        query.hallId = {$in: hallIds };
                    }
                }
            }
            
            query.withdrawType = "Withdraw in Bank";

            //console.log("query for history", query)
            let reqCount = await Sys.App.Services.WithdrawServices.getCount(query);

            let data = await Sys.App.Services.WithdrawServices.getWithdrawByData(query, { name: 1, updatedAt: 1, withdrawAmount: 1, status: 1, withdrawType: 1, transactionId: 1, bankAccountNumber: 1, hallName: 1, customerNumber: 1}, {sort: sort, limit: length,skip: start} );

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in withdraw history", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    },

    withdrawEmails: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            const keysArray = [
                "withdraw_accountant_emails",
                "dashboard",
                "accountant_emails",
                "emailId",
                "add_email",
                "sr_no",
                "are_you_sure",
                "you_will_not_be_able_to_recover_this_email",
                "delete_button",
                "cancel_button",
                "deleted",
                "email_has_been_deleted",
                "cancelled",
                "delete_action_has_been_cancelled",
                "refresh_table",
                "search",
                "date",
                "customer_number",
                "fullname",
                "status",
                "action",
                "start_date",
                "end_date",
                "show",
                "entries",
                "previous",
                "next",
                "acceptbtn",
                "rejectbtn",
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawAddEmails: 'active',
                withdraw: withdraw,
                navigation: withdraw
            };

            if (viewFlag) {
                return res.render('Amountwithdraw/emails', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in adding withdraw emails", e);
            return new Error(e);
        }
    },

    getwithdrawEmails: async function(req, res) {
        try {
            let sort = {createdAt: -1};
            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            let search = req.query.search.value;

            let query = {  };
            if (search != '') {
                query.email = {  $regex: `.*${search}.*`, $options: 'i'  } 
            }

            let reqCount = await Sys.App.Services.WithdrawServices.getEmailsCount(query);

            let data = await Sys.App.Services.WithdrawServices.getEmailsByData(query, { email: 1}, {sort: sort, limit: length,skip: start} );
            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': data,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in withdraw Email", e);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': [],
            })
        }
    }, 

    addWithdrawEmails: async function(req, res) {
        try {
            let viewFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("view") == -1) {
                    viewFlag = false;
                }
            }
            const keysArray = [
                "dashboard",
                "accountant_emails",
                "emailId",
                "add_email",
                "edit_email",
                "cancel",
                "submit",
                "enter_email_id"
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)
            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawAddEmails: 'active',
                slug: 'Add',
                withdraw: withdraw,
                navigation: withdraw
            };

            if (viewFlag) {
                return res.render('Amountwithdraw/addEmails', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in adding withdraw emails", e);
            return new Error(e);
        }
    },

    addWithdrawEmailsPost: async function (req, res) {
        try {
            let email = req.body.email.trim();
            if(!email){
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                req.flash('error', withdrawData.language_update_failed);
                return res.redirect('/withdraw/list/emails');
            }

            let emailCount = await Sys.App.Services.WithdrawServices.getEmailsCount({ 'email': {'$regex': email,$options:'i'}});
            if(emailCount > 0){
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["this_email_id_is_already_exists"], req.session.details.language);
                req.flash('error', withdrawData.this_email_id_is_already_exists);
                return res.redirect('/withdraw/add/emails');
            }
            let addEmails = await Sys.App.Services.WithdrawServices.insertEmailData({
                email: req.body.email,
                createrId: req.session.details.id,
            });

            if (!addEmails) {
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                req.flash('error', withdrawData.language_update_failed);
                return res.redirect('/withdraw/list/emails');
            } else {
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["email_has_been_added_successfully"], req.session.details.language);
                req.flash('success', withdrawData.email_has_been_added_successfully);
                return res.redirect('/withdraw/list/emails');
            }

        } catch (e) {
            console.log("Error", e);
        }
    },

    editWithdrawEmails: async function(req, res) {
        try {
            let editFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Withdraw Management'] || [];
                let stringReplace =req.session.details.isPermission['Withdraw Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                if (stringReplace.indexOf("edit") == -1) {
                    editFlag = false;
                }
            }
            let email = await Sys.App.Services.WithdrawServices.getSingleEmailData({ _id: req.params.id }, {email: 1}, {});
            
            const keysArray = [
                "dashboard",
                "accountant_emails",
                "emailId",
                "add_email",
                "edit_email",
                "cancel",
                "submit",
                "enter_email_id"
            ];

            let withdraw = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            let data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                mywithdrawActive: 'active',
                withdrawAddEmails: 'active',
                slug: 'Edit',
                emailData: email,
                withdraw: withdraw,
                navigation: withdraw
            };

            if (editFlag) {
                return res.render('Amountwithdraw/addEmails', data);
            } else {
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }

        } catch (e) {
            console.log("Error in editing withdraw emails", e);
            return new Error(e);
        }
    },

    editWithdrawEmailsPost: async function (req, res) {
        try {
            let id = req.params.id;
            if(!id || !req.body.email.trim()){
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                req.flash('error', withdrawData.language_update_failed);
                return res.redirect('/withdraw/list/emails');
            }
            let email = await Sys.App.Services.WithdrawServices.getSingleEmailData({ _id: req.params.id }, {email: 1}, {});
            if(email){
                let updatedEmail = await Sys.App.Services.WithdrawServices.updateEmailData({_id: req.params.id},{
                    email: req.body.email.trim(),
                });
    
                if (!updatedEmail) {
                    let withdrawData = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                    req.flash('error', withdrawData.language_update_failed);
                    return res.redirect('/withdraw/list/emails');
                } else {
                    let withdrawData = await Sys.Helper.bingo.getTraslateData(["email_has_been_updated_successfully"], req.session.details.language);
                    req.flash('success', withdrawData.email_has_been_updated_successfully);
                    return res.redirect('/withdraw/list/emails');
                }
            }else{
                let withdrawData = await Sys.Helper.bingo.getTraslateData(["language_update_failed"], req.session.details.language);
                req.flash('error', withdrawData.language_update_failed);
                return res.redirect('/withdraw/list/emails');
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteWithdrawEmails: async function (req, res) {
        try {
            let email = await Sys.App.Services.WithdrawServices.getSingleEmailData({ _id: req.body.id });
            if (email || email.length > 0) {
                await Sys.App.Services.WithdrawServices.deleteEmail({ _id: req.body.id });
                return res.send("success");
            } else {
                return res.send("error");
            }
        } catch (e) {
            console.log("Error", e);
        }
    },

    checkForUniqueEmailId: async function(req, res){
        try{
            let email = '^' + req.body.email + '$';console.log("email---", email, req.params.emailId)
            let emailCount = 0;
            if(req.params.emailId){
                emailCount = await Sys.App.Services.WithdrawServices.getEmailsCount({ _id:  {$ne: req.params.emailId}, 'email': {'$regex': email,$options:'i'}});
            }else{
                emailCount = await Sys.App.Services.WithdrawServices.getEmailsCount({'email': {'$regex': email,$options:'i'}});
            }
            console.log("checkForUniqueEmailId count", emailCount)
            if(emailCount == 0){
                return res.send({ "valid" : true });
            }
            let withdrawData = await Sys.Helper.bingo.getTraslateData(["this_email_id_is_already_exists"], req.session.details.language);
            return res.send({ "valid" : false, "message": withdrawData.this_email_id_is_already_exists });
        }catch(e){
            console.log("Error in checkForUniqueEmailId", e)
        }
    },

}