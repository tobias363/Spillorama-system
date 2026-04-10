'use strict';
var Sys = require('../../../Boot/Sys');

const mongoose = require('mongoose');
const playerModel = mongoose.model('player');

module.exports = {

    getByData: async function (data, select, setOption) {
        try {
            return await playerModel.find(data, select, setOption).lean();  // setOption(sort, limit,skip)
        } catch (e) {
            Sys.Log.info('Error in getByData : ' + e);
        }
    },

    getSingleData: async function (data, select, setOption) {
        try {
            return await playerModel.findOne(data, select, setOption).lean();
        } catch (e) {
            Sys.Log.info('Error in getSingleData : ' + e);
        }
    },

    getCount: async function(data, select, setOption) {
        try {
            return await playerModel.countDocuments(data, select, setOption);
        } catch (e) {
            Sys.Log.info('Error in getPlayerCount : ' + e);
        }
    },

    getById: async function(id, select) {
        try {
            return await playerModel.findById(id, select).lean();
        } catch (e) {
            Sys.Log.info('Error in getByData : ' + e);
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

}