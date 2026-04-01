'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');
const socketModel = mongoose.model('socket');
const transactionModel = mongoose.model('transactions');
const errorModel = mongoose.model('Error');
module.exports = {
    create: async function (data) {
        try {
            let nw = new Date(data.dob);
            let uniqId = 'SP' + (await playerModel.countDocuments({}) + 1000);
            const playerSchema = new playerModel({
                device_id: data.device_id,
                uniqId: uniqId,
                // name : data.name,
                username: data.username,
                email: data.email,
                phone: data.phone,
                dob: data.dob,
                nickname: data.nickname,
                bankId: data.bankId,
                password: data.password,
                hall: data.hall,
                hallId: data.hallId,
                groupHall: data.groupHall,
                platform_os: data.platform_os,
                profilePic: data.profilePic,
                // isFbLogin : data.isFbLogin,
                // chips: 0,
                // cash : data.cash,
                // status: data.status,
                socketId: data.socketId,
                points: data.points,
                walletAmount: data.walletAmount,
                // isCash : data.isCash,
                surname: data.surname,
                customerNumber: data.customerNumber,
                approvedHalls: data.approvedHalls,
                PEP: data.PEP,
                pepDetails: data.pepDetails,
                riskCategory: data.riskCategory,
                addressDetails: data.addressDetails,
                selectedLanguage: data.selectedLanguage
            });
            let newPlayer = await playerSchema.save();
            console.log('newPlayer: ', newPlayer);

            if (newPlayer) {
                // New Player Register So Create New Entry in Socket DB
                const playerSchema = new socketModel({
                    playerId: newPlayer.id,
                    socketId: data.socketId
                });
                let newSocket = await playerSchema.save();
                return newPlayer;
            } else {
                return newPlayer;
            }
        } catch (error) {
            Sys.Log.info('Error in Create  Player : ' + error);
        }
    },
    update: async function (id, query) {
        try {
            let player = await playerModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },
    getOneByData: async function (data, select, setOption) {
        try {
            return await playerModel.findOne(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getOneByData : ' + error);
        }
    },
    getOneData: async function (data) {
        try {
            return await playerModel.findOne(data);
        } catch (error) {
            Sys.Log.info('Error in getOneData : ' + error);
        }
    },
    FindOneUpdate: async function (id, query) {
        try {
            let player = await playerModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    getByData: async function (data, column) {
        try {
            return await playerModel.find(data).select(column).sort({ points: -1 }).limit(100);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    getByDataPlayer: async function (data, column) {
        try {
            return await playerModel.find(data);
        } catch (error) {
            Sys.Log.info('Error in getByDataPlayer : ' + error);
        }
    },


    getByDataLoyalty: async function (data) {
        try {
            return await playerModel.find(data);
        } catch (error) {
            Sys.Log.info('Error in Player services getByDataLoyalty : ' + error);
        }
    },

    getByDataPlayers: async function (data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getBotByData: async function (data, limit) {
        try {
            return await playerModel.find(data).limit(limit);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getById: async function (id) {
        try {
            return await playerModel.findById(id);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    getByIdCnt: async function (id) {
        try {
            return await playerModel.count(id);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    getByIdForLocation: async function (id) {
        try {
            return await playerModel.find({ _id: id });
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    /*update: async function(data){
      let UpdatePlayerData = await playerModel.updateOne({
        _id : data.playerId
      }, {
        firstname:data.firstname,
        lastname:data.lastname,
        mobile:data.mobile,
        gender:data.gender
      });
      if(!UpdatePlayerData){
        return new Error('No Record Found!');
      }
      else{
        return UpdatePlayerData;
      }
    },*/

    updatePlayerData: async function (condition, data) {
        try {
            await playerModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deletePlayer: async function (data) {
        try {
            return await playerModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerCount: async function (data, select, setOption) {
        try {
            return await playerModel.countDocuments(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getPlayerCount : ' + error);
        }
    },

    getNewsByData: async function (data, select, setOption) {
        try {
            return await newsModel.find(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getNewsByData : ' + error);
        }
    },

    chipsTransferCreate: async function (data) {
        try {
            const chipsTransferSchema = new chipsTransferModel({
                playerId: data.playerId,
                receiverId: data.receiverId,
                chips: data.chips
            });
            let newTransfer = await chipsTransferSchema.save();
            return newTransfer;
        } catch (error) {
            Sys.Log.info('Error in Chips Transfer Create : ' + error);
        }
    },

    createTransaction: async function (data) {
        try {
            return await transactionModel.create(data);
        } catch (error) {
            console.log("Player Service in Common  Error in createTransaction", error);
            return new Error(error);
        }
    },

    createBulkTransaction: async function (data, options) {
        try {
            return await transactionModel.insertMany(data, options);
        } catch (error) {
            console.log("Player Service in Common  Error in createTransaction", error);
            return new Error(error);
        }
    },

    FindOneUpdateTransaction: async function (id, query) {
        try {
            let player = await transactionModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    updateByData: async function (condition, query, filter) {
        try {
            let transaction = await transactionModel.findOneAndUpdate(condition, query, filter);
            return transaction;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    updateOneTransaction: async function (id, query) {
        try {
            let player = await transactionModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    transactionData: async function (data) {
        try {
            return await transactionModel.find(data);
        } catch (error) {
            console.log("Player Service in Common  Error in transactionData", error);
            return new Error(error);
        }
    },

    transactionCountData: async function (data) {
        try {
            return await transactionModel.countDocuments(data);
        } catch (error) {
            console.log("Player Service in Common  Error in transactionData", error);
            return new Error(error);
        }
    },

    transaction100Data: async function (data) {
        try {
            return await transactionModel.find(data).sort({ createdAt: -1 }).limit(100);
        } catch (error) {
            console.log("Player Service in Common  Error in transactionData", error);
            return new Error(error);
        }
    },

    getTransactionByData: async function (data, select, setOption) {
        try {
            return await transactionModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getDepositsByData' + e.message);
        }
    },

    getSingleTransactionByData: async function (data, select, setOption) {
        try {
            return await transactionModel.findOne(data, select, setOption).lean();  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getDepositsByData' + e.message);
        }
    },

    updateManyTransaction: async function (condition, data) {
        try {
            return await transactionModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyTransaction", e);
            return new Error(e);
        }
    },

    createErrorLog: async function (data) {
        try {
            return await errorModel.create(data);
        } catch (error) {
            console.log("Error in error model", error);
            return new Error(error);
        }
    },

    createBotPlayers: async function (data) {
        try {
            const playerSchema = new playerModel({
                device_id: data.device_id,
                username: data.username,
                email: data.email,
                phone: data.phone,
                dob: data.dob,
                nickname: data.nickname,
                bankId: data.bankId,
                password: data.password,
                hall: data.hall,
                hallId: data.hallId,
                groupHall: data.groupHall,
                platform_os: data.platform_os,
                profilePic: data.profilePic,
                status: data.status,
                socketId: data.socketId,
                points: data.points,
                walletAmount: data.walletAmount,
                surname: data.surname,
                userType: data.userType,
                customerNumber: data.customerNumber,
                approvedHalls: data.approvedHalls,
                playerAgent: data.playerAgent,
                hallApprovedBy: data.hallApprovedBy
            });
            let newPlayer = await playerSchema.save();
            return newPlayer;
        } catch (error) {
            Sys.Log.info('Error in Creating Bot Player : ' + error);
        }
    },

    createBulkPlayers: async function (data) {
        try {
            return await playerModel.bulkWrite(data);
        } catch (error) {
            console.log("Error in createBulkPlayers", error);
            return new Error(error);
        }
    },

    deleteManyPlayerByData: async function (data) {
        try {
            return await playerModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    insertManyPlayers: async function (data, options) {
        try {
            return await playerModel.insertMany(data, options);
        } catch (error) {
            console.log("Player Service in Common  Error in insertManyPlayers", error);
            return new Error(error);
        }
    },

    getManyPlayerByData: async function (filter, select = {}) {
        try {
            return await playerModel.find(filter, select).lean(); // Using `.lean()` for performance
        } catch (error) {
            console.error("Error in getManyPlayerByData:", error);
            throw error;
        }
    }

}