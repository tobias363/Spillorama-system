'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');
const socketModel = mongoose.model('socket');
module.exports = {
   
    getSingleData: async function (data, select, setOption) {
        try {
            return await playerModel.findOne(data, select, setOption).lean();
        } catch (e) {
            Sys.Log.info('Error in getSingleData : ' + e);
        }
    },

    getByData: async function(data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption).lean();
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },

    getById: async function(id, select, options) {
        try {
            return await playerModel.findById(id, select, options).lean();
        } catch (error) {
            Sys.Log.info('Error in getById : ' + error);
        }
    },

    updateData: async function (condition, query, filter) {
        try {
            let player = await playerModel.findOneAndUpdate(condition, query, filter).lean();
            return player;
        } catch (e) {
            Sys.Log.info('Error in updateData : ' + e);
        }
    },

    getPlayerAggregate: async function (data) {
        try {
            return await playerModel.aggregate(data);
        } catch (e) {
            console.log("getPlayerAggregate Error", e);
            return new Error(e);
        }
    },

}