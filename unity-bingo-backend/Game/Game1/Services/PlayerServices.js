'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');
const socketModel = mongoose.model('socket');

module.exports = {
    create: async function(data) {
        try {
            let nw = new Date(data.dob);
            let uniqId = 'SP' + (await playerModel.countDocuments({}) + 1000);
            const playerSchema = new playerModel({
                // device_id: data.device_id,
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
                // isFbLogin : data.isFbLogin,
                // chips: 0,
                // cash : data.cash,
                status: data.status,
                socketId: data.socketId,
                walletAmount: data.walletAmount,
                // isCash : data.isCash
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
    update: async function(id, query) {
        try {
            let player = await playerModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },
    getOneByData: async function(data, select, setOption) {
        try {
            return await playerModel.findOne(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getOneByData : ' + error);
        }
    },

    FindOneUpdate: async function(id, query) {
        try {
            let player = await playerModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    getById: async function(id) {
        try {
            return await playerModel.findById(id);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    getByIdForLocation: async function(id) {
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

    updatePlayerData: async function(condition, data) {
        try {
            return await playerModel.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerCount: async function(data, select, setOption) {
        try {
            return await playerModel.countDocuments(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getPlayerCount : ' + error);
        }
    },

    getNewsByData: async function(data, select, setOption) {
        try {
            return await newsModel.find(data, select, setOption);
        } catch (error) {
            Sys.Log.info('Error in getNewsByData : ' + error);
        }
    },

    chipsTransferCreate: async function(data) {
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
    insertData: async function(data) {
        try {
            return await allUsersTransactionHistoryModel.create(data);
        } catch (e) {
            console.log("AllUsersTransactionHistoryServices Error in insertData", e);
            return new Error(e);
        }
    },

    updateManyData: async function(condition, data) {
        try {
            return await playerModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateManyData players", e);
            return new Error(e);
        }
    },

}