'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const LeaderboardModel = mongoose.model('Leaderboard');


module.exports = {

    getByData: async function(data) {
        try {
            return await LeaderboardModel.find(data);
        } catch (e) {
            console.log("LeaderboardServices Error in getByData", e);
            return new Error(e);
        }
    },

    getByDataAce: async function(data) {
        try {
            return await LeaderboardModel.find(data).sort({ place: 1 });
        } catch (e) {
            console.log("LeaderboardServices Error in getByData", e);
            return new Error(e);
        }
    },

    getById: async function(id) {
        try {
            return await LeaderboardModel.findById(id);
        } catch (error) {
            console.log('LeaderboardServices Error in getById : ', error);
        }
    },

    getLeaderboardDatatable: async function(query, length, start, sort) {
        try {
            return await LeaderboardModel.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("LeaderboardServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getLeaderboardCount: async function(data) {
        try {
            return await LeaderboardModel.countDocuments(data);
        } catch (e) {
            console.log("LeaderboardServices Error in getAgentCount", e);
            return new Error(e);
        }
    },

    getSingleLeaderboardData: async function(data, column) {
        try {
            return await LeaderboardModel.findOne(data).select(column);
        } catch (e) {
            console.log("LeaderboardServices Error in getSingleHallData", e);
            return new Error(e);
        }
    },

    insertLeaderboardData: async function(data) {
        try {

            return await LeaderboardModel.create(data);
        } catch (e) {
            console.log("LeaderboardServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    deleteLeaderboard: async function(data) {
        try {
            return await LeaderboardModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("LeaderboardServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateLeaderboardData: async function(condition, data) {
        try {
            return await LeaderboardModel.updateOne(condition, data);
        } catch (e) {
            console.log("LeaderboardServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await LeaderboardModel.aggregate(data);
        } catch (e) {
            console.log("LeaderboardServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },
}