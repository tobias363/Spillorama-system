'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const parentGameModel = mongoose.model('parentGame');
const hallModel = mongoose.model('hall');
const groupHallModel = mongoose.model('groupHall');
const gameType = mongoose.model('gameType');
const Loyalty = mongoose.model('loyalty');
const Voucher = mongoose.model('Voucher');
const leaderboard = mongoose.model('Leaderboard');
const tickets = mongoose.model('Ticket');
const subGameModel = mongoose.model('subGame');
module.exports = {
  //*************************************************************************************************** */

  getByData: async function (data,options = {}) {
    try {
      return await gameModel.find(data).select(options.select).sort(options.sort).skip(options.skip).limit(options.limit).exec();
    } catch (e) {
      console.error("Error in getByData in Game AdminServices", e);
      throw new Error(e.message);
    }
  },

  getParentByData: async function (data, select, setOption) {
    try {
      return await parentGameModel.find(data, select, setOption);
    } catch (e) {
      console.log("Error in getParentByData", e);
    }
  },


  getTicketData: async function (data, select, setOption) {
    try {
      return await tickets.find(data);
    } catch (e) {
      console.log("Error in getParentByData", e);
    }
  },

  getGameData: async function (data,options = {}) {
    try {
      return await gameModel.findOne(data).select(options.select).lean();
    } catch (e) {
      console.error("Error in getGameData in Game AdminServices", e);
      throw new Error(e.message);
    }
  },

  getGameCount: async function (data) {
    try {
      return await gameModel.countDocuments(data);
    } catch (e) {
      console.log("Error", e);
    }
  },

  getSingleGameData: async function (data, select, setOption) {
    try {
      return await gameModel.findOne(data, select, setOption).lean();
    } catch (e) {
      console.log("Error", e);
    }
  },

  getSingleParentGameData: async function (data) {
    try {
      return await parentGameModel.findOne(data);
    } catch (e) {
      console.log("Error in getSingleParentGameData::", e);
    }
  },

  updateGameData: async function (query,data) {
    try {
      console.log(query,data);
      return await gameModel.updateOne(query,data);
    } catch (e) {
      console.log("Error in updateGameData::", e);
    }
  },

  updateManyGameData: async function (query,data) {
    try {
      console.log(query,data);
      return await gameModel.updateMany(query,data);
    } catch (e) {
      console.log("Error in updateGameData::", e);
    }
  },

  getSingleHallData: async function(data, select, setOption) {
    try {
        return await hallModel.findOne(data, select, setOption).lean();
    } catch (e) {
        console.log("Error", e);
    }
},

}